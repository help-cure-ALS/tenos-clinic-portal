import { useEffect, useMemo } from 'react';
import {
  Outlet,
  Navigate,
  NavLink as RouterNavLink,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Menu,
  UnstyledButton,
  Avatar,
  Loader,
  Center,
  Text,
} from '@mantine/core';
import {
  ArrowLeftRight,
  Award,
  Building,
  Building2,
  Check,
  ChevronDown,
  FlaskConical,
  FlaskRound,
  Hospital,
  Languages,
  LayoutDashboard,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  Stethoscope,
  User,
  Users,
} from 'lucide-react';
import {
  MainNav,
  MainNavHeaderButton,
  useMainNavCollapsed,
  type MainNavSection,
  type MainNavIcon,
} from '@hca/mantine-workbench';

import {
  useAuthStore,
  getPractitionerName,
  getPractitionerEmail,
  type UserRole,
} from '../../stores/auth';
import { useVerifications } from '../../hooks/useVerifications';

// Wave UI.8 (2026-05-20) — desktop admin shell built on
// `<MainNav>` from `@hca/mantine-workbench`. Pattern identical to
// Moonshot's shell: outer flex container, MainNav as full sidebar
// with collapse state + localStorage persistence, branding at the
// top in the header slots, footer holds language toggle + user menu.
// No Mantine AppShell, no mobile burger — HCA Admin Portal is
// desktop-only.

const STORAGE_KEY = 'hca-admin.mainnav.collapsed';

interface NavDescriptor {
  to: string;
  labelKey: string;
  icon: MainNavIcon;
  roles: UserRole[];
  /**
   * Variant C — five sections:
   *   `overview`       — stand-alone entry without section header
   *   `patients`       — daily clinic work (verifications, tokens)
   *   `organization`   — clinic setup (users, studies, profile)
   *   `directory`      — HCA admin directory (who is in the system)
   *   `configuration`  — HCA admin platform configuration
   */
  sectionKey:
    | 'overview'
    | 'patients'
    | 'organization'
    | 'directory'
    | 'configuration';
  badge?: number;
}

