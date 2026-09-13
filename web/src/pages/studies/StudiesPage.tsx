import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Stack,
  Text,
  Badge,
  Loader,
  Center,
  ThemeIcon,
  Modal,
  Button,
  Group,
  ActionIcon,
  Tooltip,
  Indicator,
} from '@mantine/core';
import { useDisclosure, useLocalStorage } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { useQueryClient } from '@tanstack/react-query';
import { FlaskConical, Trash2, Filter as FilterIcon } from 'lucide-react';
import type { ResearchStudy } from '@medplum/fhirtypes';
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

import { useStudies } from '../../hooks/useStudies';
import { useExcludedStudies } from '../../hooks/useExcludedStudies';
import { StudyDetailDrawer } from '../../components/common/StudyDetailDrawer';
import { excludeStudies, type ExcludeStudyInput } from '../../lib/studiesSyncApi';

const STATUS_COLOR: Record<string, string> = {
  active: 'green',
  completed: 'blue',
  draft: 'gray',
  'in-review': 'orange',
  approved: 'cyan',
  'temporarily-closed-to-accrual': 'yellow',
  withdrawn: 'red',
};

const CTGOV_SYSTEM = 'https://clinicaltrials.gov';
const CTIS_SYSTEM = 'https://euclinicaltrials.eu';

/**
 * Builds the payload for the delete endpoint from a ResearchStudy:
 * `studyId` for the Medplum delete + all known registry identifiers
 * for the permanent exclusion list.
 */
function toExcludeInput(study: ResearchStudy): ExcludeStudyInput {
  const idents = (study.identifier ?? [])
    .filter((i) => i.system && i.value && (i.system === CTGOV_SYSTEM || i.system === CTIS_SYSTEM))
    .map((i) => ({ system: i.system as string, value: i.value as string }));
  return {
    studyId: study.id,
    identifiers: idents,
  };
}

