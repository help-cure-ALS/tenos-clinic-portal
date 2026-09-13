/**
 * useViewState — saved-views URL model for the portal grids, ported
 * from the evidencespace Explorer (react-router instead of next).
 *
 * URL model: /page?view=<id>. The URL contains ONLY the view id; the
 * filter/sort/search/layout params live behind it:
 *
 *   - saved view   → params in the verification-service DB
 *   - virtual view → params in localStorage
 *                    (`tenos-portal:virt-view:<uuid>`)
 *   - 'default'    → the caller's system default (or empty)
 *
 * History model (same as evidencespace):
 *   - applying a saved view → push
 *   - first modification of a saved/default view → push (new virt id,
 *     remembering the parent saved view for "Sicht aktualisieren")
 *   - further modifications of a virt view → localStorage only
 *   - saving → replace (virt id becomes the saved id)
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { FilterSelection, SortState } from '@hca/mantine-workbench';
import {
  createSavedView,
  deleteSavedView,
  listSavedViews,
  updateSavedView,
  type SavedView,
  type SavedViewScope,
} from '../lib/viewsApi';

const VIEW_PARAM_KEY = 'view';
const VIRT_PREFIX = 'virt-';
const LS_PREFIX = 'tenos-portal:virt-view:';

interface VirtualPayload {
  params: string;
  parentViewId: string | null;
}

function readVirtualPayload(virtId: string): VirtualPayload | null {
  try {
    const raw = window.localStorage.getItem(LS_PREFIX + virtId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.params === 'string') {
      return {
        params: parsed.params,
        parentViewId: typeof parsed.parentViewId === 'string' ? parsed.parentViewId : null,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function writeVirtualPayload(virtId: string, payload: VirtualPayload): void {
  try {
    window.localStorage.setItem(LS_PREFIX + virtId, JSON.stringify(payload));
  } catch {
    // quota etc. — best effort
  }
}

function clearVirtualParams(virtId: string): void {
  try {
    window.localStorage.removeItem(LS_PREFIX + virtId);
  } catch {
    // ignore
  }
}

export interface ViewState {
  viewId: string;
  isVirtual: boolean;
  matchedSavedView: SavedView | null;
  parentSavedView: SavedView | null;
  params: URLSearchParams;
}

export interface UseViewStateResult {
  state: ViewState;
  savedViews: SavedView[];
  setParams: (next: URLSearchParams) => void;
  applyView: (view: SavedView) => void;
  saveCurrentView: (name: string, opts?: { is_default?: boolean }) => Promise<SavedView>;
  updateCurrentView: (targetId?: string) => Promise<void>;
  setDefaultView: (view: SavedView) => Promise<void>;
  renameView: (view: SavedView, name: string) => Promise<void>;
  deleteView: (view: SavedView) => Promise<void>;
}

export function useViewState(
  scope: SavedViewScope,
  systemDefault = '',
): UseViewStateResult {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();

  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [virtualParams, setVirtualParams] = useState<URLSearchParams>(
    () => new URLSearchParams(),
  );

  const refreshViews = useCallback(async () => {
    try {
      setSavedViews(await listSavedViews(scope));
    } catch {
      // best effort — grids stay usable without saved views
    }
  }, [scope]);
  useEffect(() => { void refreshViews(); }, [refreshViews]);

  const viewIdRaw = searchParams.get(VIEW_PARAM_KEY);
  const isVirtual = viewIdRaw?.startsWith(VIRT_PREFIX) ?? false;

  // Sync LS → state when the URL switches to a virtual view.
  useEffect(() => {
    if (viewIdRaw && isVirtual) {
      const payload = readVirtualPayload(viewIdRaw);
      setVirtualParams(new URLSearchParams(payload?.params ?? ''));
    } else {
      setVirtualParams(new URLSearchParams());
    }
  }, [viewIdRaw, isVirtual]);

  // Empty URL → resolve to the user default (or 'default').
  useEffect(() => {
    if (viewIdRaw) return;
    void (async () => {
      let views: SavedView[] = [];
      try {
        views = await listSavedViews(scope);
        setSavedViews(views);
      } catch {
        // ignore
      }
      const userDefault = views.find((v) => v.is_default);
      const targetId = userDefault?.id ?? 'default';
      navigate(`${pathname}?${VIEW_PARAM_KEY}=${targetId}`, { replace: true });
    })();
    // Only on first mount with an empty URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const matchedSavedView = useMemo(
    () => savedViews.find((v) => v.id === viewIdRaw) ?? null,
    [savedViews, viewIdRaw],
  );

  const parentSavedView = useMemo<SavedView | null>(() => {
    if (!isVirtual || !viewIdRaw) return null;
    const payload = readVirtualPayload(viewIdRaw);
    if (!payload?.parentViewId) return null;
    return savedViews.find((v) => v.id === payload.parentViewId) ?? null;
  }, [isVirtual, viewIdRaw, savedViews]);

  const resolvedParams = useMemo<URLSearchParams>(() => {
    if (!viewIdRaw) return new URLSearchParams(systemDefault);
    if (isVirtual) return virtualParams;
    if (matchedSavedView) return new URLSearchParams(matchedSavedView.search_params);
    return new URLSearchParams(systemDefault);
  }, [viewIdRaw, isVirtual, virtualParams, matchedSavedView, systemDefault]);

  const state: ViewState = useMemo(() => ({
    viewId: viewIdRaw ?? 'default',
    isVirtual,
    matchedSavedView,
    parentSavedView,
    params: resolvedParams,
  }), [viewIdRaw, isVirtual, matchedSavedView, parentSavedView, resolvedParams]);

  const setParams = useCallback((next: URLSearchParams) => {
    const cleaned = new URLSearchParams(next.toString());
    cleaned.delete(VIEW_PARAM_KEY);
    if (isVirtual && viewIdRaw) {
      const existing = readVirtualPayload(viewIdRaw);
      writeVirtualPayload(viewIdRaw, {
        params: cleaned.toString(),
        parentViewId: existing?.parentViewId ?? null,
      });
      setVirtualParams(cleaned);
    } else {
      const virtId = `${VIRT_PREFIX}${crypto.randomUUID()}`;
      writeVirtualPayload(virtId, {
        params: cleaned.toString(),
        parentViewId: viewIdRaw && viewIdRaw !== 'default' ? viewIdRaw : null,
      });
      setVirtualParams(cleaned);
      navigate(`${pathname}?${VIEW_PARAM_KEY}=${virtId}`);
    }
  }, [isVirtual, viewIdRaw, pathname, navigate]);

  const applyView = useCallback((view: SavedView) => {
    navigate(`${pathname}?${VIEW_PARAM_KEY}=${view.id}`);
  }, [pathname, navigate]);

  const saveCurrentView = useCallback(async (
    name: string,
    opts?: { is_default?: boolean },
  ) => {
    const view = await createSavedView({
      scope,
      name,
      search_params: resolvedParams.toString(),
      is_default: opts?.is_default,
    });
    await refreshViews();
    if (isVirtual && viewIdRaw) clearVirtualParams(viewIdRaw);
    navigate(`${pathname}?${VIEW_PARAM_KEY}=${view.id}`, { replace: true });
    return view;
  }, [scope, resolvedParams, isVirtual, viewIdRaw, refreshViews, pathname, navigate]);

  const updateCurrentView = useCallback(async (targetId?: string) => {
    const id = targetId ?? parentSavedView?.id;
    if (!id) throw new Error('updateCurrentView: no target view');
    await updateSavedView(id, { search_params: resolvedParams.toString() });
    await refreshViews();
    if (isVirtual && viewIdRaw) clearVirtualParams(viewIdRaw);
    navigate(`${pathname}?${VIEW_PARAM_KEY}=${id}`, { replace: true });
  }, [parentSavedView, resolvedParams, isVirtual, viewIdRaw, refreshViews, pathname, navigate]);

  const setDefaultView = useCallback(async (view: SavedView) => {
    await updateSavedView(view.id, { is_default: !view.is_default });
    await refreshViews();
  }, [refreshViews]);

  const renameView = useCallback(async (view: SavedView, name: string) => {
    await updateSavedView(view.id, { name });
    await refreshViews();
  }, [refreshViews]);

  const deleteView = useCallback(async (view: SavedView) => {
    await deleteSavedView(view.id);
    await refreshViews();
    if (viewIdRaw === view.id) {
      navigate(`${pathname}?${VIEW_PARAM_KEY}=default`, { replace: true });
    }
  }, [refreshViews, viewIdRaw, pathname, navigate]);

  return {
    state,
    savedViews,
    setParams,
    applyView,
    saveCurrentView,
    updateCurrentView,
    setDefaultView,
    renameView,
    deleteView,
  };
}

// ─── Grid wiring helpers ───────────────────────────────────────────

/** Patch view params; null or '' removes the key. */
export function patchViewParams(
  vs: UseViewStateResult,
  patch: Record<string, string | null>,
): void {
  const next = new URLSearchParams(vs.state.params.toString());
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
  }
  vs.setParams(next);
}

