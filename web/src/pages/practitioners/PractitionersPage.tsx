import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Stack,
  Text,
  TextInput,
  Group,
  Button,
  Loader,
  Center,
  Modal,
  Select,
  ThemeIcon,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { Pencil, Plus, Stethoscope, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
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

import {
  usePractitioners,
  type PractitionerRow,
} from '../../hooks/usePractitioners';
import { useClinics } from '../../hooks/useClinics';
import { medplum } from '../../lib/medplum';

// Wave UI.22 (2026-05-20) — PractitionersPage on Workbench.
// PageHeader + SearchInput + DataGrid with selection (bulk delete) +
// inline edit/delete actions per row. The modal form for create/edit
// stays unchanged.

interface PractitionerFormValues {
  prefix: string;
  given: string;
  family: string;
  qualification: string;
  role: string;
  email: string;
  phone: string;
  organizationRef: string;
}

const EMPTY_FORM: PractitionerFormValues = {
  prefix: '',
  given: '',
  family: '',
  qualification: '',
  role: '',
  email: '',
  phone: '',
  organizationRef: '',
};

export function PractitionersPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: practitioners = [], isLoading } = usePractitioners();
  const { data: clinics = [] } = useClinics();

  const [modalOpened, { open: openModal, close: closeModal }] =
    useDisclosure(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // ─── Suche + Sort + Selection ─────────────────────────
  const [query, setQuery] = useState('');

  const filteredPractitioners = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return practitioners;
    return practitioners.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.clinicName.toLowerCase().includes(q) ||
        p.qualification.toLowerCase().includes(q) ||
        p.country.toLowerCase().includes(q)
    );
  }, [practitioners, query]);

  const sort = useGridSort<PractitionerRow>({
    mode: 'client',
    rows: filteredPractitioners,
    initial: { columnId: 'name', direction: 'asc' },
    getValue: (row, columnId) => {
      switch (columnId) {
        case 'name':
          return row.name;
        case 'qualification':
          return row.qualification;
        case 'role':
          return row.role;
        case 'clinic_name':
          return row.clinicName;
        case 'country':
          return row.country;
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

  const selectedPractitioners = useMemo(
    () => practitioners.filter((p) => selection.value.has(p.id)),
    [practitioners, selection.value]
  );

  // ─── Form ────────────────────────────────────────────
  const form = useForm<PractitionerFormValues>({
    initialValues: { ...EMPTY_FORM },
    validate: {
      family: (v) => (v.trim() ? null : t('common.error')),
    },
  });

  const clinicOptions = clinics.map((c) => ({
    value: c.id || '',
    label: c.name || '—',
  }));

  const openCreateModal = () => {
    setEditingId(null);
    form.setValues({ ...EMPTY_FORM });
    openModal();
  };

  const openEditModal = (row: PractitionerRow) => {
    setEditingId(row.id);
    // Parse name parts from the full name
    const nameParts = row.name.split(' ');
    let prefix = '';
    let given = '';
    let family = '';
    const prefixParts: string[] = [];
    let i = 0;
    while (
      i < nameParts.length &&
      /^(Prof\.|Dr\.|PD|Univ\.-Prof\.|Doz\.|med\.|rer\.|nat\.|phil\.)$/i.test(
        nameParts[i]
      )
    ) {
      prefixParts.push(nameParts[i]);
      i++;
    }
    prefix = prefixParts.join(' ');
    const remaining = nameParts.slice(i);
    if (remaining.length >= 2) {
      family = remaining[remaining.length - 1];
      given = remaining.slice(0, -1).join(' ');
    } else if (remaining.length === 1) {
      family = remaining[0];
    }

    form.setValues({
      prefix,
      given,
      family,
      qualification: row.qualification,
      role: row.role,
      email: row.email,
      phone: row.phone,
      organizationRef: row.clinicId,
    });
    openModal();
  };

  const handleSubmit = async (values: PractitionerFormValues) => {
    setSubmitting(true);
    try {
      const nameText = [values.prefix, values.given, values.family]
        .filter(Boolean)
        .join(' ');
      const extensions: { url: string; valueString: string }[] = [];
      if (values.role)
        extensions.push({
          url: 'http://help-cure-als.org/ext/role',
          valueString: values.role,
        });
      if (values.organizationRef)
        extensions.push({
          url: 'http://help-cure-als.org/ext/organization-ref',
          valueString: values.organizationRef,
        });

      const telecom: { system: 'email' | 'phone'; value: string }[] = [];
      if (values.email) telecom.push({ system: 'email', value: values.email });
      if (values.phone) telecom.push({ system: 'phone', value: values.phone });

      const selectedOrg = values.organizationRef
        ? clinics.find((c) => c.id === values.organizationRef)
        : undefined;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resource: any = {
        resourceType: 'Practitioner',
        name: [
          {
            text: nameText,
            family: values.family,
            given: values.given ? [values.given] : undefined,
            prefix: values.prefix ? [values.prefix] : undefined,
          },
        ],
        qualification: values.qualification
          ? [{ code: { text: values.qualification } }]
          : undefined,
        telecom: telecom.length > 0 ? telecom : undefined,
        extension: extensions.length > 0 ? extensions : undefined,
        address: selectedOrg?.address || undefined,
      };

      if (editingId) {
        const existing = await medplum.readResource('Practitioner', editingId);
        await medplum.updateResource({
          ...existing,
          ...resource,
          id: editingId,
        });
        notifications.show({
          title: t('common.saved'),
          message: t('practitioners.editSaved'),
          color: 'green',
        });
      } else {
        await medplum.createResource(resource);
        notifications.show({
          title: t('common.saved'),
          message: t('practitioners.created'),
          color: 'green',
        });
      }

      queryClient.invalidateQueries({ queryKey: ['practitioners'] });
      form.reset();
      closeModal();
      setEditingId(null);
    } catch {
      notifications.show({
        title: t('common.error'),
        message: t('practitioners.createError'),
        color: 'red',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleBulkDelete = () => {
    if (selectedPractitioners.length === 0) return;
    modals.openConfirmModal({
      title: t('practitioners.deleteTitle'),
      children: (
        <Text size="sm">
          {t('practitioners.bulkDeleteConfirm', {
            count: selectedPractitioners.length,
          })}
        </Text>
      ),
      labels: { confirm: t('common.delete'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          await Promise.all(
            selectedPractitioners.map((p) =>
              medplum.deleteResource('Practitioner', p.id)
            )
          );
          notifications.show({
            message: t('practitioners.deleted'),
            color: 'green',
          });
          queryClient.invalidateQueries({ queryKey: ['practitioners'] });
          selection.clear();
        } catch {
          notifications.show({
            title: t('common.error'),
            message: t('practitioners.deleteError'),
            color: 'red',
          });
        }
      },
    });
  };

  // ─── Columns ──────────────────────────────────────────
  const columns: Column<PractitionerRow>[] = useMemo(
    () => [
      {
        id: 'name',
        header: t('practitioners.name'),
        sortable: true,
        minWidth: 240,
        cell: (row) => <Text fz="sm">{row.name}</Text>,
      },
      {
        id: 'qualification',
        header: t('practitioners.qualification'),
        sortable: true,
        width: 180,
        cell: (row) => (
          <Text fz="sm" c="dimmed">
            {row.qualification || '—'}
          </Text>
        ),
      },
      {
        id: 'role',
        header: t('practitioners.role'),
        sortable: true,
        width: 200,
        cell: (row) => (
          <Text fz="sm" c="dimmed">
            {row.role || '—'}
          </Text>
        ),
      },
      {
        id: 'clinic_name',
        header: t('practitioners.clinic'),
        sortable: true,
        width: 220,
        cell: (row) => <Text fz="sm">{row.clinicName}</Text>,
      },
      {
        id: 'country',
        header: t('practitioners.country'),
        sortable: true,
        width: 100,
        cell: (row) => <Text fz="sm">{row.country}</Text>,
      },
    ],
    [t]
  );

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
        title={t('practitioners.title')}
        subtitle={t('practitioners.subtitle')}
        actions={
          <Button
            leftSection={<Plus size={16} />}
            color="hca-purple"
            onClick={openCreateModal}
          >
            {t('practitioners.add')}
          </Button>
        }
      />

      {practitioners.length === 0 ? (
        <Center style={{ flex: 1, minHeight: 0 }}>
          <Stack align="center" gap="sm" maw={360}>
            <ThemeIcon variant="light" size="xl" color="gray" radius="xl">
              <Stethoscope size={24} />
            </ThemeIcon>
            <Text fw={500}>{t('practitioners.noPractitioners')}</Text>
            <Text size="sm" c="dimmed" ta="center">
              {t('practitioners.noPractitionersDesc')}
            </Text>
          </Stack>
        </Center>
      ) : (
        <>
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder={t('practitioners.searchPlaceholder')}
            style={{
              maxWidth: 360,
              marginInline: 'var(--mantine-spacing-md)',
            }}
          />

          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <DataGrid<PractitionerRow>
              columns={columns}
              data={sort.sortedData}
              getRowId={(row) => row.id}
              sort={sort.value}
              onSortChange={sort.set}
              selection={selection.value}
              onSelectionChange={selection.set}
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
                onClick={() => {
                  const first = selectedPractitioners[0];
                  if (first) openEditModal(first);
                }}
                disabled={selection.value.size !== 1}
                tooltip={
                  selection.value.size !== 1
                    ? t('practitioners.editOnlyOne')
                    : undefined
                }
              >
                <Pencil size={14} />
                {t('common.edit')}
              </BulkPill>
              <BulkPill variant="text" onClick={handleBulkDelete}>
                <Trash2 size={14} />
                {t('common.delete')}
              </BulkPill>
            </BulkActionBar>
          )}
        </>
      )}

      <Modal
        opened={modalOpened}
        onClose={() => {
          closeModal();
          setEditingId(null);
        }}
        title={
          editingId
            ? t('practitioners.editTitle')
            : t('practitioners.addTitle')
        }
        size="lg"
      >
        <form onSubmit={form.onSubmit(handleSubmit)}>
          <Stack gap="md">
            <Group grow>
              <TextInput
                label={t('practitioners.prefix')}
                placeholder="Prof. Dr."
                {...form.getInputProps('prefix')}
              />
              <TextInput
                label={t('practitioners.firstName')}
                {...form.getInputProps('given')}
              />
              <TextInput
                label={t('practitioners.lastName')}
                required
                {...form.getInputProps('family')}
              />
            </Group>
            <Group grow>
              <TextInput
                label={t('practitioners.qualification')}
                placeholder={t('practitioners.qualificationPlaceholder')}
                {...form.getInputProps('qualification')}
              />
              <TextInput
                label={t('practitioners.roleAtClinic')}
                placeholder={t('practitioners.roleAtClinicPlaceholder')}
                {...form.getInputProps('role')}
              />
            </Group>
            <Group grow>
              <TextInput
                label={t('auth.email')}
                {...form.getInputProps('email')}
              />
              <TextInput
                label={t('practitioners.phone')}
                {...form.getInputProps('phone')}
              />
            </Group>
            <Select
              label={t('practitioners.clinic')}
              placeholder={t('practitioners.selectClinic')}
              data={clinicOptions}
              searchable
              clearable
              {...form.getInputProps('organizationRef')}
            />
            <Group justify="flex-end">
              <Button
                variant="default"
                onClick={() => {
                  closeModal();
                  setEditingId(null);
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="submit"
                color="teal"
                loading={submitting}
              >
                {t('common.save')}
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Stack>
  );
}