export function StudiesPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: studies = [], isLoading } = useStudies();
  const { data: excluded = [] } = useExcludedStudies();
  const [detailStudy, setDetailStudy] = useState<ResearchStudy | null>(null);

  // Excludes = source of truth. No matter what Medplum's search index
  // says, a study with an identifier on the exclusion list is hidden
  // client-side. This makes the display deterministic with respect
  // to Medplum's eventual consistency and to cases where the Medplum
  // delete fails silently (access policy, race, cache).
  const excludedKeys = useMemo(() => {
    return new Set(excluded.map((e) => `${e.identifier_system}|${e.identifier_value}`));
  }, [excluded]);

  const isExcluded = (study: ResearchStudy): boolean => {
    if (excludedKeys.size === 0) return false;
    return (study.identifier ?? []).some(
      (i) => i.system && i.value && excludedKeys.has(`${i.system}|${i.value}`),
    );
  };

  // ─── Search + sort + selection ─────────────────────────
  const vs = useViewState('studies');
  const [query, setQuery] = useViewQuery(vs);
  const { selection: filterSelection, setSelection: setFilterSelection } =
    useViewFilterSelection(vs);

  // Panel toggle (evidencespace pattern): button in the toolbar,
  // collapsed state persisted per page, applied via the panel ref.
  const filterPanelRef = usePanelRef();
  const [filterCollapsed, setFilterCollapsed] = useLocalStorage<boolean>({
    key: 'tenos-portal:studies:filter-collapsed',
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

  const studyPhase = (s: ResearchStudy): string =>
    s.phase?.text || s.phase?.coding?.[0]?.display || '';

  const filteredStudies = useMemo(() => {
    const q = query.trim().toLowerCase();
    return studies.filter((s) => {
      if (isExcluded(s)) return false;
      if (!filterMatches(filterSelection, 'status', s.status ?? '')) return false;
      if (!filterMatches(filterSelection, 'phase', studyPhase(s))) return false;
      return !q || (s.title ?? '').toLowerCase().includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studies, query, filterSelection, excludedKeys]);

  const filterSections = useMemo<FilterPanelSection[]>(() => {
    const visible = studies.filter((s) => !isExcluded(s));
    const countBy = (fn: (s: ResearchStudy) => string) => {
      const m = new Map<string, number>();
      for (const s of visible) {
        const key = fn(s);
        if (key) m.set(key, (m.get(key) ?? 0) + 1);
      }
      return m;
    };
    const toItems = (m: Map<string, number>) =>
      [...m.entries()]
        .map(([key, count]) => ({ key, label: key, count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    return [
      { key: 'status', title: t('common.status'), mode: 'multi', items: toItems(countBy((s) => s.status ?? '')) },
      { key: 'phase', title: t('studies.phase'), mode: 'multi', items: toItems(countBy(studyPhase)) },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studies, excludedKeys, t]);

  const sort = useGridSort<ResearchStudy>({
    mode: 'client',
    rows: filteredStudies,
    initial: { sortBy: 'title', sortDir: 'asc' },
    getValue: (row, columnId) => {
      switch (columnId) {
        case 'title':
          return row.title ?? '';
        case 'status':
          return row.status ?? '';
        case 'period_start':
          return row.period?.start ? new Date(row.period.start) : null;
        default:
          return null;
      }
    },
  });
  const onSortChange = useViewSortSync(vs, sort);

  // The selection hook optionally takes an iterable of initial IDs;
  // we start with an empty selection. The getRowId logic lives on the DataGrid.
  const selection = useRowSelection();

  // ─── Delete flow ───────────────────────────────────────
  const [confirmOpened, { open: openConfirm, close: closeConfirm }] = useDisclosure(false);
  const [deleting, setDeleting] = useState(false);

  const selectedStudies = useMemo(
    () => studies.filter((s) => s.id && selection.value.has(s.id)),
    [studies, selection.value],
  );

  const validForDelete = selectedStudies.filter((s) => toExcludeInput(s).identifiers.length > 0);
  const skippedCount = selectedStudies.length - validForDelete.length;

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const payload = validForDelete.map(toExcludeInput);
      const result = await excludeStudies(payload);

      // The excludes list is the source of truth for the display. We
      // trigger a real refetch (not just invalidate — invalidate only
      // refetches active observers and can stay silent on window-focus
      // issues). refetchQueries reliably reloads and waits for the
      // result before we show the notification.
      await queryClient.refetchQueries({
        queryKey: ['studies-excluded'],
        exact: true,
      });

      notifications.show({
        color: 'teal',
        title: t('studies.deleted'),
        message: t('studies.deletedMessage', {
          count: result.deletedFromMedplum,
          excluded: result.newExcludes,
        }),
      });
      if (result.errors.length > 0) {
        notifications.show({
          color: 'yellow',
          title: t('studies.deletePartial'),
          message: t('studies.deletePartialMessage', {
            count: result.errors.length,
          }),
        });
      }
      selection.clear();
      closeConfirm();
      // Bonus: after 2 s also invalidate the studies query so
      // Medplum's cache eventually becomes consistent. If that ever
      // fails, the excludes filter keeps hiding the studies anyway.
      setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ['studies'] });
      }, 2000);
    } catch (err) {
      notifications.show({
        color: 'red',
        title: t('studies.deleteFailed'),
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setDeleting(false);
    }
  };

  // ─── Columns ──────────────────────────────────────────
  const columns: Column<ResearchStudy>[] = useMemo(
    () => [
      {
        id: 'title',
        header: t('studies.studyTitle'),
        sortable: true,
        minWidth: 320,
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
          <Text fz="sm">
            {s.phase?.text || s.phase?.coding?.[0]?.display || '—'}
          </Text>
        ),
      },
      {
        id: 'period_start',
        header: t('studies.period'),
        sortable: true,
        width: 220,
        cell: (s) => {
          const start = s.period?.start;
          const end = s.period?.end;
          if (!start && !end) {
            return (
              <Text fz="sm" c="dimmed">
                —
              </Text>
            );
          }
          return (
            <Text fz="sm">
              {start ? new Date(start).toLocaleDateString() : '?'}
              {' — '}
              {end ? new Date(end).toLocaleDateString() : t('studies.ongoing')}
            </Text>
          );
        },
      },
    ],
    [t],
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
      {studies.length === 0 ? (
        <>
        <PageHeader title={t('studies.title')} subtitle={t('studies.subtitle')} />
        <Center style={{ flex: 1, minHeight: 0 }}>
          <Stack align="center" gap="sm" maw={360}>
            <ThemeIcon variant="light" size="xl" color="gray" radius="xl">
              <FlaskConical size={24} />
            </ThemeIcon>
            <Text fw={500}>{t('studies.noStudies')}</Text>
            <Text size="sm" c="dimmed" ta="center">
              {t('studies.noStudiesDesc')}
            </Text>
          </Stack>
        </Center>
        </>
      ) : (
        <div style={{ flex: 1, minHeight: 0 }}>
        <DataGridLayout
          pageKey="studies"
          filterPanelRef={filterPanelRef}
          onFilterCollapsedChange={setFilterCollapsed}
          filterPanel={
            <FilterPanel
              sections={filterSections}
              selection={filterSelection}
              onChange={setFilterSelection}
              storageKey="studies"
              topSlot={<SavedViewsPanel vs={vs} />}
              title={t('filters.title')}
              resetLabel={t('filters.reset')}
            />
          }
          mainContent={
        <Stack gap="md" h="100%" style={{ minHeight: 0, overflow: 'hidden' }}>
          <PageHeader title={t('studies.title')} subtitle={t('studies.subtitle')} />
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
              placeholder={t('studies.searchPlaceholder')}
              style={{ flex: 1 }}
            />
            <Text fz="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
              {filteredStudies.length} / {studies.filter((s) => !isExcluded(s)).length}
            </Text>
          </Group>

          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <DataGrid<ResearchStudy>
              columns={columns}
              data={sort.sortedData}
              getRowId={(row) => row.id ?? ''}
              sort={sort.value}
              onSortChange={onSortChange}
              selection={selection.value}
              onSelectionChange={selection.set}
              onRowClick={(row) => setDetailStudy(row)}
            />
          </div>

          {selection.value.size > 0 && (
            <BulkActionBar
              selectedLabel={t('common.selected', { count: selection.value.size })}
              onClear={() => selection.clear()}
              clearLabel={t('common.cancel')}
              clearShortcutHint="(Esc)"
            >
              <BulkPill variant="text" onClick={openConfirm}>
                <Trash2 size={14} />
                {t('studies.deleteBulk')}
              </BulkPill>
            </BulkActionBar>
          )}
        </Stack>
          }
        />
        </div>
      )}

      <StudyDetailDrawer
        criteriaEditable
        study={detailStudy}
        opened={!!detailStudy}
        onClose={() => setDetailStudy(null)}
      />

      <Modal
        opened={confirmOpened}
        onClose={closeConfirm}
        title={
          selectedStudies.length > 1
            ? t('studies.deleteConfirmTitleMany')
            : t('studies.deleteConfirmTitle')
        }
        centered
      >
        <Stack gap="md">
          {selectedStudies.length === 1 ? (
            <Text size="sm">
              {t('studies.deleteConfirmText', {
                title: selectedStudies[0]?.title ?? '',
              })}
            </Text>
          ) : (
            <Text size="sm">
              {t('studies.deleteConfirmTextMany', {
                count: selectedStudies.length,
              })}
            </Text>
          )}
          <Text size="xs" c="dimmed">
            {t('studies.deleteConfirmHint')}
          </Text>
          {skippedCount > 0 && (
            <Text size="xs" c="yellow.7">
              {t('studies.deleteSkippedHint', { count: skippedCount })}
            </Text>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={closeConfirm} disabled={deleting}>
              {t('common.cancel')}
            </Button>
            <Button
              color="red"
              loading={deleting}
              onClick={handleDelete}
              disabled={validForDelete.length === 0 && skippedCount === 0}
            >
              {t('common.remove')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