/** Search query backed by the view params (`q`). */
export function useViewQuery(vs: UseViewStateResult): [string, (q: string) => void] {
  const query = vs.state.params.get('q') ?? '';
  const setQuery = useCallback(
    (q: string) => patchViewParams(vs, { q }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vs.setParams, vs.state.params],
  );
  return [query, setQuery];
}

/**
 * FilterPanel selection backed by the view params. Every section is
 * serialized as repeated `f_<section>` keys, so saved views capture
 * the whole panel state.
 */
export function useViewFilterSelection(
  vs: UseViewStateResult,
): { selection: FilterSelection; setSelection: (next: FilterSelection) => void } {
  const paramsString = vs.state.params.toString();
  const selection = useMemo<FilterSelection>(() => {
    const map: FilterSelection = new Map();
    const params = new URLSearchParams(paramsString);
    for (const key of new Set(params.keys())) {
      if (!key.startsWith('f_')) continue;
      const values = params.getAll(key).filter((v) => v !== '');
      if (values.length > 0) map.set(key.slice(2), new Set(values));
    }
    return map;
  }, [paramsString]);

  const setSelection = useCallback((next: FilterSelection) => {
    const params = new URLSearchParams(vs.state.params.toString());
    for (const key of [...new Set(params.keys())]) {
      if (key.startsWith('f_')) params.delete(key);
    }
    for (const [section, values] of next) {
      for (const value of values) params.append(`f_${section}`, value);
    }
    vs.setParams(params);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vs.setParams, vs.state.params]);

  return { selection, setSelection };
}

/** True when the row value matches the (possibly empty) section filter. */
export function filterMatches(
  selection: FilterSelection,
  section: string,
  value: string,
): boolean {
  const set = selection.get(section);
  return !set || set.size === 0 || set.has(value);
}

/**
 * Keeps a `useGridSort` in sync with the view params (`sortBy` /
 * `sortDir`): applies the view's sort when the view changes, and
 * returns the onSortChange handler that writes user sorting back.
 */
export function useViewSortSync(
  vs: UseViewStateResult,
  sort: { value: SortState; set: (next: SortState) => void },
): (next: SortState) => void {
  const paramSortBy = vs.state.params.get('sortBy');
  const paramSortDir = vs.state.params.get('sortDir') === 'asc' ? 'asc' : 'desc';

  // Apply on view switches (id change covers saved/default/virt hops).
  useEffect(() => {
    if (paramSortBy) {
      sort.set({ sortBy: paramSortBy, sortDir: paramSortDir });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vs.state.viewId]);

  return useCallback((next: SortState) => {
    sort.set(next);
    patchViewParams(vs, {
      sortBy: next.sortBy,
      sortDir: next.sortBy ? next.sortDir : null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort.set, vs.setParams, vs.state.params]);
}
