/**
 * Verification Service API helpers.
 * All calls to the verification-service (Fastify backend) go through here.
 */

import { medplum } from './medplum';

const API_URL = import.meta.env.VITE_VERIFICATION_API_URL || '/vapi';

async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const accessToken = medplum.getAccessToken();
  if (!accessToken) {
    throw new Error('Not authenticated');
  }
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

// ============================================================
// Verification endpoints
// ============================================================

export interface PendingRequest {
  id: string;
  code: string;
  device_id: string;
  clinic_id: string;
  created_at: string;
  expires_at: string;
}

export interface VerificationTokenResponse {
  tokenId: string;
  status: 'valid' | 'revoked';
  clinicId: string;
  clinicPseudonym: string;
  issuedAt: string;
  diagnosis?: { system: string; code: string; display?: string };
}

export async function getPendingVerifications(): Promise<PendingRequest[]> {
  const res = await apiFetch('/verify/pending');
  if (!res.ok) throw new Error(await parseError(res, 'Failed to fetch pending verifications'));
  const data = await res.json();
  return data.requests ?? [];
}

export async function confirmVerification(
  code: string,
  diagnosis: { system: string; code: string; display?: string }
): Promise<{ token_id: string; clinic_pseudonym: string }> {
  const res = await apiFetch(`/verify/confirm/${code}`, {
    method: 'POST',
    body: JSON.stringify({ diagnosis }),
  });
  if (!res.ok) throw new Error(await parseError(res, 'Confirmation failed'));
  return res.json();
}

export async function rejectVerification(code: string): Promise<void> {
  const res = await apiFetch(`/verify/reject/${code}`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(await parseError(res, 'Rejection failed'));
}

export async function getVerificationTokens(): Promise<VerificationTokenResponse[]> {
  const res = await apiFetch('/verify/tokens');
  if (!res.ok) throw new Error(await parseError(res, 'Failed to fetch tokens'));
  const data = await res.json();
  return data.tokens ?? [];
}

export async function revokeToken(tokenId: string): Promise<void> {
  const res = await apiFetch(`/verify/tokens/${tokenId}/revoke`, { method: 'POST', body: JSON.stringify({}) });
  if (!res.ok) throw new Error(await parseError(res, 'Revocation failed'));
}

// ============================================================
// Admin endpoints
// ============================================================

export async function toggleClinicVerification(clinicId: string, enabled: boolean): Promise<void> {
  const res = await apiFetch(`/admin/clinics/${clinicId}/verification`, {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error(await parseError(res, 'Failed to toggle verification'));
}

// ============================================================
// Invitation endpoints
// ============================================================

export interface Invitation {
  id: string;
  token: string;
  clinic_id: string;
  email: string | null;
  role: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

export async function createInvitation(data: {
  clinic_id: string;
  email?: string;
  role?: string;
}): Promise<Invitation> {
  const res = await apiFetch('/admin/invitations', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await parseError(res, 'Failed to create invitation'));
  return res.json();
}

export async function getInvitations(): Promise<Invitation[]> {
  const res = await apiFetch('/admin/invitations');
  if (!res.ok) throw new Error(await parseError(res, 'Failed to fetch invitations'));
  const data = await res.json();
  return data.invitations ?? [];
}

export async function deleteInvitation(id: string): Promise<void> {
  const res = await apiFetch(`/admin/invitations/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await parseError(res, 'Failed to delete invitation'));
}

export async function getInvitationByToken(token: string): Promise<Invitation & { clinic_name: string }> {
  const res = await fetch(`${API_URL}/invitations/${token}`);
  if (!res.ok) throw new Error(await parseError(res, 'Invitation not found'));
  return res.json();
}

export async function redeemInvitation(token: string, data: {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}): Promise<void> {
  const res = await fetch(`${API_URL}/invitations/${token}/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await parseError(res, 'Registration failed'));
}

// ============================================================
// User management endpoints
// ============================================================

export interface ClinicUser {
  practitionerId: string;
  practitionerRoleId: string;
  firstName: string;
  lastName: string;
  email: string;
  clinicRole: string | null;
  canVerify: boolean;
}

export async function getClinicUsers(clinicId: string): Promise<ClinicUser[]> {
  const res = await apiFetch(`/clinics/${clinicId}/users`);
  if (!res.ok) throw new Error(await parseError(res, 'Failed to fetch users'));
  const data = await res.json();
  return data.users ?? [];
}

export async function updateUserPermissions(userId: string, permissions: {
  canVerify?: boolean;
  clinicRole?: string;
}): Promise<void> {
  const res = await apiFetch(`/users/${userId}/permissions`, {
    method: 'PATCH',
    body: JSON.stringify(permissions),
  });
  if (!res.ok) throw new Error(await parseError(res, 'Failed to update permissions'));
}

export async function updateUserName(userId: string, data: {
  firstName: string;
  lastName: string;
}): Promise<void> {
  const res = await apiFetch(`/users/${userId}/name`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await parseError(res, 'Failed to update name'));
}

export async function deleteUser(userId: string): Promise<void> {
  const res = await apiFetch(`/users/${userId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await parseError(res, 'Failed to delete user'));
}
