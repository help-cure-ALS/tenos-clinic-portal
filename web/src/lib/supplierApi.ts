import { medplum } from './medplum';

const SUPPLIER_API_URL = import.meta.env.VITE_SUPPLIER_API_URL || '/sapi';

export function getSupplierPublicBaseUrl(): string {
  const base = SUPPLIER_API_URL.replace(/\/$/, '');
  if (/^https?:\/\//i.test(base)) {
    return base;
  }
  if (typeof window !== 'undefined') {
    const normalized = base.startsWith('/') ? base : `/${base}`;
    return `${window.location.origin}${normalized}`;
  }
  return base;
}

export function buildSupplierInboundProposalsUrl(): string {
  return `${getSupplierPublicBaseUrl()}/v1/provider-exchange/proposals`;
}

export type AidStatus = 'none' | 'suggested' | 'requested' | 'approved' | 'rejected';
export type WorkflowRole = 'patient' | 'caregiver' | 'doctor';

export type WorkflowTransition = {
  from: AidStatus;
  to: AidStatus;
  allowed_roles: WorkflowRole[];
};

export type WorkflowPolicy = {
  country: string;
  transitions: WorkflowTransition[];
  notify_provider_on: AidStatus[];
};

export type WorkflowPolicyListItem = {
  country: string;
  policy: WorkflowPolicy;
  updated_at: string;
};

export type DeliveryAuthMode = 'hmac' | 'bearer';

export type SupplierDeliveryConfig = {
  organization_id: string;
  endpoint_url: string;
  auth_mode: DeliveryAuthMode;
  enabled: boolean;
  timeout_ms: number;
  has_secret: boolean;
  updated_at: string;
};

export type SupplierDeliveryConfigInput = {
  endpoint_url: string;
  auth_mode: DeliveryAuthMode;
  auth_secret?: string;
  enabled?: boolean;
  timeout_ms?: number;
};

export type SupplierDeliveryStatus = {
  organization_id: string;
  configured: boolean;
  status: 'healthy' | 'retrying' | 'failed_manual';
  queued_count: number;
  retrying_count: number;
  failed_manual_count: number;
  delivered_count: number;
  last_attempt_at: string | null;
  last_delivered_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  last_http_status: number | null;
  last_error_at: string | null;
};

export type SupplierDeliveryAttempt = {
  id: number;
  delivery_id: string;
  attempt_no: number;
  started_at: string;
  finished_at: string | null;
  success: boolean;
  http_status: number | null;
  error_code: string | null;
  error_message: string | null;
  response_excerpt: string | null;
  job_status: string;
  idempotency_key: string;
};

export type SupplierIntegrationAdmin = {
  integration_id: string;
  organization_id: string;
  organization_name: string;
  status: string;
  country_code: string | null;
  status_reason: string | null;
  created_at: string;
  updated_at: string;
  deactivated_at: string | null;
  has_active_token: boolean;
  token_created_at: string | null;
  token_revoked_at: string | null;
};

export type SupplierIntegrationCredentials = {
  integration_id: string;
  token: string;
};

export type SupplierAuthTokenStatus = {
  organization_id: string;
  has_active_token: boolean;
  created_at: string | null;
  revoked_at: string | null;
};

export type SupplierAuthTokenCredentials = {
  organization_id: string;
  token: string;
};

