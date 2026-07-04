import { useQuery } from '@tanstack/react-query';
import type { Organization } from '@medplum/fhirtypes';
import { medplum } from '../lib/medplum';
import { useAuthStore } from '../stores/auth';

export interface PractitionerRow {
  id: string;
  name: string;
  qualification: string;
  role: string;
  email: string;
  phone: string;
  clinicName: string;
  clinicId: string;
  country: string;
}

async function fetchAllPractitioners(): Promise<PractitionerRow[]> {
  // Fetch all practitioners and organizations in parallel
  const [practitioners, organizations] = await Promise.all([
    medplum.searchResources('Practitioner', { _count: '1000', _sort: 'name' }),
    medplum.searchResources('Organization', { _count: '1000' }),
  ]);

  // Build org lookup by ID
  const orgMap = new Map<string, Organization>();
  for (const org of organizations) {
    if (org.id) orgMap.set(org.id, org);
  }

  return practitioners.map((p) => {
    const nameObj = p.name?.[0];
    const name = nameObj?.text ||
      [nameObj?.prefix?.join(' '), nameObj?.given?.join(' '), nameObj?.family].filter(Boolean).join(' ') ||
      '—';

    const qualification = p.qualification?.[0]?.code?.text || '';

    const role = p.extension?.find(
      e => e.url === 'http://help-cure-als.org/ext/role'
    )?.valueString || '';

    const orgRef = p.extension?.find(
      e => e.url === 'http://help-cure-als.org/ext/organization-ref'
    )?.valueString || '';

    const org = orgMap.get(orgRef);

    const email = p.telecom?.find(t => t.system === 'email')?.value || '';
    const phone = p.telecom?.find(t => t.system === 'phone')?.value || '';
    const country = p.address?.[0]?.country || org?.address?.[0]?.country || '';

    return {
      id: p.id || '',
      name,
      qualification,
      role,
      email,
      phone,
      clinicName: org?.name || '—',
      clinicId: org?.id || '',
      country,
    };
  });
}

export function usePractitioners() {
  const { isAuthenticated } = useAuthStore();

  return useQuery({
    queryKey: ['practitioners'],
    queryFn: fetchAllPractitioners,
    enabled: isAuthenticated,
  });
}
