/**
 * Saved grid views (verification-service /portal/views).
 *
 * Evidencespace pattern: the URL only carries ?view=<id>; the actual
 * filter/sort/search/layout params are stored behind the id — saved
 * views here in the service DB, unsaved ("virtual") views in
 * localStorage (see useViewState).
 */
import { medplum } from './medplum';

const API_URL = import.meta.env.VITE_VERIFICATION_API_URL || '/vapi';

export type SavedViewScope =
  | 'clinics'
  | 'clinic-studies'
  | 'content'
  | 'practitioners'
  | 'studies'
  | 'suppliers'
  | 'users'
  | 'tokens'
  | 'verifications';

export interface SavedView {
  id: string;
  scope: SavedViewScope;
  name: string;
  search_params: string;
  pinned: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

async function viewsFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const accessToken = medplum.getAccessToken();
  if (!accessToken) throw new Error('Not authenticated');
  return fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...options.headers,
    },
  });
}

export async function listSavedViews(scope: SavedViewScope): Promise<SavedView[]> {
  const res = await viewsFetch(`/portal/views?scope=${encodeURIComponent(scope)}`);
  if (!res.ok) throw new Error('Failed to load views');
  const data = await res.json();
  return data.views ?? [];
}

export async function createSavedView(input: {
  scope: SavedViewScope;
  name: string;
  search_params: string;
  pinned?: boolean;
  is_default?: boolean;
}): Promise<SavedView> {
  const res = await viewsFetch('/portal/views', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error('Failed to save view');
  return (await res.json()).view;
}

export async function updateSavedView(
  id: string,
  patch: Partial<Pick<SavedView, 'name' | 'search_params' | 'pinned' | 'is_default'>>,
): Promise<SavedView> {
  const res = await viewsFetch(`/portal/views/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error('Failed to update view');
  return (await res.json()).view;
}

export async function deleteSavedView(id: string): Promise<void> {
  const res = await viewsFetch(`/portal/views/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete view');
}