async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const accessToken = medplum.getAccessToken();
  if (!accessToken) {
    throw new Error('Not authenticated');
  }

  return fetch(`${SUPPLIER_API_URL}${path}`, {
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

export async function getWorkflowPolicy(country: string): Promise<WorkflowPolicy | null> {
  const normalized = country.trim().toUpperCase();
  if (!normalized) throw new Error('country_required');

  const res = await apiFetch(`/v1/admin/workflow-policy?country=${encodeURIComponent(normalized)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await parseError(res, 'Failed to fetch workflow policy'));
  return res.json();
}

export async function listWorkflowPolicies(): Promise<WorkflowPolicyListItem[]> {
  const res = await apiFetch('/v1/admin/workflow-policies');
  if (!res.ok) throw new Error(await parseError(res, 'Failed to fetch workflow policies'));
  const data = await res.json();
  return data.policies ?? [];
}

export async function upsertWorkflowPolicy(policy: WorkflowPolicy): Promise<void> {
  const res = await apiFetch('/v1/admin/workflow-policy', {
    method: 'POST',
    body: JSON.stringify({ policy }),
  });
  if (!res.ok) throw new Error(await parseError(res, 'Failed to save workflow policy'));
}

export async function getSupplierDeliveryConfig(organizationId: string): Promise<SupplierDeliveryConfig | null> {
  const res = await apiFetch(`/v1/admin/suppliers/${encodeURIComponent(organizationId)}/delivery-config`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await parseError(res, 'Failed to fetch delivery config'));
  return res.json();
}

export async function upsertSupplierDeliveryConfig(
  organizationId: string,
  config: SupplierDeliveryConfigInput,
): Promise<void> {
  const res = await apiFetch(`/v1/admin/suppliers/${encodeURIComponent(organizationId)}/delivery-config`, {
    method: 'PUT',
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error(await parseError(res, 'Failed to save delivery config'));
}

export async function getSupplierDeliveryStatus(organizationId: string): Promise<SupplierDeliveryStatus> {
  const res = await apiFetch(`/v1/admin/suppliers/${encodeURIComponent(organizationId)}/delivery-status`);
  if (!res.ok) throw new Error(await parseError(res, 'Failed to fetch delivery status'));
  return res.json();
}

export async function getSupplierDeliveryAttempts(organizationId: string, limit = 50): Promise<SupplierDeliveryAttempt[]> {
  const res = await apiFetch(
    `/v1/admin/suppliers/${encodeURIComponent(organizationId)}/delivery-attempts?limit=${encodeURIComponent(String(limit))}`,
  );
  if (!res.ok) throw new Error(await parseError(res, 'Failed to fetch delivery attempts'));
  const data = await res.json();
  return data.attempts ?? [];
}

export async function testSupplierDelivery(organizationId: string): Promise<void> {
  const res = await apiFetch(`/v1/admin/suppliers/${encodeURIComponent(organizationId)}/delivery-test`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(await parseError(res, 'Delivery test failed'));
}

export async function replaySupplierDelivery(deliveryId: string): Promise<void> {
  const res = await apiFetch(`/v1/admin/deliveries/${encodeURIComponent(deliveryId)}/replay`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(await parseError(res, 'Failed to replay delivery'));
}

export async function getSupplierIntegrations(organizationId: string): Promise<SupplierIntegrationAdmin[]> {
  const res = await apiFetch(`/v1/admin/suppliers/${encodeURIComponent(organizationId)}/integrations`);
  if (!res.ok) throw new Error(await parseError(res, 'Failed to fetch supplier integrations'));
  const data = await res.json();
  return data.integrations ?? [];
}

export async function createSupplierIntegration(organizationId: string): Promise<SupplierIntegrationCredentials> {
  const res = await apiFetch(`/v1/admin/suppliers/${encodeURIComponent(organizationId)}/integrations`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(await parseError(res, 'Failed to create supplier integration'));
  return res.json();
}

export async function rotateSupplierIntegrationToken(integrationId: string): Promise<SupplierIntegrationCredentials> {
  const res = await apiFetch(`/v1/admin/integrations/${encodeURIComponent(integrationId)}/rotate-token`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(await parseError(res, 'Failed to rotate integration token'));
  return res.json();
}

export async function revokeSupplierIntegration(integrationId: string): Promise<void> {
  const res = await apiFetch(`/v1/admin/integrations/${encodeURIComponent(integrationId)}/revoke`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(await parseError(res, 'Failed to revoke integration'));
}

export async function getSupplierAuthTokenStatus(organizationId: string): Promise<SupplierAuthTokenStatus> {
  const res = await apiFetch(`/v1/admin/suppliers/${encodeURIComponent(organizationId)}/auth-token`);
  if (!res.ok) throw new Error(await parseError(res, 'Failed to fetch supplier auth token status'));
  return res.json();
}

export async function rotateSupplierAuthToken(organizationId: string): Promise<SupplierAuthTokenCredentials> {
  const res = await apiFetch(`/v1/admin/suppliers/${encodeURIComponent(organizationId)}/auth-token/rotate`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(await parseError(res, 'Failed to rotate supplier auth token'));
  return res.json();
}

export async function revokeSupplierAuthToken(organizationId: string): Promise<void> {
  const res = await apiFetch(`/v1/admin/suppliers/${encodeURIComponent(organizationId)}/auth-token/revoke`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(await parseError(res, 'Failed to revoke supplier auth token'));
}
