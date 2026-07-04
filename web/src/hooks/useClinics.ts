import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAllOrganizations, medplum } from '../lib/medplum';
import { toggleClinicVerification } from '../lib/api';
import { useAuthStore } from '../stores/auth';

export function useClinics(activeOnly = false) {
  const { isAuthenticated } = useAuthStore();

  return useQuery({
    queryKey: ['clinics', { activeOnly }],
    queryFn: () => getAllOrganizations(activeOnly),
    enabled: isAuthenticated,
  });
}

export function useClinic(clinicId: string) {
  const { isAuthenticated } = useAuthStore();

  return useQuery({
    queryKey: ['clinics', clinicId],
    queryFn: () => medplum.readResource('Organization', clinicId),
    enabled: isAuthenticated && !!clinicId,
  });
}

export function useToggleVerification() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ clinicId, enabled }: { clinicId: string; enabled: boolean }) =>
      toggleClinicVerification(clinicId, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clinics'] });
    },
  });
}
