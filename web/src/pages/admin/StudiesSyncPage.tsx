import { useEffect, useState } from 'react';
import {
  Stack,
  Card,
  TagsInput,
  MultiSelect,
  TextInput,
  Switch,
  Group,
  Button,
  Text,
  Table,
  Badge,
  Alert,
  Loader,
  Divider,
  Modal,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';
import { AlertCircle } from 'lucide-react';
import { PageHeader } from '@hca/mantine-workbench';

import {
  getSyncConfig,
  updateSyncConfig,
  triggerSyncRun,
  triggerTranslationBackfill,
  listSyncRuns,
  resetStudies,
  type StudiesSyncConfig,
  type StudiesSyncRun,
} from '../../lib/studiesSyncApi';

// All languages the mobile app currently supports. EN is the
// source and is not listed as a translation target.
const SUPPORTED_LANGUAGES: Array<{ value: string; label: string }> = [
  { value: 'de', label: 'Deutsch (de)' },
  { value: 'es', label: 'Español (es)' },
  { value: 'fr', label: 'Français (fr)' },
  { value: 'it', label: 'Italiano (it)' },
  { value: 'ja', label: '日本語 (ja)' },
  { value: 'nl', label: 'Nederlands (nl)' },
  { value: 'pl', label: 'Polski (pl)' },
  { value: 'pt', label: 'Português (pt)' },
  { value: 'ro', label: 'Română (ro)' },
  { value: 'tr', label: 'Türkçe (tr)' },
  { value: 'zh', label: '中文 (zh)' },
];

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString();
}

function statusColor(status: StudiesSyncRun['status']): string {
  switch (status) {
    case 'running':
      return 'blue';
    case 'success':
      return 'teal';
    case 'failed':
      return 'red';
  }
}

