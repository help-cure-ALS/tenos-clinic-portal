import { medplum } from './medplum';

const STUDIES_SYNC_API_URL = import.meta.env.VITE_STUDIES_SYNC_API_URL || '/sync-api';

export interface StudiesSyncConfig {
  conditions: string[];
  targetLanguages: string[];
  ctgovEnabled: boolean;
  ctisEnabled: boolean;
  translationEnabled: boolean;
  cronExpression: string;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  updatedAt: string;
}

export interface StudiesSyncRun {
  id: string;
  triggeredBy: 'cron' | 'manual' | 'startup';
  triggeredByUserId: string | null;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'success' | 'failed';
  ctgovFetched: number;
  ctgovUpserted: number;
  ctgovUnchanged: number;
  ctisFetched: number;
  ctisUpserted: number;
  ctisUnchanged: number;
  translatedCount: number;
  translationErrors: number;
  errorMessage: string | null;
}

async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const accessToken = medplum.getAccessToken();
  if (!accessToken) throw new Error('Not authenticated');
  return fetch(`${STUDIES_SYNC_API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...options.headers,
    },
  });
}

async function parseError(res: Response, fallback: string): Promise<string> {
  // Always prepend the HTTP status so diagnosing 404 (missing route)
  // vs. 401/403 (auth) vs. 500 (backend bug) is immediately obvious.
  const prefix = `HTTP ${res.status}`;
  try {
    const text = await res.text();
    if (!text) return `${prefix} — ${fallback}`;
    try {
      const data = JSON.parse(text) as { error?: string; message?: string };
      return `${prefix} — ${data.error || data.message || fallback}`;
    } catch {
      // Not JSON — probably HTML from Caddy (404) or an Nginx error page.
      const excerpt = text.slice(0, 120).replace(/\s+/g, ' ').trim();
      return `${prefix} — ${excerpt || fallback}`;
    }
  } catch {
    return `${prefix} — ${fallback}`;
  }
}

export async function getSyncConfig(): Promise<StudiesSyncConfig> {
  const res = await apiFetch('/admin/config');
  if (!res.ok) throw new Error(await parseError(res, 'Failed to load config'));
  const data = (await res.json()) as { config: StudiesSyncConfig };
  return data.config;
}

export async function updateSyncConfig(patch: Partial<StudiesSyncConfig>): Promise<StudiesSyncConfig> {
  const res = await apiFetch('/admin/config', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await parseError(res, 'Failed to update config'));
  const data = (await res.json()) as { config: StudiesSyncConfig };
  return data.config;
}

/**
 * Starts the translation backfill: iterates all existing studies
 * and fills in missing languages. No CTgov/CTIS traffic, only
 * Anthropic calls for translations that are actually missing.
 */
export async function triggerTranslationBackfill(): Promise<void> {
  const res = await apiFetch('/admin/translate-backfill', {
    method: 'POST',
    body: '{}',
  });
  if (!res.ok && res.status !== 202) {
    throw new Error(await parseError(res, 'Failed to trigger translation backfill'));
  }
}

export async function triggerSyncRun(
  options: { forceFullScan?: boolean } = {},
): Promise<void> {
  // Body always contains JSON — at minimum `{}`. `apiFetch` pins
  // `Content-Type: application/json`; Fastify would otherwise reject
  // with `FST_ERR_CTP_EMPTY_JSON_BODY`.
  const res = await apiFetch('/admin/run', {
    method: 'POST',
    body: JSON.stringify(options),
  });
  if (res.status === 409) {
    throw new Error('run_already_active');
  }
  if (!res.ok && res.status !== 202) {
    throw new Error(await parseError(res, 'Failed to trigger run'));
  }
}

export async function listSyncRuns(): Promise<StudiesSyncRun[]> {
  const res = await apiFetch('/admin/runs');
  if (!res.ok) throw new Error(await parseError(res, 'Failed to load runs'));
  const data = (await res.json()) as { runs: StudiesSyncRun[] };
  return data.runs;
}

export interface ExcludeStudyInput {
  studyId?: string;
  identifiers: Array<{ system: string; value: string }>;
}

export interface ExcludeStudiesResult {
  deletedFromMedplum: number;
  newExcludes: number;
  errors: Array<{ studyId: string; error: string }>;
}

export interface ExcludedStudyRecord {
  identifier_system: string;
  identifier_value: string;
  excluded_at: string;
  excluded_by_user_id: string | null;
  reason: string | null;
}

/**
 * List of all studies that are permanently excluded. The excludes
 * table in the studies-sync DB is the source of truth — Medplum's
 * search index is eventually consistent, and if the delete does not
 * take effect there (access policy, cache, race), the frontend must
 * still consistently hide the "deleted" studies.
 */
export async function listExcludedStudies(): Promise<ExcludedStudyRecord[]> {
  const res = await apiFetch('/admin/studies/excluded');
  if (!res.ok) throw new Error(await parseError(res, 'Failed to load excluded studies'));
  const data = (await res.json()) as { excluded: ExcludedStudyRecord[] };
  return data.excluded;
}

/**
 * Delete studies in Medplum AND put them on the exclusion list so
 * the next sync does not recreate them.
 */
export interface ResetResult {
  deletedResearchStudies: number;
  clearedExcludes: number;
  errors: Array<{ id: string; error: string }>;
}

/**
 * Full reset: remove all studies from Medplum, clear the excludes
 * list, reset sync timestamps. The next sync runs as a full scan.
 */
export async function resetStudies(): Promise<ResetResult> {
  const res = await apiFetch('/admin/reset', {
    method: 'POST',
    body: JSON.stringify({ confirm: 'RESET' }),
  });
  if (res.status === 409) throw new Error('sync_running');
  if (!res.ok) throw new Error(await parseError(res, 'Failed to reset studies'));
  return (await res.json()) as ResetResult;
}

export async function excludeStudies(
  studies: ExcludeStudyInput[],
  reason?: string,
): Promise<ExcludeStudiesResult> {
  const res = await apiFetch('/admin/studies/exclude', {
    method: 'POST',
    body: JSON.stringify({ studies, reason }),
  });
  if (!res.ok) throw new Error(await parseError(res, 'Failed to delete studies'));
  return (await res.json()) as ExcludeStudiesResult;
}
