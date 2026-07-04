import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getWorkflowPolicy, listWorkflowPolicies, upsertWorkflowPolicy } from '../lib/supplierApi';
import type { WorkflowPolicy } from '../lib/supplierApi';
import { useAuthStore } from '../stores/auth';

export function useSupplierWorkflowPolicy(country: string) {
  const { isAuthenticated } = useAuthStore();
  const normalized = country.trim().toUpperCase();

  return useQuery({
    queryKey: ['supplier-workflow-policy', normalized],
    queryFn: () => getWorkflowPolicy(normalized),
    enabled: isAuthenticated && normalized.length > 0,
  });
}

export function useSupplierWorkflowPolicyList() {
  const { isAuthenticated } = useAuthStore();

  return useQuery({
    queryKey: ['supplier-workflow-policies'],
    queryFn: listWorkflowPolicies,
    enabled: isAuthenticated,
  });
}

export function useUpsertSupplierWorkflowPolicy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (policy: WorkflowPolicy) => upsertWorkflowPolicy(policy),
    onSuccess: (_data, policy) => {
      const normalized = policy.country.trim().toUpperCase();
      queryClient.invalidateQueries({ queryKey: ['supplier-workflow-policies'] });
      queryClient.invalidateQueries({ queryKey: ['supplier-workflow-policy', normalized] });
    },
  });
}
