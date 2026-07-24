/**
 * React Query hooks for verification management via API.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getPendingVerifications,
  confirmVerification,
  rejectVerification,
  getVerificationTokens,
  revokeToken,
  getPendingProjectApplications,
  confirmProjectApplication,
  rejectProjectApplication,
} from '../lib/api';
import type { PendingRequest, VerificationTokenResponse } from '../lib/api';
import { useAuthStore } from '../stores/auth';

export type { PendingRequest as VerificationRequest };
export type { VerificationTokenResponse as VerificationToken };

export function useVerifications() {
  const { isAuthenticated } = useAuthStore();

  return useQuery({
    queryKey: ['verifications', 'pending'],
    queryFn: getPendingVerifications,
    enabled: isAuthenticated,
    refetchInterval: 5000,
  });
}

export function useApproveVerification() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      code,
      diagnosis,
    }: {
      code: string;
      diagnosis: { system: string; code: string; display?: string };
    }) => {
      return confirmVerification(code, diagnosis);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['verifications'] });
    },
  });
}

export function useRejectVerification() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (code: string) => rejectVerification(code),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['verifications'] });
    },
  });
}

export function useProjectApplications() {
  const { isAuthenticated } = useAuthStore();

  return useQuery({
    queryKey: ['project-applications', 'pending'],
    queryFn: getPendingProjectApplications,
    enabled: isAuthenticated,
    refetchInterval: 5000,
  });
}

export function useApproveProjectApplication() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (code: string) => confirmProjectApplication(code),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-applications'] });
    },
  });
}

export function useRejectProjectApplication() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (code: string) => rejectProjectApplication(code),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-applications'] });
    },
  });
}

export function useVerificationTokens() {
  const { isAuthenticated } = useAuthStore();

  return useQuery({
    queryKey: ['verifications', 'tokens'],
    queryFn: getVerificationTokens,
    enabled: isAuthenticated,
  });
}

export function useRevokeToken() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (tokenId: string) => revokeToken(tokenId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['verifications', 'tokens'] });
    },
  });
}
