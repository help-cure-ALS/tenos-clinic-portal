import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getInvitations, createInvitation, deleteInvitation } from '../lib/api';
import { useAuthStore } from '../stores/auth';

export function useInvitations() {
  const { isAuthenticated } = useAuthStore();

  return useQuery({
    queryKey: ['invitations'],
    queryFn: getInvitations,
    enabled: isAuthenticated,
  });
}

export function useCreateInvitation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { clinic_id: string; email?: string; role?: string }) =>
      createInvitation(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invitations'] });
    },
  });
}

export function useDeleteInvitation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteInvitation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invitations'] });
    },
  });
}
