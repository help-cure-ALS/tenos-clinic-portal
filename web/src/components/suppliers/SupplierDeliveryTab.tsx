import { useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Center,
  Code,
  Group,
  Loader,
  Modal,
  NumberInput,
  Paper,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';

import {
  useRevokeSupplierAuthToken,
  useRotateSupplierAuthToken,
  useSupplierAuthTokenStatus,
  useSupplierDeliveryConfig,
  useSupplierDeliveryStatus,
  useTestSupplierDelivery,
  useUpsertSupplierDeliveryConfig,
} from '../../hooks/useSupplierDelivery';
import { buildSupplierInboundProposalsUrl } from '../../lib/supplierApi';
import { AlertTriangle, Key, RefreshCw, Send, Settings, Trash2 } from 'lucide-react';

type Props = {
  organizationId: string;
};

function statusColor(status: 'healthy' | 'retrying' | 'failed_manual'): string {
  if (status === 'healthy') return 'green';
  if (status === 'retrying') return 'yellow';
  return 'red';
}

export function SupplierDeliveryTab({ organizationId }: Props) {
  const { t } = useTranslation();
  const authTokenQuery = useSupplierAuthTokenStatus(organizationId);
  const configQuery = useSupplierDeliveryConfig(organizationId);
  const statusQuery = useSupplierDeliveryStatus(organizationId);
  const rotateAuthToken = useRotateSupplierAuthToken(organizationId);
  const revokeAuthToken = useRevokeSupplierAuthToken(organizationId);
  const saveConfig = useUpsertSupplierDeliveryConfig(organizationId);
  const testDelivery = useTestSupplierDelivery(organizationId);

  const [endpointUrl, setEndpointUrl] = useState('');
  const [authMode, setAuthMode] = useState<'hmac' | 'bearer'>('bearer');
  const [enabled, setEnabled] = useState(true);
  const [timeoutMs, setTimeoutMs] = useState(10000);
  const [secret, setSecret] = useState('');
  const [supplierTokenModal, setSupplierTokenModal] = useState<{ token: string } | null>(null);

  useEffect(() => {
    const cfg = configQuery.data;
    if (!cfg) return;
    setEndpointUrl(cfg.endpoint_url);
    setAuthMode(cfg.auth_mode);
    setEnabled(cfg.enabled);
    setTimeoutMs(cfg.timeout_ms);
  }, [configQuery.data]);

  const saveDisabled = !endpointUrl.trim() || !authMode || saveConfig.isPending;

  const inboundProposalsUrl = buildSupplierInboundProposalsUrl();

  const copyToClipboard = async (value: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      notifications.show({
        title: t('common.saved'),
        message: t('suppliers.integrationCopied'),
        color: 'green',
      });
    } catch {
      notifications.show({
        title: t('common.error'),
        message: t('suppliers.integrationCopyError'),
        color: 'red',
      });
    }
  };

  const handleRotateSupplierToken = async () => {
    try {
      const result = await rotateAuthToken.mutateAsync();
      setSupplierTokenModal({ token: result.token });
      notifications.show({
        title: t('common.saved'),
        message: t('suppliers.supplierTokenRotated'),
        color: 'green',
      });
    } catch (err: any) {
      notifications.show({
        title: t('common.error'),
        message: err?.message ?? t('suppliers.supplierTokenRotateError'),
        color: 'red',
      });
    }
  };

  const handleRevokeSupplierToken = () => {
    modals.openConfirmModal({
      title: t('suppliers.supplierTokenRevokeTitle'),
      children: <Text size="sm">{t('suppliers.supplierTokenRevokeConfirm')}</Text>,
      labels: {
        confirm: t('suppliers.supplierTokenRevoke'),
        cancel: t('common.cancel'),
      },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          await revokeAuthToken.mutateAsync();
          notifications.show({
            title: t('common.saved'),
            message: t('suppliers.supplierTokenRevoked'),
            color: 'green',
          });
        } catch (err: any) {
          notifications.show({
            title: t('common.error'),
            message: err?.message ?? t('suppliers.supplierTokenRevokeError'),
            color: 'red',
          });
        }
      },
    });
  };

  const handleSave = async () => {
    try {
      await saveConfig.mutateAsync({
        endpoint_url: endpointUrl.trim(),
        auth_mode: authMode,
        enabled,
        timeout_ms: Math.max(1000, Math.min(120000, Math.floor(timeoutMs || 10000))),
        auth_secret: secret.trim() || undefined,
      });
      setSecret('');
      notifications.show({
        title: t('common.saved'),
        message: t('suppliers.deliverySaved'),
        color: 'green',
      });
    } catch (err: any) {
      notifications.show({
        title: t('common.error'),
        message: err?.message ?? t('suppliers.deliverySaveError'),
        color: 'red',
      });
    }
  };

  const handleTest = async () => {
    try {
      await testDelivery.mutateAsync();
      notifications.show({
        title: t('common.saved'),
        message: t('suppliers.deliveryTestOk'),
        color: 'green',
      });
    } catch (err: any) {
      notifications.show({
        title: t('common.error'),
        message: err?.message ?? t('suppliers.deliveryTestError'),
        color: 'red',
      });
    }
  };

  if (statusQuery.isLoading || configQuery.isLoading || authTokenQuery.isLoading) {
    return <Center h={180}><Loader color="hca-purple" /></Center>;
  }

  const status = statusQuery.data;
  const tokenStatus = authTokenQuery.data;
  const supplierTokenActive = !!tokenStatus?.has_active_token;

  return (
    <Stack gap="md">
      <Paper withBorder p="md">
        <Group justify="space-between" mb="sm">
          <div>
            <Text fw={600}>{t('suppliers.supplierAccessTitle')}</Text>
            <Text size="sm" c="dimmed">{t('suppliers.supplierAccessHint')}</Text>
          </div>
          <Badge variant="light" color={supplierTokenActive ? 'green' : 'red'}>
            {supplierTokenActive
              ? t('suppliers.supplierTokenActive')
              : t('suppliers.supplierTokenMissing')}
          </Badge>
        </Group>

        <Stack gap="xs">
          <Text size="sm" fw={600}>{t('suppliers.supplierInboundUrl')}</Text>
          <Code block>{inboundProposalsUrl}</Code>
          <Text size="sm" c="dimmed">{t('suppliers.supplierContractHint')}</Text>

          <Group>
            <Button
              size="xs"
              variant="default"
              onClick={() => copyToClipboard(inboundProposalsUrl)}
            >
              {t('suppliers.integrationCopyUrl')}
            </Button>
            <Button
              size="xs"
              variant="default"
              leftSection={<Key size={12} />}
              onClick={handleRotateSupplierToken}
              loading={rotateAuthToken.isPending}
            >
              {t('suppliers.supplierTokenRotate')}
            </Button>
            <Button
              size="xs"
              variant="light"
              color="red"
              leftSection={<Trash2 size={12} />}
              onClick={handleRevokeSupplierToken}
              loading={revokeAuthToken.isPending}
              disabled={!supplierTokenActive}
            >
              {t('suppliers.supplierTokenRevoke')}
            </Button>
          </Group>
        </Stack>
      </Paper>

      <Paper withBorder p="md">
        <Group justify="space-between" align="flex-start">
          <div>
            <Text fw={600}>{t('suppliers.deliveryStatusTitle')}</Text>
            <Text size="sm" c="dimmed">{t('suppliers.deliveryStatusHint')}</Text>
          </div>
          {status && (
            <Badge variant="light" color={statusColor(status.status)}>
              {t(`suppliers.deliveryState.${status.status}`)}
            </Badge>
          )}
        </Group>

        {status?.last_error_message && (
          <Alert mt="md" color="red" icon={<AlertTriangle size={16} />}>
            <Text size="sm">
              {status.last_error_code ?? 'error'}: {status.last_error_message}
            </Text>
          </Alert>
        )}

        <Group mt="md" gap="xl">
          <div>
            <Text size="xs" c="dimmed">{t('suppliers.deliveryQueued')}</Text>
            <Text fw={600}>{status?.queued_count ?? 0}</Text>
          </div>
          <div>
            <Text size="xs" c="dimmed">{t('suppliers.deliveryRetrying')}</Text>
            <Text fw={600}>{status?.retrying_count ?? 0}</Text>
          </div>
          <div>
            <Text size="xs" c="dimmed">{t('suppliers.deliveryFailedManual')}</Text>
            <Text fw={600}>{status?.failed_manual_count ?? 0}</Text>
          </div>
          <div>
            <Text size="xs" c="dimmed">{t('suppliers.deliveryDelivered')}</Text>
            <Text fw={600}>{status?.delivered_count ?? 0}</Text>
          </div>
        </Group>
      </Paper>

      <Paper withBorder p="md">
        <Group justify="space-between" mb="sm">
          <Text fw={600}>{t('suppliers.deliveryConfigTitle')}</Text>
          <Button
            variant="default"
            size="xs"
            leftSection={<RefreshCw size={14} />}
            onClick={() => {
              void authTokenQuery.refetch();
              void configQuery.refetch();
              void statusQuery.refetch();
            }}
          >
            {t('common.refresh')}
          </Button>
        </Group>

        <Stack gap="sm">
          <TextInput
            label={t('suppliers.deliveryEndpoint')}
            value={endpointUrl}
            onChange={(e) => setEndpointUrl(e.currentTarget.value)}
            placeholder="https://supplier.example.com/webhook/hca"
          />

          <Group grow>
            <Select
              label={t('suppliers.deliveryAuthMode')}
              data={[
                { value: 'bearer', label: 'Bearer' },
                { value: 'hmac', label: 'HMAC' },
              ]}
              value={authMode}
              onChange={(value) => setAuthMode((value as 'hmac' | 'bearer') || 'bearer')}
            />
            <NumberInput
              label={t('suppliers.deliveryTimeoutMs')}
              value={timeoutMs}
              onChange={(value) => setTimeoutMs(Number(value || 10000))}
              min={1000}
              max={120000}
              step={500}
            />
          </Group>

          <TextInput
            label={t('suppliers.deliverySecret')}
            value={secret}
            onChange={(e) => setSecret(e.currentTarget.value)}
            placeholder={configQuery.data?.has_secret ? t('suppliers.deliverySecretPlaceholderExisting') : t('suppliers.deliverySecretPlaceholder')}
          />

          <Group justify="space-between">
            <Switch
              checked={enabled}
              onChange={(e) => setEnabled(e.currentTarget.checked)}
              label={t('suppliers.deliveryEnabled')}
            />

            <Group>
              <Button
                variant="default"
                leftSection={<Send size={14} />}
                onClick={handleTest}
                loading={testDelivery.isPending}
              >
                {t('suppliers.deliveryTest')}
              </Button>
              <Button
                color="hca-purple"
                leftSection={<Settings size={14} />}
                onClick={handleSave}
                loading={saveConfig.isPending}
                disabled={saveDisabled}
              >
                {t('common.save')}
              </Button>
            </Group>
          </Group>
        </Stack>
      </Paper>

      <Modal
        opened={!!supplierTokenModal}
        onClose={() => setSupplierTokenModal(null)}
        title={t('suppliers.supplierTokenModalTitle')}
        centered
        size="lg"
      >
        <Stack gap="sm">
          <Text size="sm" c="dimmed">{t('suppliers.supplierTokenModalHint')}</Text>
          <Text size="sm" fw={600}>{t('suppliers.supplierInboundUrl')}</Text>
          <Code block>{inboundProposalsUrl}</Code>
          <Text size="sm" fw={600}>{t('suppliers.supplierToken')}</Text>
          <Code block>{supplierTokenModal?.token ?? ''}</Code>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => copyToClipboard(inboundProposalsUrl)}>
              {t('suppliers.integrationCopyUrl')}
            </Button>
            <Button color="hca-purple" onClick={() => copyToClipboard(supplierTokenModal?.token ?? '')}>
              {t('suppliers.integrationCopyToken')}
            </Button>
          </Group>
        </Stack>
      </Modal>

    </Stack>
  );
}
