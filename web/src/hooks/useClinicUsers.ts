import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getClinicUsers, updateUserPermissions, updateUserName, deleteUser } from '../lib/api';
import { useAuthStore } from '../stores/auth';

export function useClinicUsers(clinicId: string) {
  const { isAuthenticated } = useAuthStore();

  return useQuery({
    queryKey: ['clinic-users', clinicId],
    queryFn: () => getClinicUsers(clinicId),
    enabled: isAuthenticated && !!clinicId,
  });
}

export function useUpdateUserPermissions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, permissions }: {
      userId: string;
      permissions: { canVerify?: boolean; clinicRole?: string };
    }) => updateUserPermissions(userId, permissions),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clinic-users'] });
    },
  });
}

export function useUpdateUserName() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, firstName, lastName }: {
      userId: string;
      firstName: string;
      lastName: string;
    }) => updateUserName(userId, { firstName, lastName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clinic-users'] });
    },
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) => deleteUser(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clinic-users'] });
    },
  });
}
