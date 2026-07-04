/**
 * Authentication store with role-based access control.
 * Login via medplum.startLogin() (no PKCE redirect).
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { medplum, getMyOrganization, getMyPractitionerRole } from '../lib/medplum';
import type { Organization, Practitioner, PractitionerRole } from '@medplum/fhirtypes';
import i18n from '../i18n';

// FHIR standard for language codes (RFC 5646 / BCP-47).
const BCP47_SYSTEM = 'urn:ietf:bcp:47';
const SUPPORTED_LANGUAGES = ['de', 'en'] as const;
type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

function getPractitionerLanguage(p: Practitioner | null): SupportedLanguage | null {
  const code = p?.communication?.[0]?.coding?.[0]?.code;
  if (!code) return null;
  // FHIR codes may be region-suffixed (`de-DE`); for our language
  // comparison only the primary language level matters.
  const primary = code.split('-')[0];
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(primary)
    ? (primary as SupportedLanguage)
    : null;
}

/**
 * Reads the language from the Practitioner, if set, and syncs
 * i18n. Called on every login + auth restore.
 */
async function syncLanguageFromPractitioner(p: Practitioner | null) {
  const lang = getPractitionerLanguage(p);
  if (lang && i18n.language !== lang) {
    await i18n.changeLanguage(lang);
  }
}

export type UserRole = 'hca-admin' | 'clinic-admin' | 'clinic-verifier' | 'clinic-member';

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  practitioner: Practitioner | null;
  practitionerRole: PractitionerRole | null;
  organization: Organization | null;
  userRole: UserRole;

  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  clearError: () => void;
  /**
   * Sets the current user's language:
   *   1. update i18n right away (immediately visible)
   *   2. persist Practitioner.communication on the server
   *
   * On server error the i18n change stays — the next sync on
   * reload simply won't know about the switch, no drama.
   */
  setLanguage: (code: 'de' | 'en') => Promise<void>;
}

/**
 * Determine user role from PractitionerRole extensions.
 */
