import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Stack } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@hca/mantine-workbench';
import { SupplierWorkflowPolicyTab } from '../../components/suppliers/SupplierWorkflowPolicyTab';

function normalizeCountry(value: string | null): string {
  const normalized = (value ?? '').trim().toUpperCase();
  if (normalized.length >= 2 && normalized.length <= 3) return normalized;
  return 'DE';
}

export function SupplierWorkflowPoliciesPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();

  const country = useMemo(
    () => normalizeCountry(searchParams.get('country')),
    [searchParams],
  );

  return (
    <Stack gap="lg">
      <PageHeader
        title={t('suppliers.workflowPageTitle')}
        subtitle={t('suppliers.workflowPageSubtitle')}
      />

      <SupplierWorkflowPolicyTab defaultCountry={country} />
    </Stack>
  );
}
