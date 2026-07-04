import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Drawer,
  Stack,
  TextInput,
  Button,
  Group,
  Loader,
  Center,
  Badge,
  Divider,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import type { Practitioner } from '@medplum/fhirtypes';
import { medplum } from '../../lib/medplum';
import type { ClinicUser } from '../../lib/api';

interface UserDetailDrawerProps {
  user: ClinicUser | null;
  opened: boolean;
  onClose: () => void;
}

export function UserDetailDrawer({ user, opened, onClose }: UserDetailDrawerProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data: practitioner, isLoading } = useQuery({
    queryKey: ['practitioner', user?.practitionerId],
    queryFn: () => medplum.readResource('Practitioner', user!.practitionerId),
    enabled: opened && !!user?.practitionerId,
  });

  const [prefix, setPrefix] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  // Populate form when practitioner loads
  useEffect(() => {
    if (!practitioner) return;
    const name = practitioner.name?.[0];
    setPrefix(name?.prefix?.join(' ') ?? '');
    setFirstName(name?.given?.join(' ') ?? '');
    setLastName(name?.family ?? '');
    setEmail(practitioner.telecom?.find((t) => t.system === 'email')?.value ?? '');
    setPhone(practitioner.telecom?.find((t) => t.system === 'phone')?.value ?? '');
  }, [practitioner]);

  const saveMutation = useMutation({
    mutationFn: async (p: Practitioner) => {
      const nameText = [prefix, firstName, lastName].filter(Boolean).join(' ');
      const telecom = [
        ...(email ? [{ system: 'email' as const, value: email }] : []),
        ...(phone ? [{ system: 'phone' as const, value: phone }] : []),
      ];

      return medplum.updateResource<Practitioner>({
        ...p,
        name: [
          {
            ...p.name?.[0],
            text: nameText,
            prefix: prefix.trim() ? [prefix.trim()] : undefined,
            given: firstName.trim() ? [firstName.trim()] : undefined,
            family: lastName.trim() || undefined,
          },
        ],
        telecom: telecom.length > 0 ? telecom : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clinic-users'] });
      queryClient.invalidateQueries({ queryKey: ['practitioner', user?.practitionerId] });
      notifications.show({
        title: t('common.saved'),
        message: t('users.detailSaved'),
        color: 'green',
      });
      onClose();
    },
    onError: () => {
      notifications.show({
        title: t('common.error'),
        message: t('users.detailSaveError'),
        color: 'red',
      });
    },
  });

  const handleSave = () => {
    if (!practitioner) return;
    saveMutation.mutate(practitioner);
  };

  const hasChanges = (() => {
    if (!practitioner) return false;
    const name = practitioner.name?.[0];
    const origPrefix = name?.prefix?.join(' ') ?? '';
    const origFirst = name?.given?.join(' ') ?? '';
    const origLast = name?.family ?? '';
    const origEmail = practitioner.telecom?.find((t) => t.system === 'email')?.value ?? '';
    const origPhone = practitioner.telecom?.find((t) => t.system === 'phone')?.value ?? '';
    return (
      prefix !== origPrefix ||
      firstName !== origFirst ||
      lastName !== origLast ||
      email !== origEmail ||
      phone !== origPhone
    );
  })();

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      title={t('users.detailTitle')}
      position="right"
      size="md"
    >
      {isLoading || !practitioner ? (
        <Center h={200}><Loader color="hca-purple" /></Center>
      ) : (
        <Stack gap="md">
          <Group gap="xs">
            <Badge variant="light" color={user?.clinicRole === 'admin' ? 'hca-purple' : 'gray'}>
              {user?.clinicRole || t('users.member')}
            </Badge>
            {user?.canVerify && (
              <Badge variant="light" color="green">{t('users.canVerify')}</Badge>
            )}
          </Group>

          <Divider />

          <TextInput
            label={t('users.prefix')}
            placeholder="Prof. Dr."
            value={prefix}
            onChange={(e) => setPrefix(e.currentTarget.value)}
          />

          <Group grow>
            <TextInput
              label={t('users.firstName')}
              value={firstName}
              onChange={(e) => setFirstName(e.currentTarget.value)}
              required
            />
            <TextInput
              label={t('users.lastName')}
              value={lastName}
              onChange={(e) => setLastName(e.currentTarget.value)}
              required
            />
          </Group>

          <Divider label={t('users.contactInfo')} labelPosition="left" />

          <TextInput
            label={t('auth.email')}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
          />

          <TextInput
            label={t('users.phone')}
            type="tel"
            placeholder="+49 ..."
            value={phone}
            onChange={(e) => setPhone(e.currentTarget.value)}
          />

          <Divider />

          <Group justify="flex-end">
            <Button variant="subtle" onClick={onClose}>{t('common.cancel')}</Button>
            <Button
              color="hca-purple"
              onClick={handleSave}
              loading={saveMutation.isPending}
              disabled={!firstName.trim() || !lastName.trim() || !hasChanges}
            >
              {t('common.save')}
            </Button>
          </Group>
        </Stack>
      )}
    </Drawer>
  );
}