export function AppShellLayout() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useMainNavCollapsed({
    storageKey: STORAGE_KEY,
    defaultCollapsed: false,
  });
  const {
    isAuthenticated,
    checkAuth,
    isLoading,
    practitioner,
    organization,
    userRole,
    logout,
    setLanguage,
  } = useAuthStore();
  const { data: pendingVerifications = [] } = useVerifications();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // Hook rule: ALL hooks (incl. the useMemo below) must run BEFORE
  // the early returns, otherwise the hook count changes between
  // renders → React crash ("Rendered fewer hooks than expected").
  // Hence: derived values + useMemo first, loading/auth guard after.
  const userName = getPractitionerName(practitioner);
  const userEmail = getPractitionerEmail(practitioner);
  const clinicName = organization?.name || '';

  const navItems: NavDescriptor[] = [
    // Overview — stand-alone entry (header-less section)
    {
      to: '/dashboard',
      labelKey: 'nav.dashboard',
      icon: LayoutDashboard,
      roles: ['clinic-admin', 'clinic-verifier', 'clinic-member'],
      sectionKey: 'overview',
    },

    // Patients — daily clinic workflow
    {
      to: '/verifications',
      labelKey: 'nav.verifications',
      icon: ShieldCheck,
      roles: ['clinic-admin', 'clinic-verifier'],
      sectionKey: 'patients',
      badge: pendingVerifications.length || undefined,
    },
    {
      to: '/tokens',
      labelKey: 'nav.tokens',
      icon: Award,
      roles: ['clinic-admin', 'clinic-verifier', 'clinic-member'],
      sectionKey: 'patients',
    },

    // Organization — clinic master data/setup
    {
      to: '/users',
      labelKey: 'nav.users',
      icon: Users,
      roles: ['clinic-admin'],
      sectionKey: 'organization',
    },
    {
      to: '/clinic-studies',
      labelKey: 'nav.clinicStudies',
      icon: FlaskConical,
      roles: ['clinic-admin'],
      sectionKey: 'organization',
    },
    {
      to: '/clinic-profile',
      labelKey: 'nav.clinicProfile',
      icon: Hospital,
      roles: ['clinic-admin'],
      sectionKey: 'organization',
    },

    // Directory — HCA admin, read-heavy: who/what is in the system
    {
      to: '/clinics',
      labelKey: 'nav.allClinics',
      icon: Building,
      roles: ['hca-admin'],
      sectionKey: 'directory',
    },
    {
      to: '/clinics?active=true',
      labelKey: 'nav.activeClinics',
      icon: Building2,
      roles: ['hca-admin'],
      sectionKey: 'directory',
    },
    {
      to: '/suppliers',
      labelKey: 'nav.suppliers',
      icon: Building,
      roles: ['hca-admin'],
      sectionKey: 'directory',
    },
    {
      to: '/practitioners',
      labelKey: 'nav.practitioners',
      icon: Stethoscope,
      roles: ['hca-admin'],
      sectionKey: 'directory',
    },

    // Configuration — HCA admin, write-heavy: platform settings
    {
      to: '/supplier-workflow-policies',
      labelKey: 'nav.supplierPolicies',
      icon: ArrowLeftRight,
      roles: ['hca-admin'],
      sectionKey: 'configuration',
    },
    {
      to: '/studies',
      labelKey: 'nav.studies',
      icon: FlaskConical,
      roles: ['hca-admin'],
      sectionKey: 'configuration',
    },
    {
      to: '/studies-sync',
      labelKey: 'nav.studiesSync',
      icon: FlaskRound,
      roles: ['hca-admin'],
      sectionKey: 'configuration',
    },
  ];

  // Active-state logic — exact query params, /clinics special case,
  // /dashboard special case, otherwise prefix match.
  const isActive = (to: string): boolean => {
    const [itemPath, itemSearch] = to.split('?');
    if (itemSearch) {
      return (
        location.pathname === itemPath &&
        location.search === `?${itemSearch}`
      );
    }
    if (itemPath === '/clinics') {
      return (
        location.pathname.startsWith('/clinics') &&
        location.search !== '?active=true'
      );
    }
    if (itemPath === '/dashboard') {
      return location.pathname === '/dashboard';
    }
    return (
      location.pathname === itemPath ||
      location.pathname.startsWith(itemPath + '/')
    );
  };

  const sections: MainNavSection[] = useMemo(() => {
    const visible = navItems.filter((item) =>
      item.roles.includes(userRole)
    );

    // Mapping item → MainNavItem, badge as label suffix for now.
    const toItem = (i: NavDescriptor) => ({
      href: i.to,
      label:
        i.badge && i.badge > 0
          ? `${t(i.labelKey)} (${i.badge})`
          : t(i.labelKey),
      icon: i.icon,
      isActive: isActive(i.to),
    });

    // Section bucketing by sectionKey, order as declared.
    const buckets = {
      overview: visible.filter((i) => i.sectionKey === 'overview'),
      patients: visible.filter((i) => i.sectionKey === 'patients'),
      organization: visible.filter((i) => i.sectionKey === 'organization'),
      directory: visible.filter((i) => i.sectionKey === 'directory'),
      configuration: visible.filter((i) => i.sectionKey === 'configuration'),
    };

    const out: MainNavSection[] = [];
    // Overview: no header — looks like a stand-alone entry at the top.
    if (buckets.overview.length) {
      out.push({ items: buckets.overview.map(toItem) });
    }
    if (buckets.patients.length) {
      out.push({
        label: t('nav.sectionPatients'),
        items: buckets.patients.map(toItem),
      });
    }
    if (buckets.organization.length) {
      out.push({
        label: t('nav.sectionOrganization'),
        items: buckets.organization.map(toItem),
      });
    }
    if (buckets.directory.length) {
      out.push({
        label: t('nav.sectionDirectory'),
        items: buckets.directory.map(toItem),
      });
    }
    if (buckets.configuration.length) {
      out.push({
        label: t('nav.sectionConfiguration'),
        items: buckets.configuration.map(toItem),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    userRole,
    location.pathname,
    location.search,
    pendingVerifications,
    i18n.language,
  ]);

  // Early returns AFTER all hooks (see comment above).
  if (isLoading) {
    return (
      <Center h="100vh">
        <Loader color="hca-purple" />
      </Center>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        minHeight: 0,
        overflow: 'hidden',
        background: 'var(--mantine-color-body)',
      }}
    >
      <MainNav
        sections={sections}
        storageKey={STORAGE_KEY}
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
        defaultCollapsed={false}
        expandedHeader={
          <ExpandedHeader onCollapse={() => setCollapsed(true)} />
        }
        collapsedHeader={
          <CollapsedHeader onExpand={() => setCollapsed(false)} />
        }
        footer={
          <UserMenu
            collapsed={collapsed}
            userName={userName}
            userEmail={userEmail}
            clinicName={clinicName}
            userRole={userRole}
            currentLocale={i18n.language}
            onChangeLocale={(loc) => setLanguage(loc)}
            onLogout={handleLogout}
            t={t}
          />
        }
        renderLink={({ href, isActive: itemActive, children, style, onMouseEnter, onMouseLeave }) => (
          <RouterNavLink
            to={href}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            // The browser default for `<a>` is `text-decoration: underline`
            // — the style passed in by MainNav takes care of
            // everything else (background, color, padding) but not
            // the underline. Explicitly turn it off here.
            style={{ ...style, textDecoration: 'none' }}
            aria-current={itemActive ? 'page' : undefined}
          >
            {children}
          </RouterNavLink>
        )}
      />

      <div
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          // The main container is scroll-free: header/toolbars stay
          // sticky, only the grid inside the page scrolls internally.
          // Pages provide the scroll container themselves (Stack h=100%
          // with flex:1+overflow:auto around the grid).
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--mantine-color-body)',
        }}
      >
        <Outlet />
      </div>
    </div>
  );
}

