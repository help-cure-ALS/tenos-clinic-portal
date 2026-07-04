import { useTranslation } from 'react-i18next';
import { NavLink as RouterNavLink } from 'react-router-dom';
import {
  SimpleGrid,
  Paper,
  Text,
  Group,
  Stack,
  ThemeIcon,
} from '@mantine/core';
import { PageHeader } from '@hca/mantine-workbench';

import { useVerifications, useVerificationTokens } from '../hooks/useVerifications';
import { useClinics } from '../hooks/useClinics';
import { useClinicStudyList } from '../hooks/useClinicStudies';
import { useAuthStore, getPractitionerName } from '../stores/auth';
import { medplum } from '../lib/medplum';
import { useQuery } from '@tanstack/react-query';
import { VERIFICATION_TAG } from '../lib/constants';
import { Clock, FlaskConical, Hospital, ShieldCheck, Users , X} from 'lucide-react';

function usePractitionerCount() {
  const { isAuthenticated, userRole } = useAuthStore();
  return useQuery({
    queryKey: ['practitioner-count'],
    queryFn: async () => {
      const bundle = await medplum.search('Practitioner', { _summary: 'count' });
      return bundle.total ?? 0;
    },
    enabled: isAuthenticated && userRole === 'hca-admin',
  });
}

// Count query instead of useStudies(): searchResources is capped at
// Medplum's _count maximum of 1000 — `.length` would incorrectly
// stall at 1000 for >1000 studies. `_summary: 'count'` returns
// the real total without loading resources.
function useStudyCount() {
  const { isAuthenticated, userRole } = useAuthStore();
  return useQuery({
    queryKey: ['study-count'],
    queryFn: async () => {
      const bundle = await medplum.search('ResearchStudy', { _summary: 'count' });
      return bundle.total ?? 0;
    },
    enabled: isAuthenticated && userRole === 'hca-admin',
  });
}

export function Dashboard() {
  const { t } = useTranslation();
  const { practitioner, organization, userRole } = useAuthStore();
  const { data: pending = [] } = useVerifications();
  const { data: tokens = [] } = useVerificationTokens();
  const { data: clinics = [] } = useClinics();
  const { data: practitionerCount = 0 } = usePractitionerCount();
  const { data: studyCount = 0 } = useStudyCount();
  const { data: clinicStudyData } = useClinicStudyList(organization?.id);

  const userName = getPractitionerName(practitioner);
  const clinicName = organization?.name;
  const isHcaAdmin = userRole === 'hca-admin';

  const activeClinics = clinics.filter((org) => {
    const tags = org.meta?.tag ?? [];
    return tags.some(
      (t) => t.system === VERIFICATION_TAG.system && t.code === VERIFICATION_TAG.code
    );
  });

  // Each stat has a `to` target that links the card to the route
  // its value counts against — patient workflow or directory page.
  const verificationStats = [
    {
      label: t('dashboard.pendingRequests'),
      value: pending.length,
      icon: Clock,
      color: 'orange',
      to: '/verifications',
    },
    {
      label: t('dashboard.totalValidTokens'),
      value: tokens.filter((tk) => tk.status === 'valid').length,
      icon: ShieldCheck,
      color: 'blue',
      to: '/tokens',
    },
    {
      label: t('dashboard.revokedTokens'),
      value: tokens.filter((tk) => tk.status === 'revoked').length,
      icon: X,
      color: 'red',
      to: '/tokens',
    },
  ];

  const adminStats = [
    {
      label: t('dashboard.practitioners'),
      value: practitionerCount,
      icon: Users,
      color: 'indigo',
      to: '/practitioners',
    },
    {
      label: t('dashboard.activeClinics'),
      value: activeClinics.length,
      icon: Hospital,
      color: 'teal',
      to: '/clinics?active=true',
    },
    {
      label: t('dashboard.totalStudies'),
      value: studyCount,
      icon: FlaskConical,
      color: 'grape',
      to: '/studies',
    },
  ];

  const clinicStats = [
    {
      label: t('dashboard.clinicStudies'),
      value: clinicStudyData?.studyIds.length ?? 0,
      icon: FlaskConical,
      color: 'grape',
      to: '/clinic-studies',
    },
  ];

  const stats = isHcaAdmin
    ? [...adminStats, ...verificationStats]
    : [...clinicStats, ...verificationStats];

  // The subtitle folds in the clinic name if present — the same
  // information that previously sat as a subline under the title.
  const subtitle = clinicName
    ? `${clinicName} · ${t('dashboard.overview')}`
    : t('dashboard.overview');

  return (
    <Stack gap={0} h="100%" style={{ minHeight: 0 }}>
      <PageHeader
        title={t('dashboard.welcome', { name: userName })}
        subtitle={subtitle}
      />

      {/* Outer scroll container: light gray "panel-subtle" tint so the
          white cards visually lift off the surface. Pattern from
          Moonshot's dashboard. */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          background: 'var(--mantine-color-gray-0)',
        }}
      >
        {/* Inner content: max-width centered, asymmetric padding
            (more on the right toward the edge, less on the left toward
            the sidebar) as in Moonshot. */}
        <Stack
          gap="md"
          maw={1200}
          w="100%"
          mx="auto"
          pl={22}
          pr={48}
          py={28}
        >
          <SimpleGrid
            cols={{ base: 1, xs: 2, md: isHcaAdmin ? 3 : 4 }}
            spacing="md"
          >
            {stats.map((stat) => (
              <Paper
                key={stat.label}
                component={RouterNavLink}
                to={stat.to}
                withBorder
                p="md"
                radius="lg"
                // RouterNavLink renders an <a> with browser underline +
                // inherited text color. Neutralize both here, plus
                // a hover lift to make it clear the card is clickable
                // (pattern from Moonshot's KPI cards).
                //
                // Flex column + min-height: all cards share the same
                // minimum height, and the counter always sits at the
                // card bottom via `margin-top: auto` (on the `<Text>`
                // below) — even if the label wraps or is short.
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 120,
                  textDecoration: 'none',
                  color: 'inherit',
                  transition: 'transform 120ms, box-shadow 120ms',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-1px)';
                  e.currentTarget.style.boxShadow =
                    '0 4px 12px -4px rgba(0,0,0,0.12)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = '';
                  e.currentTarget.style.boxShadow = '';
                }}
              >
                <Group
                  justify="space-between"
                  align="flex-start"
                  wrap="nowrap"
                  gap="xs"
                  mb="xs"
                >
                  <Text
                    size="xs"
                    c="dimmed"
                    fw={500}
                    tt="uppercase"
                    style={{
                      letterSpacing: '0.04em',
                      // The label takes the remaining space and may
                      // wrap without the flex container pushing the
                      // icon out. `minWidth: 0` allows the text block
                      // to shrink below its min-content size.
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    {stat.label}
                  </Text>
                  <ThemeIcon
                    variant="light"
                    color={stat.color}
                    size="md"
                    radius="md"
                    style={{ flexShrink: 0 }}
                  >
                    <stat.icon size={16} />
                  </ThemeIcon>
                </Group>
                <Text
                  fw={700}
                  fz={32}
                  lh={1.1}
                  // mt: 'auto' pushes the counter to the card bottom,
                  // regardless of how many lines the label
                  // occupies.
                  style={{ marginTop: 'auto' }}
                >
                  {stat.value}
                </Text>
              </Paper>
            ))}
          </SimpleGrid>
        </Stack>
      </div>
    </Stack>
  );
}
