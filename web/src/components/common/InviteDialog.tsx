import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Modal,
  Stack,
  TextInput,
  Select,
  Button,
  Alert,
  CopyButton,
  ActionIcon,
  Group,
  Text,
  Code,
} from '@mantine/core';

import { useCreateInvitation } from '../../hooks/useInvitations';
import { useClinics } from '../../hooks/useClinics';
import { useAuthStore } from '../../stores/auth';
import { AlertCircle, Check, Copy } from 'lucide-react';

interface InviteDialogProps {
  opened: boolean;
  onClose: () => void;
  /** Fixed clinic ID (for Clinic-Admin). If omitted, shows clinic selector (for HCA-Admin). */
  clinicId?: string;
}

export function InviteDialog({ opened, onClose, clinicId }: InviteDialogProps) {
  const { t } = useTranslation();
  const { userRole } = useAuthStore();
  const createInvitation = useCreateInvitation();
  const { data: clinics = [] } = useClinics();

  const [selectedClinicId, setSelectedClinicId] = useState(clinicId || '');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<string>('admin');
  const [error, setError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const isHcaAdmin = userRole === 'hca-admin';
  const effectiveClinicId = clinicId || selectedClinicId;

  const clinicOptions = clinics.map((c) => ({
    value: c.id!,
    label: c.name || c.id!,
  }));

  const roleOptions = isHcaAdmin
    ? [
        { value: 'admin', label: t('invitations.roleAdmin') },
        { value: 'verifier', label: t('invitations.roleVerifier') },
        { value: 'member', label: t('invitations.roleMember') },
      ]
    : [
        { value: 'verifier', label: t('invitations.roleVerifier') },
        { value: 'member', label: t('invitations.roleMember') },
      ];

  // Maps known backend error codes (HTTP 401/403) to readable
  // i18n messages. Unknown codes fall back to a generic
  // error message.
  const mapInviteError = (raw: string): string => {
    switch (raw) {
      case 'admin_only':
        return t('invitations.errorAdminOnly');
      case 'missing_token':
      case 'invalid_token':
        return t('invitations.errorMissingToken');
      case 'invalid_request':
        return t('invitations.errorInvalidRequest');
      default:
        return t('invitations.errorGeneric');
    }
  };

  const handleSubmit = async () => {
    if (!effectiveClinicId) return;
    setError(null);
    try {
      const invitation = await createInvitation.mutateAsync({
        clinic_id: effectiveClinicId,
        email: email || undefined,
        role,
      });
      const link = `${window.location.origin}/app/register/${invitation.token}`;
      setInviteLink(link);
    } catch (err) {
      const raw = err instanceof Error ? err.message : '';
      setError(mapInviteError(raw));
    }
  };

  const handleClose = () => {
    setEmail('');
    setRole('admin');
    setSelectedClinicId(clinicId || '');
    setError(null);
    setInviteLink(null);
    onClose();
  };

  return (
    <Modal opened={opened} onClose={handleClose} title={t('invitations.createTitle')} size="md">
      {inviteLink ? (
        <Stack gap="md">
          <Alert color="green" icon={<Check size={16} />}>
            {t('invitations.created')}
          </Alert>
          <Text size="sm" fw={500}>{t('invitations.linkLabel')}</Text>
          <Group gap="xs">
            <Code block style={{ flex: 1, wordBreak: 'break-all' }}>{inviteLink}</Code>
            <CopyButton value={inviteLink}>
              {({ copied, copy }) => (
                <ActionIcon color={copied ? 'green' : 'gray'} variant="subtle" onClick={copy}>
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                </ActionIcon>
              )}
            </CopyButton>
          </Group>
          <Button onClick={handleClose} variant="light">
            {t('common.close')}
          </Button>
        </Stack>
      ) : (
        <Stack gap="md">
          {error && (
            <Alert color="red" icon={<AlertCircle size={16} />}>
              {error}
            </Alert>
          )}

          {isHcaAdmin && !clinicId && (
            <Select
              label={t('invitations.selectClinic')}
              placeholder={t('invitations.selectClinicPlaceholder')}
              data={clinicOptions}
              value={selectedClinicId}
              onChange={(v) => v && setSelectedClinicId(v)}
              searchable
              required
            />
          )}

          <TextInput
            label={t('auth.email')}
            placeholder={t('invitations.emailPlaceholder')}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
          />

          <Select
            label={t('invitations.roleLabel')}
            data={roleOptions}
            value={role}
            onChange={(v) => v && setRole(v)}
          />

          <Button
            onClick={handleSubmit}
            loading={createInvitation.isPending}
            disabled={!effectiveClinicId}
            color="teal"
          >
            {t('invitations.send')}
          </Button>
        </Stack>
      )}
    </Modal>
  );
}