// ─── Header slots ────────────────────────────────────────

function ExpandedHeader({ onCollapse }: { onCollapse: () => void }) {
  const { t } = useTranslation();
  return (
    <>
      <Text
        fw={700}
        size="md"
        style={{
          color: 'var(--mantine-workbench-nav-text)',
          letterSpacing: '0.02em',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        TENOS Care Portal
      </Text>
      <MainNavHeaderButton
        icon={<PanelLeftClose size={16} />}
        label={t('nav.collapseSidebar')}
        onClick={onCollapse}
      />
    </>
  );
}

function CollapsedHeader({ onExpand }: { onExpand: () => void }) {
  const { t } = useTranslation();
  return (
    <MainNavHeaderButton
      icon={<PanelLeftOpen size={16} />}
      label={t('nav.expandSidebar')}
      onClick={onExpand}
    />
  );
}

// ─── Footer slot — UserMenu ──────────────────────────────
//
// Pattern from Moonshot: a single user trigger in the footer; the
// dropdown holds the language switch as a `Menu.Label` with locale
// items and a check indicator for the active language entry — no
// separate language toggle button. Logout below it.

const LOCALES = ['de', 'en'] as const;
type Locale = (typeof LOCALES)[number];
const LOCALE_LABELS: Record<Locale, string> = {
  de: 'Deutsch',
  en: 'English',
};

function UserMenu({
  collapsed,
  userName,
  userEmail,
  clinicName,
  userRole,
  currentLocale,
  onChangeLocale,
  onLogout,
  t,
}: {
  collapsed: boolean;
  userName: string;
  userEmail: string;
  clinicName: string;
  userRole: UserRole;
  currentLocale: string;
  onChangeLocale: (loc: Locale) => void;
  onLogout: () => void;
  t: (key: string) => string;
}) {
  return (
    <Menu
      position={collapsed ? 'right-end' : 'top-end'}
      offset={8}
      withArrow
      shadow="md"
      width={240}
    >
      <Menu.Target>
        {collapsed ? (
          <UnstyledButton
            aria-label={userName}
            title={userName}
            style={{
              margin: '0 auto',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 8,
              width: 36,
              height: 36,
              color: 'var(--mantine-workbench-nav-text-dimmed)',
            }}
          >
            <User size={18} strokeWidth={1.5} />
          </UnstyledButton>
        ) : (
          <UnstyledButton
            aria-label={userName}
            title={userName}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              width: '100%',
              padding: '7px 10px',
              marginBottom: 2,
              borderRadius: 6,
              color: 'var(--mantine-workbench-nav-text-dimmed)',
              fontSize: 'var(--mantine-font-size-md)',
              minWidth: 0,
            }}
          >
            <Avatar color="hca-purple" radius="xl" size="sm">
              {userName.charAt(0).toUpperCase()}
            </Avatar>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Text
                size="sm"
                fw={500}
                lh={1.2}
                c="var(--mantine-workbench-nav-text)"
                style={{
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {userName}
              </Text>
              <Text
                size="xs"
                lh={1.2}
                style={{
                  color: 'var(--mantine-workbench-nav-text-dimmed)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {clinicName || t(`roles.${userRole}`)}
              </Text>
            </div>
            <ChevronDown size={14} />
          </UnstyledButton>
        )}
      </Menu.Target>

      <Menu.Dropdown>
        <Menu.Label>
          <Text size="sm" fw={500}>
            {userName}
          </Text>
          <Text size="xs" c="dimmed">
            {userEmail}
          </Text>
        </Menu.Label>

        <Menu.Divider />

        <Menu.Label>{t('nav.language')}</Menu.Label>
        {LOCALES.map((loc) => {
          // i18next with LanguageDetector returns the browser locale
          // including region (`"de-DE"`, `"en-US"`), but the language
          // toggle only sets the primary code (`"de"`). So compare
          // only the language level for the active check — otherwise
          // no item matches on first render and no check is visible.
          const primary = currentLocale.split('-')[0];
          const isCurrent = loc === primary;
          return (
            <Menu.Item
              key={loc}
              leftSection={<Languages size={14} />}
              rightSection={
                isCurrent ? (
                  <Check
                    size={12}
                    style={{ color: 'var(--mantine-color-hca-purple-6)' }}
                  />
                ) : null
              }
              onClick={() => {
                if (!isCurrent) onChangeLocale(loc);
              }}
              style={{
                color: isCurrent
                  ? 'var(--mantine-color-hca-purple-6)'
                  : undefined,
                fontWeight: isCurrent ? 500 : undefined,
              }}
            >
              {LOCALE_LABELS[loc]}
            </Menu.Item>
          );
        })}

        <Menu.Divider />

        <Menu.Item
          leftSection={<LogOut size={14} />}
          onClick={onLogout}
          color="red"
        >
          {t('auth.signOut')}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
