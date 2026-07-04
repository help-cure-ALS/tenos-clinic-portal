import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Stack,
  Paper,
  Text,
  TextInput,
  SimpleGrid,
  Switch,
  Group,
  Button,
  Alert,
  Select,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';

import type { Organization } from '@medplum/fhirtypes';
import { useQueryClient } from '@tanstack/react-query';
import { useToggleVerification } from '../../hooks/useClinics';
import { medplum } from '../../lib/medplum';
import { getFacilityTypes } from '../../lib/facilityTypes';
import { AlertTriangle, Pencil, Trash2 } from 'lucide-react';

interface Props {
  clinic: Organization;
}

export function ClinicGeneralTab({ clinic }: Props) {
  const { t } = useTranslation();
  const FACILITY_TYPES = getFacilityTypes(t);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toggleVerification = useToggleVerification();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const addr = clinic.address?.[0];
  const phone = clinic.telecom?.find(t => t.system === 'phone')?.value;
  const email = clinic.telecom?.find(t => t.system === 'email')?.value;
  const website = clinic.telecom?.find(t => t.system === 'url')?.value;
  const facilityType = clinic.type?.[0]?.coding?.[0]?.code || '';
  const verificationEnabled = clinic.meta?.tag?.some(
    tag => tag.system === 'urn:hca:verification' && tag.code === 'enabled'
  );

  const form = useForm({
    initialValues: {
      name: clinic.name || '',
      facilityType,
      line: addr?.line?.join(', ') || '',
      postalCode: addr?.postalCode || '',
      city: addr?.city || '',
      country: addr?.country || '',
      phone: phone || '',
      email: email || '',
      website: website || '',
    },
    validate: {
      name: (v) => v.trim() ? null : t('common.error'),
    },
  });

  const handleToggle = async (enabled: boolean) => {
    try {
      await toggleVerification.mutateAsync({ clinicId: clinic.id!, enabled });
      notifications.show({
        message: t(enabled ? 'clinics.verificationActivated' : 'clinics.verificationDeactivated'),
        color: 'green',
      });
    } catch {
      notifications.show({ message: t('common.error'), color: 'red' });
    }
  };

  const handleSave = async (values: typeof form.values) => {
    setSaving(true);
    try {
      const telecom: { system: 'phone' | 'email' | 'url'; value: string }[] = [];
      if (values.phone) telecom.push({ system: 'phone', value: values.phone });
      if (values.email) telecom.push({ system: 'email', value: values.email });
      if (values.website) telecom.push({ system: 'url', value: values.website });

      const type = values.facilityType ? [{
        coding: [{
          system: 'http://help-cure-als.org/facility-type',
          code: values.facilityType,
          display: FACILITY_TYPES.find(f => f.value === values.facilityType)?.label || values.facilityType,
        }],
      }] : clinic.type;

      await medplum.updateResource({
        ...clinic,
        name: values.name,
        type,
        address: [{
          line: values.line ? [values.line] : undefined,
          postalCode: values.postalCode || undefined,
          city: values.city || undefined,
          country: values.country || undefined,
        }],
        telecom: telecom.length > 0 ? telecom : undefined,
      });

      notifications.show({ title: t('common.saved'), message: t('clinics.editSaved'), color: 'green' });
      queryClient.invalidateQueries({ queryKey: ['clinics'] });
      setEditing(false);
    } catch {
      notifications.show({ title: t('common.error'), message: t('clinics.editError'), color: 'red' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    const isActive = verificationEnabled;

    modals.openConfirmModal({
      title: t('clinics.deleteTitle'),
      children: (
        <Stack gap="sm">
          <Text size="sm">{t('clinics.deleteConfirm', { name: clinic.name })}</Text>
          {isActive && (
            <Alert color="red" icon={<AlertTriangle size={16} />}>
              <Text size="sm" fw={600}>{t('clinics.deleteActiveWarning')}</Text>
            </Alert>
          )}
        </Stack>
      ),
      labels: {
        confirm: t('common.delete'),
        cancel: t('common.cancel'),
      },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        setDeleting(true);
        try {
          await medplum.deleteResource('Organization', clinic.id!);
          notifications.show({ message: t('clinics.deleted'), color: 'green' });
          queryClient.invalidateQueries({ queryKey: ['clinics'] });
          navigate('/clinics');
        } catch {
          notifications.show({ title: t('common.error'), message: t('clinics.deleteError'), color: 'red' });
        } finally {
          setDeleting(false);
        }
      },
    });
  };

  if (editing) {
    return (
      <Paper withBorder p="md">
        <form onSubmit={form.onSubmit(handleSave)}>
          <Stack gap="md">
            <Group grow>
              <TextInput label={t('clinics.name')} required {...form.getInputProps('name')} />
              <Select
                label={t('clinics.facilityType')}
                placeholder={t('clinics.selectFacilityType')}
                data={FACILITY_TYPES}
                clearable
                {...form.getInputProps('facilityType')}
              />
            </Group>
            <TextInput label={t('clinicProfile.street')} {...form.getInputProps('line')} />
            <SimpleGrid cols={3}>
              <TextInput label={t('clinicProfile.postalCode')} {...form.getInputProps('postalCode')} />
              <TextInput label={t('clinicProfile.city')} {...form.getInputProps('city')} />
              <TextInput label={t('clinicProfile.country')} {...form.getInputProps('country')} />
            </SimpleGrid>
            <SimpleGrid cols={3}>
              <TextInput label={t('clinicProfile.phone')} {...form.getInputProps('phone')} />
              <TextInput label={t('auth.email')} {...form.getInputProps('email')} />
              <TextInput label={t('clinicProfile.website')} {...form.getInputProps('website')} />
            </SimpleGrid>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setEditing(false)}>{t('common.cancel')}</Button>
              <Button type="submit" color="teal" loading={saving}>
                {t('common.save')}
              </Button>
            </Group>
          </Stack>
        </form>
      </Paper>
    );
  }

  return (
    <Stack gap="md">
      <Paper withBorder p="md">
        <SimpleGrid cols={2}>
          <div>
            <Text size="xs" c="dimmed" fw={500}>{t('clinicProfile.name')}</Text>
            <Text size="sm">{clinic.name || '—'}</Text>
          </div>
          <div>
            <Text size="xs" c="dimmed" fw={500}>{t('clinics.facilityType')}</Text>
            <Text size="sm">{FACILITY_TYPES.find(f => f.value === facilityType)?.label || facilityType || '—'}</Text>
          </div>
          <div>
            <Text size="xs" c="dimmed" fw={500}>{t('clinicProfile.street')}</Text>
            <Text size="sm">{addr?.line?.join(', ') || '—'}</Text>
          </div>
          <div>
            <Text size="xs" c="dimmed" fw={500}>{t('clinicProfile.city')}</Text>
            <Text size="sm">{[addr?.postalCode, addr?.city].filter(Boolean).join(' ') || '—'}</Text>
          </div>
          <div>
            <Text size="xs" c="dimmed" fw={500}>{t('clinicProfile.country')}</Text>
            <Text size="sm">{addr?.country || '—'}</Text>
          </div>
          <div>
            <Text size="xs" c="dimmed" fw={500}>{t('clinicProfile.phone')}</Text>
            <Text size="sm">{phone || '—'}</Text>
          </div>
          <div>
            <Text size="xs" c="dimmed" fw={500}>{t('auth.email')}</Text>
            <Text size="sm">{email || '—'}</Text>
          </div>
          <div>
            <Text size="xs" c="dimmed" fw={500}>{t('clinicProfile.website')}</Text>
            <Text size="sm">{website || '—'}</Text>
          </div>
        </SimpleGrid>
      </Paper>

      <Paper withBorder p="md">
        <Group justify="space-between">
          <div>
            <Text fw={500}>{t('clinics.verification')}</Text>
            <Text size="xs" c="dimmed">{t('clinics.verificationDescription')}</Text>
          </div>
          <Switch
            checked={verificationEnabled}
            onChange={(e) => handleToggle(e.currentTarget.checked)}
            disabled={toggleVerification.isPending}
          />
        </Group>
      </Paper>

      <Group>
        <Button
          variant="default"
          leftSection={<Pencil size={16} />}
          onClick={() => setEditing(true)}
        >
          {t('common.edit')}
        </Button>
        <Button
          variant="light"
          color="red"
          leftSection={<Trash2 size={16} />}
          onClick={handleDelete}
          loading={deleting}
        >
          {t('common.delete')}
        </Button>
      </Group>
    </Stack>
  );
}
