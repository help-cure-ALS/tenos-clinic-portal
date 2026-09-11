/**
 * Structured eligibility criteria of a synced study — the editable
 * spot-check view for hca-admins. Every criterion line shows the
 * registry text, the machine-readable form the app matches against,
 * the extraction confidence and whether a manual override is active.
 *
 * Overrides always win over the LLM extraction and are pushed to the
 * study immediately (no waiting for the nightly run).
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  NumberInput,
  Select,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { Pencil, RotateCcw } from 'lucide-react';
import {
  getStudyCriteria,
  removeCriterionOverride,
  saveCriterionOverride,
  type StructuredCriterion,
  type StudyCriteriaResult,
  type StudyCriterion,
} from '../../lib/studiesSyncApi';

/**
 * Client copy of the criterion catalog v1 (source of truth:
 * studies-sync/src/extraction/catalog.ts — server-side validation
 * rejects anything this list and the server disagree on).
 */
const CATALOG: Record<string, { shape: 'numeric' | 'choice'; values?: string[]; unit?: string }> = {
  age: { shape: 'numeric', unit: 'years' },
  sex: { shape: 'choice', values: ['male', 'female'] },
  time_since_onset: { shape: 'numeric', unit: 'months' },
  time_since_diagnosis: { shape: 'numeric', unit: 'months' },
  alsfrs_r_total: { shape: 'numeric', unit: 'score' },
  fvc_percent: { shape: 'numeric', unit: '%' },
  svc_percent: { shape: 'numeric', unit: '%' },
  kings_stage: { shape: 'numeric', unit: 'stage' },
  gene_mutation: { shape: 'choice', values: ['sod1', 'c9orf72', 'fus', 'tardbp', 'other'] },
  als_cause: { shape: 'choice', values: ['familial', 'sporadic'] },
  onset_region: { shape: 'choice', values: ['bulbar', 'spinal'] },
  ventilation: { shape: 'choice', values: ['niv', 'tracheostomy', 'any'] },
  peg: { shape: 'choice', values: ['peg'] },
  medication: { shape: 'choice', values: ['riluzole', 'edaravone'] },
};

const NONE = '__none__';

interface EditState {
  textHash: string;
  id: string;
  min: number | '';
  max: number | '';
  op: 'requires' | 'excludes';
  value: string;
}

function summarize(t: (k: string, o?: Record<string, unknown>) => string, c: StructuredCriterion): string {
  const label = t(`studies.criteriaEditor.cat.${c.id}`);
  const entry = CATALOG[c.id];
  if (entry?.shape === 'numeric') {
    const unit = entry.unit === 'score' || entry.unit === 'stage' ? '' : ` ${entry.unit ?? ''}`;
    if (c.min !== undefined && c.max !== undefined) return `${label}: ${c.min}–${c.max}${unit}`;
    if (c.min !== undefined) return `${label} ≥ ${c.min}${unit}`;
    return `${label} ≤ ${c.max}${unit}`;
  }
  const valueLabel = t(`studies.criteriaEditor.val.${c.value}`);
  const opLabel = c.op === 'excludes'
    ? t('studies.criteriaEditor.opExcludes')
    : t('studies.criteriaEditor.opRequires');
  return `${label}: ${opLabel} ${valueLabel}`;
}

