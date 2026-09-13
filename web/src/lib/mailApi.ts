/**
 * Mail-server settings client (verification-service /portal/settings/mail).
 * The SMTP password never comes back from the server — only
 * `has_password`; an empty password field on save keeps the stored one.
 */
import { medplum } from './medplum';

const API_URL = import.meta.env.VITE_VERIFICATION_API_URL || '/vapi';

export interface SmtpSettingsView {
  host?: string;
  port?: number;
  secure?: boolean;
  username?: string;
  from_email?: string;
  from_name?: string;
  reply_to?: string;
  portal_base_url?: string;
  has_password: boolean;
}

export interface MailTemplate {
  subject: string;
  body: string;
}

export interface MailTemplates {
  invitation: MailTemplate;
}

export interface MailSettingsResponse {
  smtp: SmtpSettingsView;
  templates: MailTemplates;
  defaults: MailTemplates;
  configured: boolean;
}

async function mailFetch(path: string, options: RequestInit = {}): Promise<Response> {
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

async function parseError(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    return data.error || data.message || fallback;
  } catch {
    return fallback;
  }
}

export async function getMailSettings(): Promise<MailSettingsResponse> {
  const res = await mailFetch('/portal/settings/mail');
  if (!res.ok) throw new Error(await parseError(res, 'Failed to load mail settings'));
  return res.json();
}

export async function saveMailSettings(patch: {
  host?: string;
  port?: number;
  secure?: boolean;
  username?: string;
  password?: string;
  clear_password?: boolean;
  from_email?: string;
  from_name?: string;
  reply_to?: string;
  portal_base_url?: string;
}): Promise<{ smtp: SmtpSettingsView; configured: boolean }> {
  const res = await mailFetch('/portal/settings/mail', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await parseError(res, 'Failed to save mail settings'));
  return res.json();
}

export async function saveMailTemplates(templates: Partial<MailTemplates>): Promise<MailTemplates> {
  const res = await mailFetch('/portal/settings/mail/templates', {
    method: 'PATCH',
    body: JSON.stringify(templates),
  });
  if (!res.ok) throw new Error(await parseError(res, 'Failed to save templates'));
  return (await res.json()).templates;
}

export async function sendTestMail(to: string): Promise<void> {
  const res = await mailFetch('/portal/settings/mail/test', {
    method: 'POST',
    body: JSON.stringify({ to }),
  });
  if (!res.ok) throw new Error(await parseError(res, 'Test mail failed'));
}