export function StudiesSyncPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [config, setConfig] = useState<StudiesSyncConfig | null>(null);
  const [draft, setDraft] = useState<StudiesSyncConfig | null>(null);
  const [runs, setRuns] = useState<StudiesSyncRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [resetOpened, { open: openReset, close: closeReset }] = useDisclosure(false);
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetting, setResetting] = useState(false);

  const [translationBackfilling, setTranslationBackfilling] = useState(false);
  const [
    backfillPromptOpened,
    { open: openBackfillPrompt, close: closeBackfillPrompt },
  ] = useDisclosure(false);
  const [
    fullScanPromptOpened,
    { open: openFullScanPrompt, close: closeFullScanPrompt },
  ] = useDisclosure(false);
  const [fullScanning, setFullScanning] = useState(false);

  const handleFullScan = async () => {
    setFullScanning(true);
    try {
      await triggerSyncRun({ forceFullScan: true });
      notifications.show({
        color: 'teal',
        title: t('studiesSync.fullScanStarted'),
        message: t('studiesSync.fullScanStartedMessage'),
      });
      closeFullScanPrompt();
      setTimeout(loadAll, 1000);
    } catch (err) {
      notifications.show({
        color: 'red',
        title: t('studiesSync.runFailed'),
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setFullScanning(false);
    }
  };

  const handleTranslationBackfill = async () => {
    setTranslationBackfilling(true);
    try {
      await triggerTranslationBackfill();
      notifications.show({
        color: 'teal',
        title: t('studiesSync.backfillStarted'),
        message: t('studiesSync.backfillStartedMessage'),
      });
      closeBackfillPrompt();
    } catch (err) {
      notifications.show({
        color: 'red',
        title: t('studiesSync.backfillFailed'),
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTranslationBackfilling(false);
    }
  };

  const handleReset = async () => {
    if (resetConfirm !== 'RESET') return;
    setResetting(true);
    try {
      const result = await resetStudies();
      notifications.show({
        color: 'teal',
        title: t('studiesSync.resetDone'),
        message: t('studiesSync.resetDoneMessage', {
          studies: result.deletedResearchStudies,
          excludes: result.clearedExcludes,
        }),
      });
      if (result.errors.length > 0) {
        notifications.show({
          color: 'yellow',
          title: t('studiesSync.resetPartial'),
          message: t('studiesSync.resetPartialMessage', {
            count: result.errors.length,
          }),
        });
      }
      setResetConfirm('');
      closeReset();
      await queryClient.invalidateQueries({ queryKey: ['studies'] });
      await queryClient.invalidateQueries({ queryKey: ['studies-excluded'] });
      // Reload the config so last_run_at/last_success_at go to null.
      await loadAll();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      notifications.show({
        color: 'red',
        title: t('studiesSync.resetFailed'),
        message:
          message === 'sync_running'
            ? t('studiesSync.resetSyncRunning')
            : message,
      });
    } finally {
      setResetting(false);
    }
  };

  const loadAll = async () => {
    try {
      const [cfg, r] = await Promise.all([getSyncConfig(), listSyncRuns()]);
      setConfig(cfg);
      setDraft(cfg);
      setRuns(r);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
    // Poll runs every 10 seconds — handy when a run is in progress.
    const interval = setInterval(async () => {
      try {
        const r = await listSyncRuns();
        setRuns(r);
      } catch {
        // Ignore poll errors — the next tick retries.
      }
    }, 10_000);
    return () => clearInterval(interval);
  }, []);

  const dirty =
    !!config &&
    !!draft &&
    (JSON.stringify(config.conditions) !== JSON.stringify(draft.conditions) ||
      JSON.stringify(config.targetLanguages) !== JSON.stringify(draft.targetLanguages) ||
      config.ctgovEnabled !== draft.ctgovEnabled ||
      config.ctisEnabled !== draft.ctisEnabled ||
      config.translationEnabled !== draft.translationEnabled ||
      config.cronExpression !== draft.cronExpression);

  const handleSave = async () => {
    if (!draft || !config) return;
    setSaving(true);
    try {
      // Compare before saving so we know whether a backfill is needed.
      const oldLangs = new Set(config.targetLanguages);
      const newLangs = draft.targetLanguages;
      const langsAdded = newLangs.some((l) => !oldLangs.has(l));
      const translationTurnedOn = !config.translationEnabled && draft.translationEnabled;
      const ctgovTurnedOn = !config.ctgovEnabled && draft.ctgovEnabled;
      const ctisTurnedOn = !config.ctisEnabled && draft.ctisEnabled;

      const updated = await updateSyncConfig({
        conditions: draft.conditions,
        targetLanguages: draft.targetLanguages,
        ctgovEnabled: draft.ctgovEnabled,
        ctisEnabled: draft.ctisEnabled,
        translationEnabled: draft.translationEnabled,
        cronExpression: draft.cronExpression,
      });
      setConfig(updated);
      setDraft(updated);
      notifications.show({
        color: 'teal',
        title: t('studiesSync.saved'),
        message: t('studiesSync.savedMessage'),
      });

      // After saving, check whether existing studies should now catch
      // up on translations (translation newly on OR new language added).
      // The normal sync would only cover the changed trials —
      // so explicitly offer the admin to start the backfill.
      if (draft.translationEnabled && (translationTurnedOn || langsAdded)) {
        openBackfillPrompt();
      } else if (ctgovTurnedOn || ctisTurnedOn) {
        // Analogous to languages: after reactivating a source, the
        // next nightly delta sync would only fetch the "since
        // yesterday" changes — trials from the off period would go
        // undetected. So we suggest a full sync to the admin.
        openFullScanPrompt();
      }
    } catch (err) {
      notifications.show({
        color: 'red',
        title: t('studiesSync.saveFailed'),
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTrigger = async () => {
    setTriggering(true);
    try {
      await triggerSyncRun();
      notifications.show({
        color: 'teal',
        title: t('studiesSync.runStarted'),
        message: t('studiesSync.runStartedMessage'),
      });
      // Wait briefly, then refresh.
      setTimeout(loadAll, 1000);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      notifications.show({
        color: 'red',
        title: t('studiesSync.runFailed'),
        message:
          message === 'run_already_active'
            ? t('studiesSync.runAlreadyActive')
            : message,
      });
    } finally {
      setTriggering(false);
    }
  };

  if (loading) {
    return (
      <Stack gap="lg">
        <PageHeader
          title={t('studiesSync.title')}
          subtitle={t('studiesSync.subtitle')}
        />
        <Group justify="center" mt="xl">
          <Loader />
        </Group>
      </Stack>
    );
  }

  if (error && !config) {
    return (
      <Stack gap="lg">
        <PageHeader
          title={t('studiesSync.title')}
          subtitle={t('studiesSync.subtitle')}
        />
        <Alert icon={<AlertCircle size={16} />} color="red" variant="light">
          {error}
        </Alert>
      </Stack>
    );
  }

  if (!draft) return null;

  return (
    <Stack gap="lg" h="100%" style={{ minHeight: 0 }}>
      <PageHeader
        title={t('studiesSync.title')}
        subtitle={t('studiesSync.subtitle')}
      />

      {/* Scrollable content area. The PageHeader at the top stays fixed,
          cards scroll through below. Padding on both sides so the cards
          don't stick to the edge — consistent with the pattern of
          ClinicsPage and StudiesPage. */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      <Stack gap="lg" px="md" pb="md">

      {/* ─── Configuration ───────────────────────────────────── */}
      <Card withBorder shadow="xs" padding="lg">
        <Stack gap="md">
          <Text fw={600} size="md">
            {t('studiesSync.configTitle')}
          </Text>

          <TagsInput
            label={t('studiesSync.conditions')}
            description={t('studiesSync.conditionsHint')}
            placeholder="Add..."
            value={draft.conditions}
            onChange={(v) => setDraft({ ...draft, conditions: v })}
            clearable
          />

          <MultiSelect
            label={t('studiesSync.targetLanguages')}
            description={t('studiesSync.targetLanguagesHint')}
            data={SUPPORTED_LANGUAGES}
            value={draft.targetLanguages}
            onChange={(v) => setDraft({ ...draft, targetLanguages: v })}
            searchable
            clearable
          />

          <Group grow>
            <Switch
              label={t('studiesSync.ctgovEnabled')}
              checked={draft.ctgovEnabled}
              onChange={(e) =>
                setDraft({ ...draft, ctgovEnabled: e.currentTarget.checked })
              }
            />
            <Switch
              label={t('studiesSync.ctisEnabled')}
              checked={draft.ctisEnabled}
              onChange={(e) =>
                setDraft({ ...draft, ctisEnabled: e.currentTarget.checked })
              }
            />
            <Switch
              label={t('studiesSync.translationEnabled')}
              checked={draft.translationEnabled}
              onChange={(e) =>
                setDraft({ ...draft, translationEnabled: e.currentTarget.checked })
              }
            />
          </Group>

          <TextInput
            label={t('studiesSync.cronExpression')}
            description={t('studiesSync.cronHint')}
            value={draft.cronExpression}
            onChange={(e) => setDraft({ ...draft, cronExpression: e.currentTarget.value })}
          />

          <Group justify="flex-end">
            <Button
              variant="default"
              disabled={!dirty || saving}
              onClick={() => setDraft(config)}
            >
              {t('common.discard')}
            </Button>
            <Button
              color="teal"
              loading={saving}
              disabled={!dirty}
              onClick={handleSave}
            >
              {t('common.save')}
            </Button>
          </Group>
        </Stack>
      </Card>

      {/* ─── Manual run ───────────────────────────────────────── */}
      <Card withBorder shadow="xs" padding="lg">
        <Stack gap="md">
          <Group justify="space-between" align="center">
            <div>
              <Text fw={600} size="md">
                {t('studiesSync.manualRun')}
              </Text>
              <Text size="sm" c="dimmed">
                {t('studiesSync.lastRunAt')}:{' '}
                {formatDate(config?.lastRunAt ?? null)} · {' '}
                {t('studiesSync.lastSuccessAt')}:{' '}
                {formatDate(config?.lastSuccessAt ?? null)}
              </Text>
            </div>
            <Button color="hca-purple" onClick={handleTrigger} loading={triggering}>
              {t('studiesSync.runNow')}
            </Button>
          </Group>

          <Divider />

          <Group justify="space-between" align="center">
            <div>
              <Text fw={600} size="sm">
                {t('studiesSync.translationBackfill')}
              </Text>
              <Text size="sm" c="dimmed">
                {t('studiesSync.translationBackfillHint')}
              </Text>
            </div>
            <Button
              variant="light"
              color="hca-purple"
              onClick={handleTranslationBackfill}
              loading={translationBackfilling}
            >
              {t('studiesSync.backfillNow')}
            </Button>
          </Group>
        </Stack>
      </Card>

      {/* ─── Auto-prompt after config save ───────────────── */}
      <Modal
        opened={backfillPromptOpened}
        onClose={closeBackfillPrompt}
        title={t('studiesSync.backfillPromptTitle')}
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            {t('studiesSync.backfillPromptBody')}
          </Text>
          <Text size="sm" c="dimmed">
            {t('studiesSync.backfillPromptCost')}
          </Text>
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={closeBackfillPrompt}
              disabled={translationBackfilling}
            >
              {t('studiesSync.backfillPromptLater')}
            </Button>
            <Button
              color="hca-purple"
              onClick={handleTranslationBackfill}
              loading={translationBackfilling}
            >
              {t('studiesSync.backfillNow')}
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* ─── Run-History ──────────────────────────────────────── */}
      <Card withBorder shadow="xs" padding="lg">
        <Stack gap="md">
          <Text fw={600} size="md">
            {t('studiesSync.history')}
          </Text>
          {runs.length === 0 ? (
            <Text size="sm" c="dimmed">
              {t('studiesSync.noRuns')}
            </Text>
          ) : (
            <Table striped highlightOnHover verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('studiesSync.col.status')}</Table.Th>
                  <Table.Th>{t('studiesSync.col.trigger')}</Table.Th>
                  <Table.Th>{t('studiesSync.col.startedAt')}</Table.Th>
                  <Table.Th>{t('studiesSync.col.duration')}</Table.Th>
                  <Table.Th>{t('studiesSync.col.ctgov')}</Table.Th>
                  <Table.Th>{t('studiesSync.col.ctis')}</Table.Th>
                  <Table.Th>{t('studiesSync.col.translated')}</Table.Th>
                  <Table.Th>{t('studiesSync.col.error')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {runs.map((r) => {
                  const durationMs =
                    r.finishedAt && r.startedAt
                      ? new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()
                      : null;
                  return (
                    <Table.Tr key={r.id}>
                      <Table.Td>
                        <Badge color={statusColor(r.status)} variant="light">
                          {r.status}
                        </Badge>
                      </Table.Td>
                      <Table.Td>{r.triggeredBy}</Table.Td>
                      <Table.Td>{formatDate(r.startedAt)}</Table.Td>
                      <Table.Td>
                        {durationMs === null
                          ? '—'
                          : `${Math.round(durationMs / 1000)}s`}
                      </Table.Td>
                      <Table.Td>
                        {r.ctgovUpserted}↑ / {r.ctgovUnchanged}= / {r.ctgovFetched}∑
                      </Table.Td>
                      <Table.Td>
                        {r.ctisUpserted}↑ / {r.ctisUnchanged}= / {r.ctisFetched}∑
                      </Table.Td>
                      <Table.Td>
                        {r.translatedCount}
                        {r.translationErrors > 0 && (
                          <Text component="span" c="red" size="xs" ml={4}>
                            ({r.translationErrors} err)
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        {r.errorMessage ? (
                          <Text size="xs" c="red" truncate maw={200} title={r.errorMessage}>
                            {r.errorMessage}
                          </Text>
                        ) : (
                          '—'
                        )}
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          )}
          <Divider />
          <Text size="sm" c="dimmed">
            {t('studiesSync.historyHint')}
          </Text>
        </Stack>
      </Card>

      {/* ─── Danger Zone — Full Reset ─────────────────────── */}
      <Card withBorder shadow="xs" padding="lg" style={{ borderColor: 'var(--mantine-color-red-3)' }}>
        <Stack gap="md">
          <Group justify="space-between" align="flex-start">
            <div>
              <Text fw={600} size="lg" c="red.7">
                {t('studiesSync.dangerZone')}
              </Text>
              <Text size="sm" c="dimmed" mt={4}>
                {t('studiesSync.resetHint')}
              </Text>
            </div>
            <Button color="red" variant="outline" onClick={openReset}>
              {t('studiesSync.resetButton')}
            </Button>
          </Group>
        </Stack>
      </Card>

      {/* ─── Reset confirm modal ────────────────────────── */}
      <Modal
        opened={resetOpened}
        onClose={() => {
          setResetConfirm('');
          closeReset();
        }}
        title={t('studiesSync.resetConfirmTitle')}
        centered
      >
        <Stack gap="md">
          <Alert color="red" variant="light" icon={<AlertCircle size={16} />}>
            {t('studiesSync.resetConfirmWarning')}
          </Alert>
          <TextInput
            label={t('studiesSync.resetConfirmLabel')}
            value={resetConfirm}
            onChange={(e) => setResetConfirm(e.currentTarget.value)}
            placeholder="RESET"
            data-autofocus
          />
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => {
                setResetConfirm('');
                closeReset();
              }}
              disabled={resetting}
            >
              {t('common.cancel')}
            </Button>
            <Button
              color="red"
              loading={resetting}
              disabled={resetConfirm !== 'RESET'}
              onClick={handleReset}
            >
              {t('studiesSync.resetConfirmButton')}
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* ─── Auto-prompt: full sync after source reactivation ── */}
      <Modal
        opened={fullScanPromptOpened}
        onClose={closeFullScanPrompt}
        title={t('studiesSync.fullScanPromptTitle')}
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            {t('studiesSync.fullScanPromptBody')}
          </Text>
          <Text size="sm" c="dimmed">
            {t('studiesSync.fullScanPromptHint')}
          </Text>
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={closeFullScanPrompt}
              disabled={fullScanning}
            >
              {t('studiesSync.backfillPromptLater')}
            </Button>
            <Button
              color="hca-purple"
              onClick={handleFullScan}
              loading={fullScanning}
            >
              {t('studiesSync.fullScanNow')}
            </Button>
          </Group>
        </Stack>
      </Modal>

      </Stack>
      </div>
    </Stack>
  );
}