export function StudyCriteriaEditor({ studyId }: { studyId: string }) {
  const { t } = useTranslation();
  const [data, setData] = useState<StudyCriteriaResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [edit, setEdit] = useState<EditState | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await getStudyCriteria(studyId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [studyId]);

  useEffect(() => {
    setEdit(null);
    void load();
  }, [load]);

  function beginEdit(criterion: StudyCriterion) {
    const s = criterion.structured;
    const entry = s ? CATALOG[s.id] : undefined;
    setEdit({
      textHash: criterion.text_hash,
      id: s?.id ?? NONE,
      min: s?.min ?? '',
      max: s?.max ?? '',
      op: s?.op ?? 'requires',
      value: s?.value ?? (entry?.values?.[0] ?? ''),
    });
  }

  async function saveEdit() {
    if (!edit) return;
    setSaving(true);
    setError('');
    try {
      if (edit.id === NONE) {
        await saveCriterionOverride(studyId, edit.textHash, null);
      } else {
        const entry = CATALOG[edit.id];
        const structured: Omit<StructuredCriterion, 'kind'> = { id: edit.id };
        if (entry.shape === 'numeric') {
          if (edit.min !== '') structured.min = Number(edit.min);
          if (edit.max !== '') structured.max = Number(edit.max);
        } else {
          structured.op = edit.op;
          structured.value = edit.value;
        }
        await saveCriterionOverride(studyId, edit.textHash, structured);
      }
      setEdit(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function restoreExtraction(textHash: string) {
    setSaving(true);
    setError('');
    try {
      await removeCriterionOverride(studyId, textHash);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <Group justify="center" py="sm"><Loader size="sm" /></Group>;
  }
  if (error && !data) {
    return <Alert color="red">{error}</Alert>;
  }
  if (!data) return null;

  const catalogOptions = [
    { value: NONE, label: t('studies.criteriaEditor.noCriterion') },
    ...Object.keys(CATALOG).map((id) => ({
      value: id,
      label: t(`studies.criteriaEditor.cat.${id}`),
    })),
  ];

  const editEntry = edit && edit.id !== NONE ? CATALOG[edit.id] : undefined;

  return (
    <Stack gap="xs">
      <Text size="xs" c="dimmed">{t('studies.criteriaEditor.hint')}</Text>
      {error && <Alert color="red">{error}</Alert>}

      {data.base.length > 0 && (
        <Group gap={6}>
          {data.base.map((c, i) => (
            <Badge key={i} variant="light" color="gray">{summarize(t, c)}</Badge>
          ))}
        </Group>
      )}

      {data.criteria.length === 0 && (
        <Text size="sm" c="dimmed">{t('studies.criteriaEditor.empty')}</Text>
      )}

      {data.criteria.map((criterion) => {
        const isEditing = edit?.textHash === criterion.text_hash;
        return (
          <Stack
            key={criterion.text_hash}
            gap={4}
            p="xs"
            style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 6 }}
          >
            <Group gap="xs" wrap="nowrap" align="flex-start">
              <Badge
                variant="light"
                color={criterion.kind === 'inclusion' ? 'green' : 'red'}
                style={{ flexShrink: 0 }}
              >
                {criterion.kind === 'inclusion'
                  ? t('studies.criteriaEditor.inclusion')
                  : t('studies.criteriaEditor.exclusion')}
              </Badge>
              <Text size="sm" style={{ flex: 1 }}>{criterion.text}</Text>
              {!isEditing && (
                <Group gap={4} style={{ flexShrink: 0 }}>
                  {criterion.source === 'override' && (
                    <Tooltip label={t('studies.criteriaEditor.restoreExtraction')}>
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        onClick={() => void restoreExtraction(criterion.text_hash)}
                        disabled={saving}
                      >
                        <RotateCcw size={16} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                  <ActionIcon
                    variant="subtle"
                    onClick={() => beginEdit(criterion)}
                    disabled={saving}
                  >
                    <Pencil size={16} />
                  </ActionIcon>
                </Group>
              )}
            </Group>

            {!isEditing && (
              <Group gap={6}>
                {criterion.structured ? (
                  <Badge variant="light" color="blue">{summarize(t, criterion.structured)}</Badge>
                ) : (
                  <Badge variant="light" color="gray">{t('studies.criteriaEditor.notMatched')}</Badge>
                )}
                {criterion.source === 'override' && (
                  <Badge variant="filled" color="orange">{t('studies.criteriaEditor.override')}</Badge>
                )}
                {criterion.source === 'extraction' && criterion.confidence != null && (
                  <Badge variant="light" color="gray">
                    {t('studies.criteriaEditor.confidence', {
                      percent: Math.round(criterion.confidence * 100),
                    })}
                  </Badge>
                )}
              </Group>
            )}

            {isEditing && edit && (
              <Stack gap="xs">
                <Select
                  size="xs"
                  label={t('studies.criteriaEditor.catalogId')}
                  value={edit.id}
                  onChange={(value) => {
                    if (!value) return;
                    const entry = value !== NONE ? CATALOG[value] : undefined;
                    setEdit({
                      ...edit,
                      id: value,
                      value: entry?.values?.[0] ?? '',
                    });
                  }}
                  data={catalogOptions}
                />
                {editEntry?.shape === 'numeric' && (
                  <Group gap="xs" grow>
                    <NumberInput
                      size="xs"
                      label={t('studies.criteriaEditor.min')}
                      value={edit.min}
                      onChange={(v) => setEdit({ ...edit, min: typeof v === 'number' ? v : '' })}
                    />
                    <NumberInput
                      size="xs"
                      label={t('studies.criteriaEditor.max')}
                      value={edit.max}
                      onChange={(v) => setEdit({ ...edit, max: typeof v === 'number' ? v : '' })}
                    />
                  </Group>
                )}
                {editEntry?.shape === 'choice' && (
                  <Group gap="xs" grow>
                    <Select
                      size="xs"
                      label={t('studies.criteriaEditor.op')}
                      value={edit.op}
                      onChange={(v) => v && setEdit({ ...edit, op: v as 'requires' | 'excludes' })}
                      data={[
                        { value: 'requires', label: t('studies.criteriaEditor.opRequires') },
                        { value: 'excludes', label: t('studies.criteriaEditor.opExcludes') },
                      ]}
                    />
                    <Select
                      size="xs"
                      label={t('studies.criteriaEditor.value')}
                      value={edit.value}
                      onChange={(v) => v && setEdit({ ...edit, value: v })}
                      data={(editEntry.values ?? []).map((v) => ({
                        value: v,
                        label: t(`studies.criteriaEditor.val.${v}`),
                      }))}
                    />
                  </Group>
                )}
                <Group gap="xs" justify="flex-end">
                  <Button size="compact-xs" variant="default" onClick={() => setEdit(null)} disabled={saving}>
                    {t('common.cancel')}
                  </Button>
                  <Button size="compact-xs" onClick={() => void saveEdit()} loading={saving}>
                    {t('common.save')}
                  </Button>
                </Group>
              </Stack>
            )}
          </Stack>
        );
      })}
    </Stack>
  );
}
