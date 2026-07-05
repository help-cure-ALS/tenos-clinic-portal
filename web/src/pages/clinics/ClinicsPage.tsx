import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Stack,
  Text,
  TextInput,
  Badge,
  Group,
  Button,
  Loader,
  Center,
  Modal,
  SimpleGrid,
  Select,
  ThemeIcon,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { Building, Plus, ShieldCheck, ShieldOff } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { Organization } from '@medplum/fhirtypes';
import {
  PageHeader,
  DataGrid,
  SearchInput,
  BulkActionBar,
  BulkPill,
  useGridSort,
  useRowSelection,
  type Column,
} from '@hca/mantine-workbench';

import { useClinics } from '../../hooks/useClinics';
import { medplum } from '../../lib/medplum';
import { getFacilityTypes } from '../../lib/facilityTypes';

// Wave UI.19 (2026-05-20) — ClinicsPage on Workbench. Pattern
// identical to TokensPage/UsersPage/VerificationsPage: PageHeader +
// SearchInput + DataGrid with useGridSort + scroll wrapper.
// We don't need selection here — clinics are opened in the detail
// page via row click, no bulk actions.

function hasVerification(org: Organization): boolean {
  return !!org.meta?.tag?.some(
    (tag) => tag.system === 'urn:hca:verification' && tag.code === 'enabled'
  );
}

