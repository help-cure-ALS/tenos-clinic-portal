/**
 * Medplum client + auth guard for studies-sync.
 *
 * We have two jobs:
 *   1. Service client: a persistent client login with
 *      MEDPLUM_CLIENT_ID/SECRET so the sync runner can read and
 *      write ResearchStudies.
 *   2. Auth guard: `validateClinicianToken` checks a Medplum access
 *      token sent by the browser against `/auth/me` and returns
 *      `isHcaAdmin` — only with that do we let admin endpoints through.
 *
 * The guard part is a reduced copy of
 * `supplier-proxy/src/medplum.ts`. We don't need practitioner-role
 * resolution here because studies-sync only has admin endpoints.
 */

import { MedplumClient } from "@medplum/core";

const MEDPLUM_BASE_URL = process.env.MEDPLUM_BASE_URL || "http://medplum-server:8103/";
const MEDPLUM_CLIENT_ID = process.env.MEDPLUM_CLIENT_ID || "";
const MEDPLUM_CLIENT_SECRET = process.env.MEDPLUM_CLIENT_SECRET || "";

let serviceClient: MedplumClient | null = null;

export async function getServiceClient(): Promise<MedplumClient> {
    if (serviceClient) return serviceClient;

    serviceClient = new MedplumClient({
        baseUrl: MEDPLUM_BASE_URL,
        fetch: globalThis.fetch,
    });

    if (MEDPLUM_CLIENT_ID && MEDPLUM_CLIENT_SECRET) {
        await serviceClient.startClientLogin(MEDPLUM_CLIENT_ID, MEDPLUM_CLIENT_SECRET);
    } else {
        console.warn(
            "[studies-medplum] No MEDPLUM_CLIENT_ID/SECRET configured — service client is unauthenticated",
        );
    }

    return serviceClient;
}

// ─── Auth guard ────────────────────────────────────────────────────

export interface AdminIdentity {
    /** Medplum practitioner ID (if present in the token), logs only. */
    practitionerId: string | null;
    isHcaAdmin: boolean;
}

function extractIsHcaAdmin(authMeData: unknown): boolean {
    if (!authMeData || typeof authMeData !== "object") return false;
    const me = authMeData as Record<string, unknown>;

    if (me.isAdmin === true) return true;
    const projectMembership = me.projectMembership as Record<string, unknown> | undefined;
    if (projectMembership?.admin === true) return true;
    const membership = me.membership as Record<string, unknown> | undefined;
    if (membership?.admin === true) return true;

    const arrays = [me.projectMemberships, me.memberships, me.projects];
    for (const entries of arrays) {
        if (!Array.isArray(entries)) continue;
        if (entries.some((entry) => (entry as Record<string, unknown>)?.admin === true)) return true;
    }

    return false;
}

function parseReference(ref: string, expectedType: string): string | null {
    const parts = ref.split("/");
    if (parts.length !== 2) return null;
    if (parts[0] !== expectedType) return null;
    if (!parts[1]) return null;
    return parts[1];
}

/**
 * Validates a Medplum access token against `/auth/me` and only
 * returns an identity if the calling account is a super admin.
 * For non-admins → `null`.
 */
export async function validateAdminToken(accessToken: string): Promise<AdminIdentity | null> {
    let authMeData: unknown;
    try {
        const res = await fetch(`${MEDPLUM_BASE_URL}auth/me`, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) return null;
        authMeData = await res.json();
    } catch (err) {
        console.error("[studies-medplum] Failed to call /auth/me:", err);
        return null;
    }

    if (!extractIsHcaAdmin(authMeData)) {
        return null;
    }

    const me = authMeData as Record<string, unknown>;
    const profile = me.profile as Record<string, unknown> | undefined;
    let practitionerId: string | null = null;
    const profileRef = profile?.reference;
    if (typeof profileRef === "string") {
        practitionerId = parseReference(profileRef, "Practitioner");
    } else if (profile?.resourceType === "Practitioner" && typeof profile?.id === "string") {
        practitionerId = profile.id;
    }

    return {
        practitionerId,
        isHcaAdmin: true,
    };
}
