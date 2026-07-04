import { useMemo } from 'react';
import { Button, Center, Loader, Paper, Stack, Table, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';

import { useReplaySupplierDelivery, useSupplierDeliveryAttempts } from '../../hooks/useSupplierDelivery';
import { Play } from 'lucide-react';

type Props = {
  organizationId: string;
};

export function SupplierDeliveryAttemptsTab({ organizationId }: Props) {
  const { t } = useTranslation();
  const attemptsQuery = useSupplierDeliveryAttempts(organizationId, 80);
  const replayDelivery = useReplaySupplierDelivery(organizationId);

  const latestByDelivery = useMemo(() => {
    const seen = new Set<string>();
    const rows = [];
    for (const item of attemptsQuery.data ?? []) {
      if (seen.has(item.delivery_id)) continue;
      seen.add(item.delivery_id);
      rows.push(item);
    }
    return rows;
  }, [attemptsQuery.data]);

  if (attemptsQuery.isLoading) {
    return <Center h={180}><Loader color="hca-purple" /></Center>;
  }

  return (
    <Stack gap="md">
      <Paper withBorder p="md">
        <Text fw={600} mb="sm">{t('suppliers.deliveryAttemptsTitle')}</Text>
        {latestByDelivery.length === 0 ? (
          <Text size="sm" c="dimmed">{t('suppliers.deliveryAttemptsEmpty')}</Text>
        ) : (
          <Table striped withTableBorder withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('suppliers.deliveryAttemptAt')}</Table.Th>
                <Table.Th>{t('suppliers.deliveryAttemptResult')}</Table.Th>
                <Table.Th>{t('suppliers.deliveryAttemptStatus')}</Table.Th>
                <Table.Th>{t('suppliers.deliveryAttemptAction')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {latestByDelivery.map((attempt) => (
                <Table.Tr key={attempt.delivery_id}>
                  <Table.Td>{new Date(attempt.started_at).toLocaleString()}</Table.Td>
                  <Table.Td>
                    {attempt.success
                      ? t('suppliers.deliveryAttemptSuccess')
                      : `${attempt.error_code ?? 'error'}${attempt.http_status ? ` (${attempt.http_status})` : ''}`}
                  </Table.Td>
                  <Table.Td>{attempt.job_status}</Table.Td>
                  <Table.Td>
                    {attempt.job_status === 'failed_manual' ? (
                      <Button
                        size="xs"
                        variant="light"
                        leftSection={<Play size={12} />}
                        onClick={async () => {
                          try {
                            await replayDelivery.mutateAsync(attempt.delivery_id);
                            notifications.show({
                              title: t('common.saved'),
                              message: t('suppliers.deliveryReplayOk'),
                              color: 'green',
                            });
                          } catch (err: any) {
                            notifications.show({
                              title: t('common.error'),
                              message: err?.message ?? t('suppliers.deliveryReplayError'),
                              color: 'red',
                            });
                          }
                        }}
                        loading={replayDelivery.isPending}
                      >
                        {t('suppliers.deliveryReplay')}
                      </Button>
                    ) : (
                      <Text size="sm" c="dimmed">-</Text>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Paper>
    </Stack>
  );
}

