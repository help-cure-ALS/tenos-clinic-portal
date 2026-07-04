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
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';

import type { Organization } from '@medplum/fhirtypes';
import { useQueryClient } from '@tanstack/react-query';
import { medplum, SUPPLIER_SPECIALTY_SYSTEM, SUPPLIER_TAG } from '../../lib/medplum';
import { AlertTriangle, Pencil, Trash2 } from 'lucide-react';

interface Props {
  supplier: Organization;
}

function toSpecialtyCode(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'general';
}

function hasSupplierTag(org: Organization): boolean {
  return (org.meta?.tag ?? []).some(
    (tag) => tag.system === 'urn:hca:supplier' && tag.code === 'enabled',
  );
}

function withSupplierTag(org: Organization, enabled: boolean): Organization {
  const [system, code] = SUPPLIER_TAG.split('|');
  const tags = [...(org.meta?.tag ?? [])];
  const idx = tags.findIndex((tag) => tag.system === system && tag.code === code);

  if (enabled && idx < 0) {
    tags.push({ system, code });
  }

  if (!enabled && idx >= 0) {
    tags.splice(idx, 1);
  }

  return {
    ...org,
    meta: {
      ...(org.meta ?? {}),
      tag: tags,
    },
  };
}

export function SupplierGeneralTab({ supplier }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const addr = supplier.address?.[0];
  const phone = supplier.telecom?.find((tel) => tel.system === 'phone')?.value;
  const email = supplier.telecom?.find((tel) => tel.system === 'email')?.value;
  const website = supplier.telecom?.find((tel) => tel.system === 'url')?.value;
  const specialty = supplier.type?.[0]?.coding?.[0]?.display || supplier.type?.[0]?.coding?.[0]?.code || '';
  const enabled = hasSupplierTag(supplier);

  const form = useForm({
    initialValues: {
      name: supplier.name || '',
      specialty,
      line: addr?.line?.join(', ') || '',
      postalCode: addr?.postalCode || '',
      city: addr?.city || '',
      country: addr?.country || '',
      phone: phone || '',
      email: email || '',
      website: website || '',
    },
    validate: {
      name: (v) => (v.trim() ? null : t('common.error')),
      specialty: (v) => (v.trim() ? null : t('common.error')),
    },
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    await queryClient.invalidateQueries({ queryKey: ['suppliers', supplier.id] });
  };

  const handleToggleEnabled = async (nextEnabled: boolean) => {
    try {
      await medplum.updateResource(withSupplierTag(supplier, nextEnabled));
      await invalidate();
      notifications.show({
        message: t(nextEnabled ? 'suppliers.enabledActivated' : 'suppliers.enabledDeactivated'),
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

      await medplum.updateResource({
        ...supplier,
        name: values.name,
        type: [{
          coding: [{
            system: SUPPLIER_SPECIALTY_SYSTEM,
            code: toSpecialtyCode(values.specialty),
            display: values.specialty,
          }],
        }],
        address: [{
          line: values.line ? [values.line] : undefined,
          postalCode: values.postalCode || undefined,
          city: values.city || undefined,
          country: values.country || undefined,
        }],
        telecom: telecom.length > 0 ? telecom : undefined,
      });

      await invalidate();
      notifications.show({ title: t('common.saved'), message: t('suppliers.editSaved'), color: 'green' });
      setEditing(false);
    } catch {
      notifications.show({ title: t('common.error'), message: t('suppliers.editError'), color: 'red' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    modals.openConfirmModal({
      title: t('suppliers.deleteTitle'),
      children: (
        <Stack gap="sm">
          <Text size="sm">{t('suppliers.deleteConfirm', { name: supplier.name })}</Text>
          <Alert color="red" icon={<AlertTriangle size={16} />}>
            <Text size="sm" fw={600}>{t('suppliers.deleteWarning')}</Text>
          </Alert>
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
          await medplum.deleteResource('Organization', supplier.id!);
          notifications.show({ message: t('suppliers.deleted'), color: 'green' });
          await queryClient.invalidateQueries({ queryKey: ['suppliers'] });
          navigate('/suppliers');
        } catch {
          notifications.show({ title: t('common.error'), message: t('suppliers.deleteError'), color: 'red' });
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
              <TextInput label={t('suppliers.name')} required {...form.getInputProps('name')} />
              <TextInput label={t('suppliers.specialty')} required {...form.getInputProps('specialty')} />
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
            <Text size="xs" c="dimmed" fw={500}>{t('suppliers.name')}</Text>
            <Text size="sm">{supplier.name || '—'}</Text>
          </div>
          <div>
            <Text size="xs" c="dimmed" fw={500}>{t('suppliers.specialty')}</Text>
            <Text size="sm">{specialty || '—'}</Text>
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
            <Text fw={500}>{t('suppliers.enabled')}</Text>
            <Text size="xs" c="dimmed">{t('suppliers.enabledDescription')}</Text>
          </div>
          <Switch checked={enabled} onChange={(e) => handleToggleEnabled(e.currentTarget.checked)} />
        </Group>
      </Paper>

      <Group>
        <Button variant="default" leftSection={<Pencil size={16} />} onClick={() => setEditing(true)}>
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
