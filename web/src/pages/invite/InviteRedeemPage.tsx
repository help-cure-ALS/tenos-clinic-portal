import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Stack,
  TextInput,
  PasswordInput,
  Button,
  Title,
  Text,
  Alert,
  Loader,
  Center,
} from '@mantine/core';
import { AlertCircle, Check } from 'lucide-react';
import { AuthSplitLayout } from '@hca/mantine-workbench';

import { getInvitationByToken, redeemInvitation } from '../../lib/api';
import {
  AUTH_HERO_BG,
  BrandedHero,
  MobileBrand,
} from '../../components/layout/BrandedAuthHero';
import { LanguagePill } from '../../components/common/LanguagePill';

// Wave UI.16 — small layout component so the three render paths
// (loading / success / form) share the same AuthSplitLayout wrapper
// without code duplication.
function InviteAuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthSplitLayout
      heroBackground={AUTH_HERO_BG}
      heroContent={<BrandedHero />}
      mobileBrand={<MobileBrand />}
      panelTopRight={<LanguagePill />}
      panelMinWidth={460}
      panelMaxWidth={620}
      hideHeroBelow={859}
    >
      {children}
    </AuthSplitLayout>
  );
}

export function InviteRedeemPage() {
  const { t } = useTranslation();
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [clinicName, setClinicName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (!token) return;
    getInvitationByToken(token)
      .then((inv) => {
        setClinicName(inv.clinic_name);
        if (inv.email) setEmail(inv.email);
        setLoading(false);
      })
      .catch(() => {
        setError(t('invitations.invalidOrExpired'));
        setLoading(false);
      });
  }, [token, t]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setSubmitting(true);
    setError(null);
    try {
      await redeemInvitation(token, { firstName, lastName, email, password });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <InviteAuthLayout>
        <Center h={300}><Loader color="hca-purple" /></Center>
      </InviteAuthLayout>
    );
  }

  if (success) {
    return (
      <InviteAuthLayout>
        <Stack align="center" gap="lg">
          <Check size={56} color="var(--mantine-color-green-6)" />
          <div style={{ textAlign: 'center' }}>
            <Title order={3}>{t('invitations.registrationSuccess')}</Title>
            <Text size="sm" c="dimmed" mt={4}>
              {t('invitations.registrationSuccessDesc')}
            </Text>
          </div>
          <Button
            fullWidth
            color="hca-purple"
            size="md"
            onClick={() => navigate('/login')}
          >
            {t('auth.signIn')}
          </Button>
        </Stack>
      </InviteAuthLayout>
    );
  }

  return (
    <InviteAuthLayout>
      <form onSubmit={handleSubmit}>
        <Stack gap="lg">
          <div>
            <Title order={2} fw={700}>{t('invitations.registerTitle')}</Title>
            <Text size="sm" c="dimmed" mt={4}>
              {t('invitations.registerSubtitle', { clinic: clinicName })}
            </Text>
          </div>

          {error && (
            <Alert icon={<AlertCircle size={16} />} color="red" variant="light">
              {error}
            </Alert>
          )}

          <TextInput
            label={t('invitations.firstName')}
            value={firstName}
            onChange={(e) => setFirstName(e.currentTarget.value)}
            required
            autoFocus
            size="md"
          />
          <TextInput
            label={t('invitations.lastName')}
            value={lastName}
            onChange={(e) => setLastName(e.currentTarget.value)}
            required
            size="md"
          />
          <TextInput
            label={t('auth.email')}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
            required
            size="md"
          />
          <PasswordInput
            label={t('auth.password')}
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            required
            minLength={8}
            size="md"
          />

          <Button type="submit" fullWidth loading={submitting} color="hca-purple" size="md">
            {t('invitations.register')}
          </Button>
        </Stack>
      </form>
    </InviteAuthLayout>
  );
}
