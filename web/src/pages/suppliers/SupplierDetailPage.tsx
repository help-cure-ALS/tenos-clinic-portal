import { useParams } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Stack,
  Text,
  Paper,
  Group,
  Button,
  Loader,
  Center,
  Tabs,
} from '@mantine/core';
import { PageHeader } from '@hca/mantine-workbench';

import { useSupplier } from '../../hooks/useSuppliers';
import { SupplierGeneralTab } from '../../components/suppliers/SupplierGeneralTab';
import { SupplierDeliveryTab } from '../../components/suppliers/SupplierDeliveryTab';
import { SupplierAppLinksTab } from '../../components/suppliers/SupplierAppLinksTab';
import { SupplierDeliveryAttemptsTab } from '../../components/suppliers/SupplierDeliveryAttemptsTab';
import { ArrowLeftRight, Clock4, Info, Link, Settings } from 'lucide-react';

export function SupplierDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { supplierId } = useParams<{ supplierId: string }>();
  const { data: supplier, isLoading } = useSupplier(supplierId!);

  if (isLoading) {
    return <Center h={300}><Loader color="hca-purple" /></Center>;
  }

  if (!supplier) {
    return (
      <Center h={300}>
        <Text c="dimmed">{t('suppliers.notFound')}</Text>
      </Center>
    );
  }

  const country = (supplier.address?.[0]?.country || 'DE').toUpperCase();
  const workflowUrl = `/supplier-workflow-policies?country=${encodeURIComponent(country)}`;

  return (
    <Stack gap="lg">
      <PageHeader
        title={supplier.name ?? ''}
        subtitle={t('suppliers.detailSubtitle')}
      />

      <Tabs defaultValue="general">
        <Tabs.List>
          <Tabs.Tab value="general" leftSection={<Info size={16} />}>
            {t('suppliers.tabGeneral')}
          </Tabs.Tab>
          <Tabs.Tab value="delivery" leftSection={<Settings size={16} />}>
            {t('suppliers.tabDelivery')}
          </Tabs.Tab>
          <Tabs.Tab value="delivery-attempts" leftSection={<Clock4 size={16} />}>
            {t('suppliers.tabDeliveryAttempts')}
          </Tabs.Tab>
          <Tabs.Tab value="app-links" leftSection={<Link size={16} />}>
            {t('suppliers.tabAppLinks')}
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="general" pt="md">
          <SupplierGeneralTab supplier={supplier} />
        </Tabs.Panel>

        <Tabs.Panel value="delivery" pt="md">
          <SupplierDeliveryTab organizationId={supplier.id!} />
        </Tabs.Panel>

        <Tabs.Panel value="delivery-attempts" pt="md">
          <SupplierDeliveryAttemptsTab organizationId={supplier.id!} />
        </Tabs.Panel>

        <Tabs.Panel value="app-links" pt="md">
          <SupplierAppLinksTab organizationId={supplier.id!} />
        </Tabs.Panel>
      </Tabs>

      <Paper withBorder p="md">
        <Group justify="space-between" align="center">
          <div>
            <Text fw={600}>{t('suppliers.workflowGlobalTitle')}</Text>
            <Text size="sm" c="dimmed">{t('suppliers.workflowGlobalHint')}</Text>
          </div>
          <Button
            variant="light"
            color="hca-purple"
            leftSection={<ArrowLeftRight size={16} />}
            onClick={() => navigate(workflowUrl)}
          >
            {t('suppliers.workflowOpen')}
          </Button>
        </Group>
      </Paper>
    </Stack>
  );
}
