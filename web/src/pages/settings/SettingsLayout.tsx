/**
 * Settings shell — grouped sub-sidebar (moonshot pattern, simplified
 * to a fixed-width column). The groups and items are role-filtered;
 * /settings redirects to the first item the user may see.
 */
import { useTranslation } from 'react-i18next';
import { Navigate, NavLink as RouterNavLink, Outlet, useLocation } from 'react-router-dom';
import { Box, NavLink, Stack, Text } from '@mantine/core';
import { ArrowLeftRight, FlaskRound, Mail, Users } from 'lucide-react';
import { useAuthStore } from '../../stores/auth';

interface SettingsItem {
  slug: string;
  labelKey: string;
  icon: typeof Mail;
  roles: string[];
}

interface SettingsGroup {
  labelKey: string;
  items: SettingsItem[];
}

const GROUPS: SettingsGroup[] = [
  {
    labelKey: 'settings.groupAdministration',
    items: [
      { slug: 'users', labelKey: 'nav.users', icon: Users, roles: ['clinic-admin'] },
      { slug: 'supplier-policies', labelKey: 'nav.supplierPolicies', icon: ArrowLeftRight, roles: ['hca-admin'] },
    ],
  },
  {
    labelKey: 'settings.groupSystem',
    items: [
      { slug: 'studies-sync', labelKey: 'nav.studiesSync', icon: FlaskRound, roles: ['hca-admin'] },
      { slug: 'mail-server', labelKey: 'settings.mailServer', icon: Mail, roles: ['hca-admin'] },
    ],
  },
];

export function visibleSettingsItems(userRole: string | null): SettingsItem[] {
  return GROUPS.flatMap((g) => g.items).filter(
    (item) => userRole !== null && item.roles.includes(userRole),
  );
}

export function SettingsLayout() {
  const { t } = useTranslation();
  const { userRole } = useAuthStore();
  const location = useLocation();

  const visible = visibleSettingsItems(userRole);

  // /settings without a sub-path: jump to the first visible item.
  if (location.pathname === '/settings' || location.pathname === '/settings/') {
    if (visible.length === 0) return <Navigate to="/dashboard" replace />;
    return <Navigate to={`/settings/${visible[0].slug}`} replace />;
  }

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      <Box
        w={230}
        p="md"
        style={{
          flexShrink: 0,
          borderRight: '1px solid var(--mantine-color-default-border)',
          overflowY: 'auto',
        }}
      >
        <Text fw={600} fz="lg" mb="md">{t('settings.title')}</Text>
        <Stack gap="lg">
          {GROUPS.map((group) => {
            const items = group.items.filter(
              (item) => userRole !== null && item.roles.includes(userRole),
            );
            if (items.length === 0) return null;
            return (
              <Box key={group.labelKey}>
                <Text fz={11} fw={600} c="dimmed" tt="uppercase" mb={4}>
                  {t(group.labelKey)}
                </Text>
                <Stack gap={2}>
                  {items.map((item) => (
                    <NavLink
                      key={item.slug}
                      component={RouterNavLink}
                      to={`/settings/${item.slug}`}
                      label={t(item.labelKey)}
                      leftSection={<item.icon size={16} />}
                      active={location.pathname.startsWith(`/settings/${item.slug}`)}
                      style={{ borderRadius: 6 }}
                    />
                  ))}
                </Stack>
              </Box>
            );
          })}
        </Stack>
      </Box>
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Outlet />
      </div>
    </div>
  );
}
