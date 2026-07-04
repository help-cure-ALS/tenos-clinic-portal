import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Stack,
  Text,
  Tabs,
  Loader,
  Center,
} from '@mantine/core';
import { PageHeader } from '@hca/mantine-workbench';

import { useClinic } from '../../hooks/useClinics';
import { ClinicGeneralTab } from '../../components/clinics/ClinicGeneralTab';
import { ClinicUsersTab } from '../../components/clinics/ClinicUsersTab';
import { ClinicDevicesTab } from '../../components/clinics/ClinicDevicesTab';
import { Award, Info, Users } from 'lucide-react';

export function ClinicDetailPage() {
  const { t } = useTranslation();
  const { clinicId } = useParams<{ clinicId: string }>();
  const { data: clinic, isLoading } = useClinic(clinicId!);

  if (isLoading) {
    return <Center h={300}><Loader color="hca-purple" /></Center>;
  }

  if (!clinic) {
    return (
      <Center h={300}>
        <Text c="dimmed">{t('clinics.notFound')}</Text>
      </Center>
    );
  }

  return (
    <Stack gap="lg">
      <PageHeader
        title={clinic.name ?? ''}
        subtitle={t('clinics.detailSubtitle')}
      />

      <Tabs defaultValue="general">
        <Tabs.List>
          <Tabs.Tab value="general" leftSection={<Info size={16} />}>
            {t('clinics.tabGeneral')}
          </Tabs.Tab>
          <Tabs.Tab value="users" leftSection={<Users size={16} />}>
            {t('clinics.tabUsers')}
          </Tabs.Tab>
          <Tabs.Tab value="devices" leftSection={<Award size={16} />}>
            {t('clinics.tabDevices')}
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="general" pt="md">
          <ClinicGeneralTab clinic={clinic} />
        </Tabs.Panel>

        <Tabs.Panel value="users" pt="md">
          <ClinicUsersTab clinicId={clinic.id!} />
        </Tabs.Panel>

        <Tabs.Panel value="devices" pt="md">
          <ClinicDevicesTab clinicId={clinic.id!} />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
