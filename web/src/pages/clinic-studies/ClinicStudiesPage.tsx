import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Stack,
  Text,
  Button,
  Badge,
  Drawer,
  Switch,
  Loader,
  Center,
  ThemeIcon,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';

import type { ResearchStudy } from '@medplum/fhirtypes';
import { FlaskConical, Plus, Trash2 } from 'lucide-react';
import {
  PageHeader,
  DataGrid,
  BulkActionBar,
  BulkPill,
  SearchInput,
  useGridSort,
  useRowSelection,
  type Column,
} from '@hca/mantine-workbench';

import { useAuthStore } from '../../stores/auth';
import { useStudies } from '../../hooks/useStudies';
import {
  useClinicStudyList,
  useSaveClinicStudies,
  useToggleStudyOpen,
} from '../../hooks/useClinicStudies';
import { StudyDetailDrawer } from '../../components/common/StudyDetailDrawer';

// Wave UI.11 (2026-05-20) — ClinicStudiesPage on Workbench for
// the main list. Pattern identical to TokensPage/UsersPage:
// PageHeader + SearchInput + DataGrid + BulkActionBar. The
// "add studies" drawer keeps the old DataTable picker; that is
// a separate modal workflow and not part of this wave.

const STATUS_COLOR: Record<string, string> = {
  active: 'green',
  completed: 'blue',
  draft: 'gray',
  'in-review': 'orange',
};

