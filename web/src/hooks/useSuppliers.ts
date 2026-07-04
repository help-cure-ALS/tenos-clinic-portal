import { useQuery } from '@tanstack/react-query';
import { getAllSupplierOrganizations, medplum } from '../lib/medplum';
import { useAuthStore } from '../stores/auth';

export function useSuppliers() {
  const { isAuthenticated } = useAuthStore();

  return useQuery({
    queryKey: ['suppliers'],
    queryFn: () => getAllSupplierOrganizations(),
    enabled: isAuthenticated,
  });
}

export function useSupplier(supplierId: string) {
  const { isAuthenticated } = useAuthStore();

  return useQuery({
    queryKey: ['suppliers', supplierId],
    queryFn: () => medplum.readResource('Organization', supplierId),
    enabled: isAuthenticated && !!supplierId,
  });
}
