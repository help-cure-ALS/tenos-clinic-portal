/**
 * Medplum client configuration.
 * Only FHIR/auth operations — verification-service calls are in lib/api.ts
 */

import { MedplumClient } from '@medplum/core';
import type { Organization, Practitioner, PractitionerRole } from '@medplum/fhirtypes';

export const VERIFICATION_TAG = 'urn:hca:verification|enabled';
export const SUPPLIER_TAG = 'urn:hca:supplier|enabled';
export const SUPPLIER_SPECIALTY_SYSTEM = 'urn:hca:supplier-specialty';

export const medplum = new MedplumClient({
  baseUrl: import.meta.env.VITE_MEDPLUM_URL || 'http://localhost:8070/api',
  clientId: import.meta.env.VITE_MEDPLUM_CLIENT_ID,
  onUnauthenticated: () => {
    if (!window.location.pathname.startsWith('/app/login') &&
        !window.location.pathname.startsWith('/app/register')) {
      window.location.href = '/app/login';
    }
  },
});

/**
 * Get the currently logged-in practitioner's organization via PractitionerRole
 */
export async function getMyOrganization(practitioner?: Practitioner | null): Promise<Organization | null> {
  const profile = practitioner || medplum.getProfile();
  if (!profile || profile.resourceType !== 'Practitioner') return null;

  const roles = await medplum.searchResources('PractitionerRole', {
    practitioner: `Practitioner/${profile.id}`,
  });

  if (roles.length === 0) return null;

  const orgRef = roles[0].organization;
  if (!orgRef?.reference) return null;

  return medplum.readReference(orgRef);
}

/**
 * Get the first PractitionerRole for a practitioner
 */
export async function getMyPractitionerRole(practitioner?: Practitioner | null): Promise<PractitionerRole | null> {
  const profile = practitioner || medplum.getProfile();
  if (!profile || profile.resourceType !== 'Practitioner') return null;

  const roles = await medplum.searchResources('PractitionerRole', {
    practitioner: `Practitioner/${profile.id}`,
  });

  return roles.length > 0 ? roles[0] : null;
}

/**
 * Get all organizations
 */
export async function getAllOrganizations(activeOnly = false): Promise<Organization[]> {
  const params: Record<string, string> = { _sort: 'name', _count: '1000' };
  if (activeOnly) params._tag = VERIFICATION_TAG;
  return medplum.searchResources('Organization', params);
}

/**
 * Get all supplier organizations (tagged with urn:hca:supplier|enabled)
 */
export async function getAllSupplierOrganizations(): Promise<Organization[]> {
  const organizations = await medplum.searchResources('Organization', {
    _sort: 'name',
    _count: '1000',
  });

  return organizations.filter((org) => {
    const hasTag = (org.meta?.tag ?? []).some(
      (t) => t.system === 'urn:hca:supplier' && t.code === 'enabled',
    );
    const hasSupplierType = (org.type ?? []).some((type) =>
      (type.coding ?? []).some((coding) => coding.system === SUPPLIER_SPECIALTY_SYSTEM),
    );
    return hasTag || hasSupplierType;
  });
}
