/**
 * Client for the editorial-content routes of studies-sync.
 *
 * hca admins manage global articles + categories; clinic users see
 * and edit only their own clinic's articles (enforced server-side —
 * the UI only mirrors that).
 */
import { medplum } from './medplum';

const STUDIES_SYNC_API_URL = import.meta.env.VITE_STUDIES_SYNC_API_URL || '/sync-api';

export type ArticleStatus = 'draft' | 'publishing' | 'public' | 'archived';
export type AlsfrsScale = 'total' | 'bulbar' | 'fine_motor' | 'gross_motor' | 'respiratory';

export interface ContentCategory {
  id: string;
  label: string;
  labels_i18n: Record<string, string>;
  sort: number;
  active: boolean;
}

export interface ContentArticle {
  id: string;
  source: 'hca' | 'clinic';
  clinic_id: string | null;
  clinic_name: string | null;
  category_id: string;
  status: ArticleStatus;
  original_lang: string;
  translate: boolean;
  title: string;
  teaser: string;
  body_html: string;
  link_url: string | null;
  has_image: boolean;
  image_content_type: string | null;
  countries: string[];
  phase_min_months: number | null;
  phase_max_months: number | null;
  alsfrs_scale: AlsfrsScale | null;
  alsfrs_min: number | null;
  alsfrs_max: number | null;
  article_date: string;
  starts_at: string | null;
  ends_at: string | null;
  hide_read_after_days: number | null;
  translations: Record<string, { title: string; teaser: string; body: string }>;
  medplum_id: string | null;
  published_at: string | null;
  publish_error: string | null;
  updated_at: string;
}

export interface ArticleInput {
  category_id: string;
  original_lang: string;
  translate: boolean;
  title: string;
  teaser: string;
  body_html: string;
  link_url: string | null;
  countries: string[];
  phase_min_months: number | null;
  phase_max_months: number | null;
  alsfrs_scale: AlsfrsScale | null;
  alsfrs_min: number | null;
  alsfrs_max: number | null;
  article_date: string;
  starts_at: string | null;
  ends_at: string | null;
  hide_read_after_days: number | null;
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
  const prefix = `HTTP ${res.status}`;
  try {
    const text = await res.text();
    if (!text) return `${prefix} — ${fallback}`;
    try {
      const data = JSON.parse(text) as { error?: string; message?: string };
      return `${prefix} — ${data.error || data.message || fallback}`;
    } catch {
      return `${prefix} — ${fallback}`;
    }
  } catch {
    return `${prefix} — ${fallback}`;
  }
}

export async function listContentCategories(): Promise<ContentCategory[]> {
  const res = await apiFetch('/admin/content/categories');
  if (!res.ok) throw new Error(await parseError(res, 'Failed to load categories'));
  return ((await res.json()) as { categories: ContentCategory[] }).categories;
}

export async function saveContentCategory(
  category: { id: string; label: string; original_lang: string; sort: number; active: boolean },
): Promise<void> {
  const res = await apiFetch('/admin/content/categories', {
    method: 'PUT',
    body: JSON.stringify(category),
  });
  if (!res.ok) throw new Error(await parseError(res, 'Failed to save category'));
}

export async function deleteContentCategory(id: string): Promise<void> {
  const res = await apiFetch(`/admin/content/categories/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(await parseError(res, 'Failed to delete category'));
}

export async function listContentArticles(status?: ArticleStatus): Promise<ContentArticle[]> {
  const query = status ? `?status=${status}` : '';
  const res = await apiFetch(`/admin/content/articles${query}`);
  if (!res.ok) throw new Error(await parseError(res, 'Failed to load articles'));
  return ((await res.json()) as { articles: ContentArticle[] }).articles;
}

export async function getContentArticle(id: string): Promise<ContentArticle> {
  const res = await apiFetch(`/admin/content/articles/${id}`);
  if (!res.ok) throw new Error(await parseError(res, 'Failed to load article'));
  return ((await res.json()) as { article: ContentArticle }).article;
}

export async function createContentArticle(input: ArticleInput): Promise<string> {
  const res = await apiFetch('/admin/content/articles', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await parseError(res, 'Failed to create article'));
  return ((await res.json()) as { id: string }).id;
}

export async function updateContentArticle(id: string, input: ArticleInput): Promise<void> {
  const res = await apiFetch(`/admin/content/articles/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await parseError(res, 'Failed to update article'));
}

/** dataBase64 = null removes the image. */
export async function setContentArticleImage(
  id: string,
  dataBase64: string | null,
  contentType: string | null,
): Promise<void> {
  const res = await apiFetch(`/admin/content/articles/${id}/image`, {
    method: 'PUT',
    body: JSON.stringify({ data: dataBase64, content_type: contentType }),
  });
  if (!res.ok) throw new Error(await parseError(res, 'Failed to save image'));
}

export function contentArticleImageUrl(id: string): string {
  return `${STUDIES_SYNC_API_URL}/admin/content/articles/${id}/image`;
}

/** Loads the image with auth and returns an object URL (or null). */
export async function fetchContentArticleImage(id: string): Promise<string | null> {
  const res = await apiFetch(`/admin/content/articles/${id}/image`);
  if (!res.ok) return null;
  return URL.createObjectURL(await res.blob());
}

export async function setContentArticleStatus(id: string, status: ArticleStatus): Promise<void> {
  const res = await apiFetch(`/admin/content/articles/${id}/status`, {
    method: 'POST',
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(await parseError(res, 'Failed to change status'));
}

export async function deleteContentArticle(id: string): Promise<void> {
  const res = await apiFetch(`/admin/content/articles/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await parseError(res, 'Failed to delete article'));
}
