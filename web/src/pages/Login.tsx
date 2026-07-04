import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Stack,
  TextInput,
  PasswordInput,
  Button,
  Text,
  Alert,
  Anchor,
  Group,
} from '@mantine/core';
import { AlertCircle } from 'lucide-react';
import { AuthSplitLayout } from '@hca/mantine-workbench';

import { useAuthStore } from '../stores/auth';
import {
  AUTH_HERO_BG,
  BrandedHero,
  MobileBrand,
} from '../components/layout/BrandedAuthHero';
import { LanguagePill } from '../components/common/LanguagePill';

export function Login() {
  const { t, i18n } = useTranslation();

  // Legal page URLs are language-dependent: tenos.app has
  // different slugs per language.
  const isEn = i18n.language.split('-')[0] === 'en';
  const termsUrl = isEn
    ? 'https://tenos.app/en/care-portal-terms/'
    : 'https://tenos.app/de/care-portal-nutzungsbedingungen/';
  const privacyUrl = isEn
    ? 'https://tenos.app/en/care-portal-privacy/'
    : 'https://tenos.app/de/care-portal-datenschutz/';
  const navigate = useNavigate();
  const { login, isLoading, error, clearError } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    try {
      await login(email, password);
      navigate('/dashboard', { replace: true });
    } catch {
      // Error sits in the auth store.
    }
  };

  return (
    <AuthSplitLayout
      heroBackground={AUTH_HERO_BG}
      heroContent={<BrandedHero />}
      mobileBrand={<MobileBrand />}
      panelTopRight={<LanguagePill />}
      // Form panel with fixed constraints: between 460 and 620 px wide.
      // The hero fills the rest elastically. heroWidth is thus obsolete.
      panelMinWidth={460}
      panelMaxWidth={620}
      // Collapse the hero below 859 px — sits between Mantine's sm
      // (768) and md (992); the library injects its own media
      // query for this.
      hideHeroBelow={859}
    >
      <form onSubmit={handleSubmit}>
        <Stack gap="lg">
          <Text
            size="sm"
            c="dimmed"
            tt="uppercase"
            style={{ letterSpacing: '0.04em' }}
          >
            {t('auth.portalTitle')}
          </Text>

          {error && (
            <Alert icon={<AlertCircle size={16} />} color="red" variant="light">
              {error}
            </Alert>
          )}

          <TextInput
            label={t('auth.email')}
            placeholder={t('auth.emailPlaceholder')}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
            required
            autoFocus
            size="md"
          />

          <PasswordInput
            label={t('auth.password')}
            placeholder={t('auth.passwordPlaceholder')}
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            required
            size="md"
          />

          <Button
            type="submit"
            fullWidth
            loading={isLoading}
            color="hca-purple"
            size="md"
          >
            {t('auth.signIn')}
          </Button>

          {/* Min-height reserves space for the longest locale text
              (DE wraps to 2 lines, EN to 1) — otherwise the page
              jumps by one line height on language switch. */}
          <Group justify="center" gap={4} mih={48} align="flex-start">
            <Text size="xs" c="dimmed" ta="center">
              {t('auth.termsText')}{' '}
              <Anchor
                size="xs"
                href={termsUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('auth.termsOfService')}
              </Anchor>{' '}
              {t('auth.and')}{' '}
              <Anchor
                size="xs"
                href={privacyUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('auth.privacyPolicy')}
              </Anchor>
            </Text>
          </Group>
        </Stack>
      </form>
    </AuthSplitLayout>
  );
}