function determineRole(role: PractitionerRole | null): UserRole {
  if (!role) return 'hca-admin';

  const extensions = role.extension ?? [];

  const clinicRoleExt = extensions.find(e => e.url === 'urn:hca:clinic-role');
  if (clinicRoleExt?.valueString === 'admin') return 'clinic-admin';

  const canVerifyExt = extensions.find(e => e.url === 'urn:hca:can-verify');
  if (canVerifyExt?.valueBoolean === true || canVerifyExt?.valueString === 'true') return 'clinic-verifier';

  return 'clinic-member';
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      isAuthenticated: false,
      isLoading: false,
      error: null,
      practitioner: null,
      practitionerRole: null,
      organization: null,
      userRole: 'clinic-member' as UserRole,

      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null });
        try {
          const projectId = import.meta.env.VITE_MEDPLUM_PROJECT_ID || undefined;
          const loginResponse = await medplum.startLogin({ email, password, ...(projectId ? { projectId } : {}) });

          if (loginResponse.code) {
            await medplum.processCode(loginResponse.code);
          } else if (loginResponse.memberships && loginResponse.memberships.length > 0) {
            // Auto-select first membership
            const profileResponse = await medplum.post('auth/profile', {
              login: loginResponse.login,
              membership: loginResponse.memberships[0],
            });
            if (profileResponse.code) {
              await medplum.processCode(profileResponse.code);
            }
          }

          const profile = medplum.getProfile() as Practitioner | undefined;
          if (!profile) throw new Error('Failed to load profile');

          const practitionerRole = await getMyPractitionerRole(profile);
          const org = await getMyOrganization(profile);
          const userRole = determineRole(practitionerRole);

          set({
            isAuthenticated: true,
            isLoading: false,
            practitioner: profile,
            practitionerRole,
            organization: org,
            userRole,
          });

          await syncLanguageFromPractitioner(profile);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Login failed';
          set({ error: message, isLoading: false });
          throw error;
        }
      },

      logout: async () => {
        try {
          await medplum.signOut();
        } finally {
          set({
            isAuthenticated: false,
            practitioner: null,
            practitionerRole: null,
            organization: null,
            userRole: 'clinic-member',
            error: null,
            isLoading: false,
          });
        }
      },

      checkAuth: async () => {
        const currentState = useAuthStore.getState();
        if (currentState.isAuthenticated && currentState.practitioner) {
          set({ isLoading: false });
          return;
        }

        set({ isLoading: true });
        try {
          const profile = medplum.getProfile();

          if (profile && profile.resourceType === 'Practitioner') {
            const practitionerRole = await getMyPractitionerRole(profile as Practitioner);
            const org = await getMyOrganization(profile as Practitioner);
            const userRole = determineRole(practitionerRole);

            set({
              isAuthenticated: true,
              isLoading: false,
              practitioner: profile as Practitioner,
              practitionerRole,
              organization: org,
              userRole,
            });

            await syncLanguageFromPractitioner(profile as Practitioner);
            return;
          }

          const timeoutPromise = new Promise<null>((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), 3000)
          );

          try {
            const activeLogin = await Promise.race([
              medplum.getActiveLogin(),
              timeoutPromise,
            ]);

            if (activeLogin) {
              const fetchedProfile = medplum.getProfile();
              if (fetchedProfile && fetchedProfile.resourceType === 'Practitioner') {
                const practitionerRole = await getMyPractitionerRole(fetchedProfile as Practitioner);
                const org = await getMyOrganization(fetchedProfile as Practitioner);
                const userRole = determineRole(practitionerRole);

                set({
                  isAuthenticated: true,
                  isLoading: false,
                  practitioner: fetchedProfile as Practitioner,
                  practitionerRole,
                  organization: org,
                  userRole,
                });

                await syncLanguageFromPractitioner(
                  fetchedProfile as Practitioner
                );
                return;
              }
            }
          } catch {
            // Timeout or error
          }

          set({
            isAuthenticated: false,
            isLoading: false,
            practitioner: null,
            practitionerRole: null,
            organization: null,
            userRole: 'clinic-member',
          });
        } catch {
          set({
            isAuthenticated: false,
            isLoading: false,
            practitioner: null,
            practitionerRole: null,
            organization: null,
            userRole: 'clinic-member',
          });
        }
      },

      clearError: () => set({ error: null }),

      setLanguage: async (code) => {
        const state = useAuthStore.getState();
        const current = state.practitioner;
        if (!current) {
          // Anonymous path (login page): i18n only, no server write.
          await i18n.changeLanguage(code);
          return;
        }

        // 1. i18n first — the user sees the language switch no matter
        //    what the server does behind the scenes.
        await i18n.changeLanguage(code);

        // 2. Set Practitioner.communication on the server.
        try {
          const updated = await medplum.updateResource<Practitioner>({
            ...current,
            communication: [
              {
                coding: [
                  {
                    system: BCP47_SYSTEM,
                    code,
                    display: code === 'de' ? 'Deutsch' : 'English',
                  },
                ],
              },
            ],
          });
          set({ practitioner: updated });
        } catch (err) {
          // Deliberately no i18n rollback — the user already sees the
          // new language in the UI; toggling again retries the
          // server write.
          // eslint-disable-next-line no-console
          console.error('Failed to persist language preference', err);
        }
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        isAuthenticated: state.isAuthenticated,
        practitioner: state.practitioner,
        practitionerRole: state.practitionerRole,
        organization: state.organization,
        userRole: state.userRole,
      }),
    }
  )
);

// Helper to get display name from Practitioner resource
export function getPractitionerName(practitioner: { name?: Array<{ text?: string; given?: string[]; family?: string }> } | null): string {
  if (!practitioner?.name?.[0]) return 'User';
  const name = practitioner.name[0];
  if (name.text) return name.text;
  const given = name.given?.join(' ') || '';
  const family = name.family || '';
  return `${given} ${family}`.trim() || 'User';
}

export function getPractitionerEmail(practitioner: { telecom?: Array<{ system?: string; value?: string }> } | null): string {
  if (!practitioner?.telecom) return '';
  const email = practitioner.telecom.find(t => t.system === 'email');
  return email?.value || '';
}
