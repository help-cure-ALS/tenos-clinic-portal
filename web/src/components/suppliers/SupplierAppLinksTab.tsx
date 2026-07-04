import { useState } from 'react';
import {
  Badge,
  Button,
  Center,
  Code,
  Group,
  Loader,
  Modal,
  Paper,
  Stack,
  Table,
  Text,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';

import {
  useRevokeSupplierIntegration,
  useRotateSupplierIntegrationToken,
  useSupplierIntegrations,
} from '../../hooks/useSupplierDelivery';
import { Trash2 } from 'lucide-react';

type Props = {
  organizationId: string;
};

export function SupplierAppLinksTab({ organizationId }: Props) {
  const { t } = useTranslation();
  const integrationsQuery = useSupplierIntegrations(organizationId);
  const rotateIntegrationToken = useRotateSupplierIntegrationToken(organizationId);
  const revokeIntegration = useRevokeSupplierIntegration(organizationId);

  const [credentialModal, setCredentialModal] = useState<{ integrationId: string; token: string } | null>(null);

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

  const handleRotateToken = async (integrationId: string) => {
    try {
      const result = await rotateIntegrationToken.mutateAsync(integrationId);
      setCredentialModal({ integrationId: result.integration_id, token: result.token });
      notifications.show({
        title: t('common.saved'),
        message: t('suppliers.integrationRotated'),
        color: 'green',
      });
    } catch (err: any) {
      notifications.show({
        title: t('common.error'),
        message: err?.message ?? t('suppliers.integrationRotateError'),
        color: 'red',
      });
    }
  };

  const handleRevokeIntegration = (integrationId: string) => {
    modals.openConfirmModal({
      title: t('suppliers.integrationRevokeTitle'),
      children: <Text size="sm">{t('suppliers.integrationRevokeConfirm')}</Text>,
      labels: {
        confirm: t('suppliers.integrationRevoke'),
        cancel: t('common.cancel'),
      },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          await revokeIntegration.mutateAsync(integrationId);
          notifications.show({
            title: t('common.saved'),
            message: t('suppliers.integrationRevoked'),
            color: 'green',
          });
        } catch (err: any) {
          notifications.show({
            title: t('common.error'),
            message: err?.message ?? t('suppliers.integrationRevokeError'),
            color: 'red',
          });
        }
      },
    });
  };

  if (integrationsQuery.isLoading) {
    return <Center h={180}><Loader color="hca-purple" /></Center>;
  }

  return (
    <Stack gap="md">
      <Paper withBorder p="md">
        <Text fw={600}>{t('suppliers.appLinksTitle')}</Text>
        <Text size="sm" c="dimmed" mb="sm">{t('suppliers.appLinksHint')}</Text>

        {(integrationsQuery.data ?? []).length === 0 ? (
          <Text size="sm" c="dimmed">{t('suppliers.appLinksEmpty')}</Text>
        ) : (
          <Table striped withTableBorder withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('suppliers.integrationId')}</Table.Th>
                <Table.Th>{t('suppliers.integrationStatus')}</Table.Th>
                <Table.Th>{t('suppliers.integrationTokenState')}</Table.Th>
                <Table.Th>{t('suppliers.integrationCreatedAt')}</Table.Th>
                <Table.Th>{t('suppliers.integrationActions')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(integrationsQuery.data ?? []).map((integration) => (
                <Table.Tr key={integration.integration_id}>
                  <Table.Td><Code>{integration.integration_id}</Code></Table.Td>
                  <Table.Td>
                    <Badge variant="light" color={integration.status === 'active' ? 'green' : 'gray'}>
                      {integration.status}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light" color={integration.has_active_token ? 'green' : 'red'}>
                      {integration.has_active_token
                        ? t('suppliers.integrationTokenActive')
                        : t('suppliers.integrationTokenRevoked')}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{new Date(integration.created_at).toLocaleString()}</Table.Td>
                  <Table.Td>
                    <Group gap="xs">
                      <Button
                        size="xs"
                        variant="default"
                        onClick={() => handleRotateToken(integration.integration_id)}
                        loading={rotateIntegrationToken.isPending}
                        disabled={integration.status !== 'active'}
                      >
                        {t('suppliers.integrationRotate')}
                      </Button>
                      <Button
                        size="xs"
                        variant="light"
                        color="red"
                        leftSection={<Trash2 size={12} />}
                        onClick={() => handleRevokeIntegration(integration.integration_id)}
                        loading={revokeIntegration.isPending}
                        disabled={integration.status === 'revoked'}
                      >
                        {t('suppliers.integrationRevoke')}
                      </Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Paper>

      <Modal
        opened={!!credentialModal}
        onClose={() => setCredentialModal(null)}
        title={t('suppliers.integrationCredentialsTitle')}
        centered
        size="lg"
      >
        <Stack gap="sm">
          <Text size="sm" c="dimmed">{t('suppliers.integrationCredentialsHint')}</Text>
          <Text size="sm" fw={600}>{t('suppliers.integrationId')}</Text>
          <Code block>{credentialModal?.integrationId ?? ''}</Code>
          <Text size="sm" fw={600}>{t('suppliers.integrationToken')}</Text>
          <Code block>{credentialModal?.token ?? ''}</Code>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => copyToClipboard(credentialModal?.integrationId ?? '')}>
              {t('suppliers.integrationCopyId')}
            </Button>
            <Button color="hca-purple" onClick={() => copyToClipboard(credentialModal?.token ?? '')}>
              {t('suppliers.integrationCopyToken')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
