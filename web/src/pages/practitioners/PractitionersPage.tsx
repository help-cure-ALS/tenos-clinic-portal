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
  ActionIcon,
  Tooltip,
  Indicator,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useDisclosure, useLocalStorage } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { Pencil, Plus, Stethoscope, Trash2, Filter as FilterIcon } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  PageHeader,
  DataGrid,
  DataGridLayout,
  FilterPanel,
  usePanelRef,
  SearchInput,
  BulkActionBar,
  BulkPill,
  useGridSort,
  useRowSelection,
  type Column,
  type FilterPanelSection,
} from '@hca/mantine-workbench';
import { filterMatches, useViewFilterSelection, useViewState, useViewQuery, useViewSortSync } from '../../hooks/useViewState';
import { SavedViewsPanel } from '../../components/common/SavedViewsPanel';

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
  const vs = useViewState('practitioners');
  const [query, setQuery] = useViewQuery(vs);
  const { selection: filterSelection, setSelection: setFilterSelection } =
    useViewFilterSelection(vs);

  // Panel toggle (evidencespace pattern): button in the toolbar,
  // collapsed state persisted per page, applied via the panel ref.
  const filterPanelRef = usePanelRef();
  const [filterCollapsed, setFilterCollapsed] = useLocalStorage<boolean>({
    key: 'tenos-portal:practitioners:filter-collapsed',
    defaultValue: false,
  });
  useEffect(() => {
    const panel = filterPanelRef.current;
    if (!panel) return;
    if (filterCollapsed) panel.collapse();
    else panel.expand();
  }, [filterCollapsed, filterPanelRef]);

  // Badge on the filter toggle — active VALUES, same arithmetic as
  // the panel's reset pill.
  const activeFilterCount = useMemo(
    () => Array.from(filterSelection.values()).reduce((sum, set) => sum + set.size, 0),
    [filterSelection],
  );

  const filteredPractitioners = useMemo(() => {
    const q = query.trim().toLowerCase();
    return practitioners.filter((p) => {
      if (!filterMatches(filterSelection, 'qualification', p.qualification)) return false;
      if (!filterMatches(filterSelection, 'clinic', p.clinicId)) return false;
      if (!filterMatches(filterSelection, 'country', p.country)) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.clinicName.toLowerCase().includes(q) ||
        p.qualification.toLowerCase().includes(q) ||
        p.country.toLowerCase().includes(q)
      );
    });
  }, [practitioners, filterSelection, query]);

  const filterSections = useMemo<FilterPanelSection[]>(() => {
    const countBy = (fn: (p: PractitionerRow) => string) => {
      const m = new Map<string, number>();
      for (const p of practitioners) {
        const key = fn(p);
        if (key) m.set(key, (m.get(key) ?? 0) + 1);
      }
      return m;
    };
    const qualificationCounts = countBy((p) => p.qualification);
    const clinicCounts = countBy((p) => p.clinicId);
    const countryCounts = countBy((p) => p.country);
    const clinicLabel = (id: string) =>
      practitioners.find((p) => p.clinicId === id)?.clinicName ?? id;
    const toItems = (m: Map<string, number>, label: (k: string) => string) =>
      [...m.entries()]
        .map(([key, count]) => ({ key, label: label(key), count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    return [
      { key: 'qualification', title: t('practitioners.qualification'), mode: 'multi', items: toItems(qualificationCounts, (k) => k) },
      { key: 'clinic', title: t('practitioners.clinic'), mode: 'multi', items: toItems(clinicCounts, clinicLabel) },
      { key: 'country', title: t('practitioners.country'), mode: 'multi', items: toItems(countryCounts, (k) => k) },
    ];
  }, [practitioners, t]);

  const sort = useGridSort<PractitionerRow>({
    mode: 'client',
    rows: filteredPractitioners,
    initial: { sortBy: 'name', sortDir: 'asc' },
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
  const onSortChange = useViewSortSync(vs, sort);

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
    <Stack gap={0} h="100%" style={{ minHeight: 0 }}>
      {practitioners.length === 0 ? (
        <>
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
        </>
      ) : (
        <div style={{ flex: 1, minHeight: 0 }}>
        <DataGridLayout
          pageKey="practitioners"
          filterPanelRef={filterPanelRef}
          onFilterCollapsedChange={setFilterCollapsed}
          filterPanel={
            <FilterPanel
              sections={filterSections}
              selection={filterSelection}
              onChange={setFilterSelection}
              storageKey="practitioners"
              topSlot={<SavedViewsPanel vs={vs} />}
              title={t('filters.title')}
              resetLabel={t('filters.reset')}
            />
          }
          mainContent={
        <Stack gap="md" h="100%" style={{ minHeight: 0, overflow: 'hidden' }}>
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
          <Group mx="md" wrap="nowrap" gap="md">
            <Indicator
              label={String(activeFilterCount)}
              size={16}
              disabled={activeFilterCount === 0}
              color="dark"
              offset={2}
            >
              <Tooltip label={filterCollapsed ? t('filters.show') : t('filters.hide')} withArrow>
                <ActionIcon
                  variant={filterCollapsed ? 'default' : 'filled'}
                  color="gray"
                  size="lg"
                  onClick={() => setFilterCollapsed((c) => !c)}
                  aria-pressed={!filterCollapsed}
                >
                  <FilterIcon size={16} />
                </ActionIcon>
              </Tooltip>
            </Indicator>
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder={t('practitioners.searchPlaceholder')}
              style={{ flex: 1 }}
            />
            <Text fz="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
              {filteredPractitioners.length} / {practitioners.length}
            </Text>
          </Group>

          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <DataGrid<PractitionerRow>
              columns={columns}
              data={sort.sortedData}
              getRowId={(row) => row.id}
              sort={sort.value}
              onSortChange={onSortChange}
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
        </Stack>
          }
        />
        </div>
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
