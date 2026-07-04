import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  ThemeIcon,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { ArrowLeftRight, Building, Check, Plus, X } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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

import { useSuppliers } from '../../hooks/useSuppliers';
import {
  medplum,
  SUPPLIER_SPECIALTY_SYSTEM,
  SUPPLIER_TAG,
} from '../../lib/medplum';
import {
  getSupplierDeliveryStatus,
  type SupplierDeliveryStatus,
} from '../../lib/supplierApi';

// Wave UI.20 (2026-05-20) — SuppliersPage on Workbench, pattern
// identical to ClinicsPage. Header bar with two actions: workflow
// policies and add supplier. No selection mode — row click leads
// to the detail page.

function toSpecialtyCode(input: string): string {
  return (
    input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'general'
  );
}

function hasSupplierTag(org: Organization): boolean {
  return (org.meta?.tag ?? []).some(
    (tag) => tag.system === 'urn:hca:supplier' && tag.code === 'enabled'
  );
}

function getSpecialty(org: Organization): string {
  return (
    org.type?.[0]?.coding?.[0]?.display ||
    org.type?.[0]?.coding?.[0]?.code ||
    '—'
  );
}

export function SuppliersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: suppliers = [], isLoading } = useSuppliers();

  const [createOpened, { open: openCreate, close: closeCreate }] =
    useDisclosure(false);
  const [creating, setCreating] = useState(false);

  // ─── Delivery-Status pro Supplier ──────────────────────
  const deliveryStatusesQuery = useQuery({
    queryKey: [
      'supplier-delivery-statuses',
      suppliers.map((s) => s.id).filter(Boolean).join(','),
    ],
    enabled: suppliers.length > 0,
    queryFn: async () => {
      const rows = await Promise.all(
        suppliers
          .filter(
            (s): s is Organization & { id: string } =>
              typeof s.id === 'string' && s.id.length > 0
          )
          .map(async (supplier) => {
            try {
              const status = await getSupplierDeliveryStatus(supplier.id);
              return [supplier.id, status] as const;
            } catch {
              return [supplier.id, null] as const;
            }
          })
      );
      return Object.fromEntries(rows) as Record<
        string,
        SupplierDeliveryStatus | null
      >;
    },
  });

  // ─── Suche + Sort ──────────────────────────────────────
  const [query, setQuery] = useState('');

  const filteredSuppliers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter(
      (org) =>
        (org.name ?? '').toLowerCase().includes(q) ||
        getSpecialty(org).toLowerCase().includes(q)
    );
  }, [suppliers, query]);

  const sort = useGridSort<Organization>({
    mode: 'client',
    rows: filteredSuppliers,
    initial: { columnId: 'name', direction: 'asc' },
    getValue: (row, columnId) => {
      switch (columnId) {
        case 'name':
          return row.name ?? '';
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

  const selectedSuppliers = useMemo(
    () => suppliers.filter((s) => s.id && selection.value.has(s.id)),
    [suppliers, selection.value]
  );

  // Bulk toggle: sets/removes the `urn:hca:supplier=enabled` tag.
  // `Organization.active` is adjusted in parallel so FHIR searches
  // with `active=true` stay consistent.
  const handleBulkActive = async (enable: boolean) => {
    if (selectedSuppliers.length === 0) return;
    const updates = selectedSuppliers.map((org) => {
      const otherTags = (org.meta?.tag ?? []).filter(
        (t) => !(t.system === 'urn:hca:supplier' && t.code === 'enabled')
      );
      const newTags = enable
        ? [...otherTags, { system: 'urn:hca:supplier', code: 'enabled' }]
        : otherTags;
      return medplum.updateResource({
        ...org,
        active: enable,
        meta: { ...org.meta, tag: newTags },
      });
    });
    try {
      await Promise.all(updates);
      notifications.show({
        title: t('common.saved'),
        message: t('suppliers.bulkStatusUpdated'),
        color: 'green',
      });
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      selection.clear();
    } catch {
      notifications.show({
        title: t('common.error'),
        message: t('suppliers.bulkStatusError'),
        color: 'red',
      });
    }
  };

  // ─── Columns ──────────────────────────────────────────
  const columns: Column<Organization>[] = useMemo(
    () => [
      {
        id: 'name',
        header: t('suppliers.name'),
        sortable: true,
        minWidth: 220,
        cell: (org) => <Text fz="sm">{org.name}</Text>,
      },
      {
        id: 'specialty',
        header: t('suppliers.specialty'),
        width: 180,
        cell: (org) => <Text fz="sm">{getSpecialty(org)}</Text>,
      },
      {
        id: 'country',
        header: t('suppliers.country'),
        width: 120,
        cell: (org) => (
          <Text fz="sm">{org.address?.[0]?.country || '—'}</Text>
        ),
      },
      {
        id: 'contact',
        header: t('suppliers.contact'),
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
        id: 'enabled',
        header: t('suppliers.enabled'),
        width: 120,
        cell: (org) => (
          <Badge
            variant="light"
            color={hasSupplierTag(org) ? 'green' : 'gray'}
          >
            {hasSupplierTag(org) ? t('common.active') : t('common.inactive')}
          </Badge>
        ),
      },
      {
        id: 'delivery_status',
        header: t('suppliers.deliveryStateTitle'),
        width: 150,
        cell: (org) => {
          const status = org.id
            ? deliveryStatusesQuery.data?.[org.id]
            : null;
          if (!status) {
            return (
              <Text fz="sm" c="dimmed">
                —
              </Text>
            );
          }
          const color =
            status.status === 'healthy'
              ? 'green'
              : status.status === 'retrying'
                ? 'yellow'
                : 'red';
          return (
            <Badge variant="light" color={color}>
              {t(`suppliers.deliveryState.${status.status}`)}
            </Badge>
          );
        },
      },
    ],
    [t, deliveryStatusesQuery.data]
  );

  // ─── Form ────────────────────────────────────────────
  const form = useForm({
    initialValues: {
      name: '',
      specialty: '',
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
      specialty: (v) => (v.trim() ? null : t('common.error')),
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

      const created: Organization = await medplum.createResource({
        resourceType: 'Organization',
        active: true,
        name: values.name,
        type: [
          {
            coding: [
              {
                system: SUPPLIER_SPECIALTY_SYSTEM,
                code: toSpecialtyCode(values.specialty),
                display: values.specialty,
              },
            ],
          },
        ],
        address: [
          {
            line: values.line ? [values.line] : undefined,
            postalCode: values.postalCode || undefined,
            city: values.city || undefined,
            country: values.country || undefined,
          },
        ],
        telecom: telecom.length > 0 ? telecom : undefined,
        meta: {
          tag: [
            {
              system: SUPPLIER_TAG.split('|')[0],
              code: SUPPLIER_TAG.split('|')[1],
            },
          ],
        },
      });

      notifications.show({
        title: t('common.saved'),
        message: t('suppliers.created'),
        color: 'green',
      });
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      form.reset();
      closeCreate();
      navigate(`/suppliers/${created.id}`);
    } catch {
      notifications.show({
        title: t('common.error'),
        message: t('suppliers.createError'),
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
        title={t('suppliers.title')}
        subtitle={t('suppliers.subtitle')}
        actions={
          <Group gap="sm">
            <Button
              variant="default"
              leftSection={<ArrowLeftRight size={16} />}
              onClick={() => navigate('/supplier-workflow-policies')}
            >
              {t('suppliers.workflowOpen')}
            </Button>
            <Button
              leftSection={<Plus size={16} />}
              color="hca-purple"
              onClick={openCreate}
            >
              {t('suppliers.add')}
            </Button>
          </Group>
        }
      />

      {suppliers.length === 0 ? (
        <Center style={{ flex: 1, minHeight: 0 }}>
          <Stack align="center" gap="sm" maw={360}>
            <ThemeIcon variant="light" size="xl" color="gray" radius="xl">
              <Building size={24} />
            </ThemeIcon>
            <Text fw={500}>{t('suppliers.noSuppliers')}</Text>
            <Text size="sm" c="dimmed" ta="center">
              {t('suppliers.noSuppliersDesc')}
            </Text>
          </Stack>
        </Center>
      ) : (
        <>
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder={t('suppliers.searchPlaceholder')}
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
              onRowClick={(row) => navigate(`/suppliers/${row.id}`)}
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
                onClick={() => handleBulkActive(true)}
              >
                <Check size={14} />
                {t('suppliers.bulkActivate')}
              </BulkPill>
              <BulkPill
                variant="text"
                onClick={() => handleBulkActive(false)}
              >
                <X size={14} />
                {t('suppliers.bulkDeactivate')}
              </BulkPill>
            </BulkActionBar>
          )}
        </>
      )}

      <Modal
        opened={createOpened}
        onClose={closeCreate}
        title={t('suppliers.addTitle')}
        size="lg"
      >
        <form onSubmit={form.onSubmit(handleCreate)}>
          <Stack gap="md">
            <Group grow>
              <TextInput
                label={t('suppliers.name')}
                required
                {...form.getInputProps('name')}
              />
              <TextInput
                label={t('suppliers.specialty')}
                required
                {...form.getInputProps('specialty')}
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