export function ClinicStudiesPage() {
  const { t } = useTranslation();
  const { organization } = useAuthStore();
  const clinicId = organization?.id;

  const { data: clinicStudyData, isLoading: studiesListLoading } =
    useClinicStudyList(clinicId);
  const { data: allStudies = [], isLoading: allStudiesLoading } = useStudies();
  const saveStudies = useSaveClinicStudies();
  const toggleOpen = useToggleStudyOpen();

  // Drawer state — DataGrid-basiert seit UI.11
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerSearch, setDrawerSearch] = useState('');
  const drawerSelection = useRowSelection();

  // Detail drawer
  const [detailStudy, setDetailStudy] = useState<ResearchStudy | null>(null);

  // Assigned studies as full ResearchStudy objects
  const assignedStudies = useMemo(() => {
    const ids = new Set(clinicStudyData?.studyIds ?? []);
    return allStudies.filter((s) => s.id && ids.has(s.id));
  }, [allStudies, clinicStudyData?.studyIds]);

  const openStudyIds = useMemo(
    () => new Set(clinicStudyData?.openStudyIds ?? []),
    [clinicStudyData?.openStudyIds]
  );

  // ─── Search + Sort + Selection (Hauptliste) ────────────
  const [query, setQuery] = useState('');

  const filteredAssigned = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return assignedStudies;
    return assignedStudies.filter((s) =>
      (s.title ?? '').toLowerCase().includes(q)
    );
  }, [assignedStudies, query]);

  const sort = useGridSort<ResearchStudy>({
    mode: 'client',
    rows: filteredAssigned,
    initial: { columnId: 'title', direction: 'asc' },
    getValue: (row, columnId) => {
      switch (columnId) {
        case 'title':
          return row.title ?? '';
        case 'status':
          return row.status ?? '';
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

  // Derive the selected studies from the ID set — we need the
  // full records for the confirm dialog (title as text).
  const selectedStudies = useMemo(
    () => assignedStudies.filter((s) => s.id && selection.value.has(s.id)),
    [assignedStudies, selection.value]
  );

  // ─── Columns ──────────────────────────────────────────
  const columns: Column<ResearchStudy>[] = useMemo(
    () => [
      {
        id: 'title',
        header: t('studies.studyTitle'),
        sortable: true,
        minWidth: 280,
        cell: (s) => <Text fz="sm">{s.title}</Text>,
      },
      {
        id: 'status',
        header: t('common.status'),
        sortable: true,
        width: 140,
        cell: (s) => (
          <Badge variant="light" color={STATUS_COLOR[s.status ?? ''] || 'gray'}>
            {s.status || '—'}
          </Badge>
        ),
      },
      {
        id: 'phase',
        header: t('studies.phase'),
        width: 140,
        cell: (s) => (
          <Text fz="xs">
            {s.phase?.text || s.phase?.coding?.[0]?.display || '—'}
          </Text>
        ),
      },
      {
        id: 'open_for_applications',
        header: t('clinicProfile.openForApplications'),
        width: 200,
        cell: (s) => (
          <div onClick={(e) => e.stopPropagation()}>
            <Switch
              checked={openStudyIds.has(s.id ?? '')}
              onChange={(e) => {
                if (!clinicId || !s.id || !clinicStudyData?.list) return;
                toggleOpen.mutate({
                  clinicId,
                  studyId: s.id,
                  open: e.currentTarget.checked,
                  existingList: clinicStudyData.list,
                });
              }}
              size="sm"
            />
          </div>
        ),
      },
    ],
    [t, openStudyIds, clinicId, clinicStudyData?.list, toggleOpen]
  );

  // ─── Drawer handlers ──────────────────────────────────
  const handleOpenDrawer = () => {
    // Pre-populate the selection with the currently assigned study
    // IDs so the drawer shows the current state and the user can
    // select/deselect from there.
    drawerSelection.set(new Set(clinicStudyData?.studyIds ?? []));
    setDrawerSearch('');
    setDrawerOpen(true);
  };

  const handleSaveStudies = async () => {
    if (!clinicId) return;
    try {
      await saveStudies.mutateAsync({
        clinicId,
        studyIds: [...drawerSelection.value],
        existingList: clinicStudyData?.list,
      });
      notifications.show({
        title: t('common.saved'),
        message: t('clinicProfile.studiesSaved'),
        color: 'green',
      });
      setDrawerOpen(false);
    } catch {
      notifications.show({
        title: t('common.error'),
        message: t('clinicProfile.studiesSaveError'),
        color: 'red',
      });
    }
  };

  // Drawer list search-filtered + client-sorted by title.
  const drawerStudies = useMemo(() => {
    const q = drawerSearch.toLowerCase().trim();
    if (!q) return allStudies;
    return allStudies.filter((s) => s.title?.toLowerCase().includes(q));
  }, [allStudies, drawerSearch]);

  const drawerSort = useGridSort<ResearchStudy>({
    mode: 'client',
    rows: drawerStudies,
    initial: { columnId: 'title', direction: 'asc' },
    getValue: (row, columnId) => {
      switch (columnId) {
        case 'title':
          return row.title ?? '';
        case 'status':
          return row.status ?? '';
        default:
          return null;
      }
    },
  });

  // Columns for the picker grid — no switch, no onRowClick (row click
  // toggles the selection automatically via DataGrid's selection logic).
  const drawerColumns: Column<ResearchStudy>[] = useMemo(
    () => [
      {
        id: 'title',
        header: t('studies.studyTitle'),
        sortable: true,
        minWidth: 240,
        cell: (s) => <Text fz="sm">{s.title}</Text>,
      },
      {
        id: 'status',
        header: t('common.status'),
        sortable: true,
        width: 110,
        cell: (s) => (
          <Badge
            variant="light"
            size="sm"
            color={STATUS_COLOR[s.status ?? ''] || 'gray'}
          >
            {s.status || '—'}
          </Badge>
        ),
      },
      {
        id: 'phase',
        header: t('studies.phase'),
        width: 110,
        cell: (s) => (
          <Text fz="xs">
            {s.phase?.text || s.phase?.coding?.[0]?.display || '—'}
          </Text>
        ),
      },
    ],
    [t]
  );

  // ─── Remove handler (main list) ───────────────────────
  const handleRemoveSelected = () => {
    const count = selectedStudies.length;
    // i18next plural suffixes: _one for count=1, _other otherwise.
    // For a single study we show the title in the confirm text,
    // for several only the count.
    const firstTitle = selectedStudies[0]?.title || selectedStudies[0]?.id;
    modals.openConfirmModal({
      title: t('clinicProfile.removeStudyTitle', { count }),
      children: (
        <Text size="sm">
          {t('clinicProfile.removeStudyConfirm', {
            count,
            title: firstTitle,
          })}
        </Text>
      ),
      labels: { confirm: t('common.remove'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        if (!clinicId) return;
        const removeIds = new Set(selectedStudies.map((s) => s.id));
        const newIds = (clinicStudyData?.studyIds ?? []).filter(
          (id) => !removeIds.has(id)
        );
        try {
          await saveStudies.mutateAsync({
            clinicId,
            studyIds: newIds,
            existingList: clinicStudyData?.list,
          });
          selection.clear();
          notifications.show({
            title: t('common.saved'),
            message: t('clinicProfile.studiesSaved'),
            color: 'green',
          });
        } catch {
          notifications.show({
            title: t('common.error'),
            message: t('clinicProfile.studiesSaveError'),
            color: 'red',
          });
        }
      },
    });
  };

  // ─── Render ──────────────────────────────────────────
  if (!organization || studiesListLoading || allStudiesLoading) {
    return (
      <Center h={300}>
        <Loader color="hca-purple" />
      </Center>
    );
  }

  return (
    <Stack gap="lg" h="100%" style={{ minHeight: 0 }}>
      <PageHeader
        title={t('clinicProfile.studiesTitle')}
        subtitle={t('clinicProfile.studiesSubtitle')}
        actions={
          <Button
            leftSection={<Plus size={16} />}
            color="hca-purple"
            onClick={handleOpenDrawer}
          >
            {t('clinicProfile.addStudy')}
          </Button>
        }
      />

      {assignedStudies.length === 0 ? (
        <Center style={{ flex: 1, minHeight: 0 }}>
          <Stack align="center" gap="sm" maw={360}>
            <ThemeIcon variant="light" size="xl" color="gray" radius="xl">
              <FlaskConical size={24} />
            </ThemeIcon>
            <Text fw={500}>{t('clinicProfile.studiesEmpty')}</Text>
            <Text size="sm" c="dimmed" ta="center">
              {t('clinicProfile.studiesEmptyDesc')}
            </Text>
          </Stack>
        </Center>
      ) : (
        <>
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder={t('clinicProfile.searchPlaceholder')}
            style={{
              maxWidth: 360,
              marginInline: 'var(--mantine-spacing-md)',
            }}
          />

          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <DataGrid<ResearchStudy>
              columns={columns}
              data={sort.sortedData}
              getRowId={(row) => row.id ?? ''}
              sort={sort.value}
              onSortChange={sort.set}
              selection={selection.value}
              onSelectionChange={selection.set}
              onRowClick={(row) => setDetailStudy(row)}
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
              <BulkPill variant="text" onClick={handleRemoveSelected}>
                <Trash2 size={14} />
                {t('clinicProfile.removeStudy')}
              </BulkPill>
            </BulkActionBar>
          )}
        </>
      )}

      {/* Drawer: Search & add studies — DataGrid picker since UI.11.
          Row click toggles the selection automatically via DataGrid;
          the selection column (checkbox) is inserted by the library. */}
      <Drawer
        opened={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={t('clinicProfile.searchTitle')}
        position="right"
        size="lg"
      >
        <Stack gap="md" h="calc(100vh - 120px)">
          <SearchInput
            value={drawerSearch}
            onChange={setDrawerSearch}
            placeholder={t('clinicProfile.searchPlaceholder')}
          />

          <Text size="sm" c="dimmed">
            {t('clinicProfile.studiesCount', {
              count: drawerSelection.value.size,
            })}
          </Text>

          <div style={{ flex: 1, overflow: 'auto', minHeight: 200 }}>
            <DataGrid<ResearchStudy>
              columns={drawerColumns}
              data={drawerSort.sortedData}
              getRowId={(row) => row.id ?? ''}
              sort={drawerSort.value}
              onSortChange={drawerSort.set}
              selection={drawerSelection.value}
              onSelectionChange={drawerSelection.set}
            />
          </div>

          <Button
            color="teal"
            onClick={handleSaveStudies}
            loading={saveStudies.isPending}
            fullWidth
          >
            {t('clinicProfile.searchApply')}
          </Button>
        </Stack>
      </Drawer>

      <StudyDetailDrawer
        study={detailStudy}
        opened={!!detailStudy}
        onClose={() => setDetailStudy(null)}
        isOpenForApplications={
          detailStudy?.id ? openStudyIds.has(detailStudy.id) : undefined
        }
      />
    </Stack>
  );
}