export function ClinicsPage() {
  const { t } = useTranslation();
  const FACILITY_TYPES = getFacilityTypes(t);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const activeOnly = searchParams.get('active') === 'true';
  const { data: clinics = [], isLoading } = useClinics(activeOnly);

  const [createOpened, { open: openCreate, close: closeCreate }] =
    useDisclosure(false);
  const [creating, setCreating] = useState(false);

  // ─── Suche + Sort ──────────────────────────────────────
  const [query, setQuery] = useState('');

  const filteredClinics = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clinics;
    return clinics.filter((org) =>
      (org.name ?? '').toLowerCase().includes(q)
    );
  }, [clinics, query]);

  const sort = useGridSort<Organization>({
    mode: 'client',
    rows: filteredClinics,
    initial: { sortBy: 'name', sortDir: 'asc' },
    getValue: (row, columnId) => {
      switch (columnId) {
        case 'name':
          return row.name ?? '';
        case 'verification':
          return hasVerification(row) ? 1 : 0;
        default:
          return null;
      }
    },
  });

  const selection = useRowSelection();

  useEffect(() => {
    if (selection.value.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') selection.clear();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection]);

  const selectedClinics = useMemo(
    () => clinics.filter((c) => c.id && selection.value.has(c.id)),
    [clinics, selection.value]
  );

  // Bulk toggle for the verification tag. `enable=true` sets the tag,
  // `enable=false` removes it. Updates run in parallel per clinic —
  // on errors the notification turns red, but the successful updates
  // remain in place.
  const handleBulkVerification = async (enable: boolean) => {
    if (selectedClinics.length === 0) return;
    const updates = selectedClinics.map((org) => {
      const otherTags = (org.meta?.tag ?? []).filter(
        (t) => !(t.system === 'urn:hca:verification' && t.code === 'enabled')
      );
      const newTags = enable
        ? [
            ...otherTags,
            { system: 'urn:hca:verification', code: 'enabled' },
          ]
        : otherTags;
      return medplum.updateResource({
        ...org,
        meta: { ...org.meta, tag: newTags },
      });
    });
    try {
      await Promise.all(updates);
      notifications.show({
        title: t('common.saved'),
        message: t('clinics.bulkVerificationUpdated'),
        color: 'green',
      });
      queryClient.invalidateQueries({ queryKey: ['clinics'] });
      selection.clear();
    } catch {
      notifications.show({
        title: t('common.error'),
        message: t('clinics.bulkVerificationError'),
        color: 'red',
      });
    }
  };

  // ─── Columns ──────────────────────────────────────────
  const columns: Column<Organization>[] = useMemo(
    () => [
      {
        id: 'name',
        header: t('clinics.name'),
        sortable: true,
        minWidth: 240,
        cell: (org) => <Text fz="sm">{org.name}</Text>,
      },
      {
        id: 'address',
        header: t('clinics.address'),
        width: 280,
        cell: (org) => {
          const addr = org.address?.[0];
          if (!addr) {
            return (
              <Text fz="sm" c="dimmed">
                —
              </Text>
            );
          }
          const parts = [
            addr.line?.join(', '),
            addr.postalCode,
            addr.city,
          ].filter(Boolean);
          return <Text fz="sm">{parts.join(', ')}</Text>;
        },
      },
      {
        id: 'contact',
        header: t('clinics.contact'),
        width: 220,
        cell: (org) => {
          const phone = org.telecom?.find((t) => t.system === 'phone')?.value;
          const email = org.telecom?.find((t) => t.system === 'email')?.value;
          return (
            <Text fz="sm" c="dimmed">
              {email || phone || '—'}
            </Text>
          );
        },
      },
      {
        id: 'verification',
        header: t('clinics.verification'),
        sortable: true,
        width: 140,
        cell: (org) => {
          const verified = hasVerification(org);
          return (
            <Badge variant="light" color={verified ? 'green' : 'gray'}>
              {verified
                ? t('clinics.verificationEnabled')
                : t('clinics.verificationDisabled')}
            </Badge>
          );
        },
      },
    ],
    [t]
  );

  // ─── Form ────────────────────────────────────────────
  const form = useForm({
    initialValues: {
      name: '',
      facilityType: '',
      line: '',
      postalCode: '',
      city: '',
      country: '',
      phone: '',
      email: '',
      website: '',
    },
    validate: {
      name: (v) => (v.trim() ? null : t('common.error')),
    },
  });

  const handleCreate = async (values: typeof form.values) => {
    setCreating(true);
    try {
      const telecom: { system: 'phone' | 'email' | 'url'; value: string }[] =
        [];
      if (values.phone)
        telecom.push({ system: 'phone', value: values.phone });
      if (values.email)
        telecom.push({ system: 'email', value: values.email });
      if (values.website)
        telecom.push({ system: 'url', value: values.website });

      const type = values.facilityType
        ? [
            {
              coding: [
                {
                  system: 'http://help-cure-als.org/facility-type',
                  code: values.facilityType,
                  display:
                    FACILITY_TYPES.find((f) => f.value === values.facilityType)
                      ?.label || values.facilityType,
                },
              ],
            },
          ]
        : undefined;

      const created: Organization = await medplum.createResource({
        resourceType: 'Organization',
        name: values.name,
        type,
        address: [
          {
            line: values.line ? [values.line] : undefined,
            postalCode: values.postalCode || undefined,
            city: values.city || undefined,
            country: values.country || undefined,
          },
        ],
        telecom: telecom.length > 0 ? telecom : undefined,
      });

      notifications.show({
        title: t('common.saved'),
        message: t('clinics.created'),
        color: 'green',
      });
      queryClient.invalidateQueries({ queryKey: ['clinics'] });
      form.reset();
      closeCreate();
      navigate(`/clinics/${created.id}`);
    } catch {
      notifications.show({
        title: t('common.error'),
        message: t('clinics.createError'),
        color: 'red',
      });
    } finally {
      setCreating(false);
    }
  };

  // ─── Render ──────────────────────────────────────────
  if (isLoading) {
    return (
      <Center h={300}>
        <Loader color="hca-purple" />
      </Center>
    );
  }

  return (
    <Stack gap="lg" h="100%" style={{ minHeight: 0 }}>
      <PageHeader
        title={
          activeOnly ? t('clinics.activeClinicsTitle') : t('clinics.title')
        }
        subtitle={
          activeOnly
            ? t('clinics.activeClinicsSubtitle')
            : t('clinics.subtitle')
        }
        actions={
          <Button
            leftSection={<Plus size={16} />}
            color="hca-purple"
            onClick={openCreate}
          >
            {t('clinics.add')}
          </Button>
        }
      />

      {clinics.length === 0 ? (
        <Center style={{ flex: 1, minHeight: 0 }}>
          <Stack align="center" gap="sm" maw={360}>
            <ThemeIcon variant="light" size="xl" color="gray" radius="xl">
              <Building size={24} />
            </ThemeIcon>
            <Text fw={500}>{t('clinics.noClinics')}</Text>
            <Text size="sm" c="dimmed" ta="center">
              {t('clinics.noClinicsDesc')}
            </Text>
          </Stack>
        </Center>
      ) : (
        <>
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder={t('clinics.searchPlaceholder')}
            style={{
              maxWidth: 360,
              marginInline: 'var(--mantine-spacing-md)',
            }}
          />

          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <DataGrid<Organization>
              columns={columns}
              data={sort.sortedData}
              getRowId={(row) => row.id ?? ''}
              sort={sort.value}
              onSortChange={sort.set}
              selection={selection.value}
              onSelectionChange={selection.set}
              onRowClick={(row) => navigate(`/clinics/${row.id}`)}
            />
          </div>

          {selection.value.size > 0 && (
            <BulkActionBar
              selectedLabel={t('common.selected', {
                count: selection.value.size,
              })}
              onClear={() => selection.clear()}
              clearLabel={t('common.cancel')}
              clearShortcutHint="(Esc)"
            >
              <BulkPill
                variant="text"
                onClick={() => handleBulkVerification(true)}
              >
                <ShieldCheck size={14} />
                {t('clinics.bulkEnableVerification')}
              </BulkPill>
              <BulkPill
                variant="text"
                onClick={() => handleBulkVerification(false)}
              >
                <ShieldOff size={14} />
                {t('clinics.bulkDisableVerification')}
              </BulkPill>
            </BulkActionBar>
          )}
        </>
      )}

      <Modal
        opened={createOpened}
        onClose={closeCreate}
        title={t('clinics.addTitle')}
        size="lg"
      >
        <form onSubmit={form.onSubmit(handleCreate)}>
          <Stack gap="md">
            <Group grow>
              <TextInput
                label={t('clinics.name')}
                required
                {...form.getInputProps('name')}
              />
              <Select
                label={t('clinics.facilityType')}
                placeholder={t('clinics.selectFacilityType')}
                data={FACILITY_TYPES}
                clearable
                {...form.getInputProps('facilityType')}
              />
            </Group>
            <TextInput
              label={t('clinicProfile.street')}
              {...form.getInputProps('line')}
            />
            <SimpleGrid cols={3}>
              <TextInput
                label={t('clinicProfile.postalCode')}
                {...form.getInputProps('postalCode')}
              />
              <TextInput
                label={t('clinicProfile.city')}
                {...form.getInputProps('city')}
              />
              <TextInput
                label={t('clinicProfile.country')}
                {...form.getInputProps('country')}
              />
            </SimpleGrid>
            <SimpleGrid cols={3}>
              <TextInput
                label={t('clinicProfile.phone')}
                {...form.getInputProps('phone')}
              />
              <TextInput
                label={t('auth.email')}
                {...form.getInputProps('email')}
              />
              <TextInput
                label={t('clinicProfile.website')}
                {...form.getInputProps('website')}
              />
            </SimpleGrid>
            <Group justify="flex-end">
              <Button variant="default" onClick={closeCreate}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" color="teal" loading={creating}>
                {t('common.save')}
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Stack>
  );
}
