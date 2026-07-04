import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createSupplierIntegration,
  getSupplierAuthTokenStatus,
  getSupplierDeliveryAttempts,
  getSupplierDeliveryConfig,
  getSupplierIntegrations,
  getSupplierDeliveryStatus,
  revokeSupplierAuthToken,
  revokeSupplierIntegration,
  replaySupplierDelivery,
  rotateSupplierAuthToken,
  rotateSupplierIntegrationToken,
  testSupplierDelivery,
  upsertSupplierDeliveryConfig,
  type SupplierDeliveryConfigInput,
} from '../lib/supplierApi';
import { useAuthStore } from '../stores/auth';

export function useSupplierDeliveryConfig(organizationId: string) {
  const { isAuthenticated } = useAuthStore();
  return useQuery({
    queryKey: ['supplier-delivery-config', organizationId],
    queryFn: () => getSupplierDeliveryConfig(organizationId),
    enabled: isAuthenticated && !!organizationId,
  });
}

export function useSupplierDeliveryStatus(organizationId: string) {
  const { isAuthenticated } = useAuthStore();
  return useQuery({
    queryKey: ['supplier-delivery-status', organizationId],
    queryFn: () => getSupplierDeliveryStatus(organizationId),
    enabled: isAuthenticated && !!organizationId,
  });
}

export function useSupplierDeliveryAttempts(organizationId: string, limit = 50) {
  const { isAuthenticated } = useAuthStore();
  return useQuery({
    queryKey: ['supplier-delivery-attempts', organizationId, limit],
    queryFn: () => getSupplierDeliveryAttempts(organizationId, limit),
    enabled: isAuthenticated && !!organizationId,
  });
}

export function useSupplierIntegrations(organizationId: string) {
  const { isAuthenticated } = useAuthStore();
  return useQuery({
    queryKey: ['supplier-integrations', organizationId],
    queryFn: () => getSupplierIntegrations(organizationId),
    enabled: isAuthenticated && !!organizationId,
  });
}

export function useSupplierAuthTokenStatus(organizationId: string) {
  const { isAuthenticated } = useAuthStore();
  return useQuery({
    queryKey: ['supplier-auth-token', organizationId],
    queryFn: () => getSupplierAuthTokenStatus(organizationId),
    enabled: isAuthenticated && !!organizationId,
  });
}

export function useUpsertSupplierDeliveryConfig(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (config: SupplierDeliveryConfigInput) => upsertSupplierDeliveryConfig(organizationId, config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier-delivery-config', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['supplier-delivery-status', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['supplier-delivery-attempts', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['supplier-delivery-statuses'] });
    },
  });
}

export function useCreateSupplierIntegration(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => createSupplierIntegration(organizationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier-integrations', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['supplier-delivery-statuses'] });
    },
  });
}

export function useRotateSupplierAuthToken(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => rotateSupplierAuthToken(organizationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier-auth-token', organizationId] });
    },
  });
}

export function useRevokeSupplierAuthToken(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => revokeSupplierAuthToken(organizationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier-auth-token', organizationId] });
    },
  });
}

export function useRotateSupplierIntegrationToken(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (integrationId: string) => rotateSupplierIntegrationToken(integrationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier-integrations', organizationId] });
    },
  });
}

export function useRevokeSupplierIntegration(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (integrationId: string) => revokeSupplierIntegration(integrationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier-integrations', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['supplier-delivery-status', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['supplier-delivery-attempts', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['supplier-delivery-statuses'] });
    },
  });
}

export function useTestSupplierDelivery(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => testSupplierDelivery(organizationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier-delivery-status', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['supplier-delivery-attempts', organizationId] });
    },
  });
}

export function useReplaySupplierDelivery(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deliveryId: string) => replaySupplierDelivery(deliveryId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier-delivery-status', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['supplier-delivery-attempts', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['supplier-delivery-statuses'] });
    },
  });
}
