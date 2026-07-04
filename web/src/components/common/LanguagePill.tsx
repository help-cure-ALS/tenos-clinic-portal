import { Group, Text, UnstyledButton } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../stores/auth';

// Wave UI.18 — DE | EN switcher for auth pages. Deliberately minimal:
// two text-only buttons with a separator, active language in bold.
// No border, no background, no pill — matching the otherwise
// lean design of the app.

const LANGS = ['de', 'en'] as const;
type Lang = (typeof LANGS)[number];

export function LanguagePill() {
  const { i18n } = useTranslation();
  const setLanguage = useAuthStore((s) => s.setLanguage);
  const current: Lang =
    i18n.language.split('-')[0] === 'en' ? 'en' : 'de';

  return (
    <Group gap={6} align="center" wrap="nowrap">
      {LANGS.map((lang, idx) => (
        <Group key={lang} gap={6} align="center" wrap="nowrap">
          {idx > 0 ? (
            <Text component="span" size="sm" c="dimmed" aria-hidden="true">
              |
            </Text>
          ) : null}
          <UnstyledButton
            onClick={() => setLanguage(lang)}
            aria-label={lang.toUpperCase()}
            aria-pressed={current === lang}
          >
            <Text
              component="span"
              size="sm"
              fw={current === lang ? 700 : 400}
              c={current === lang ? undefined : 'dimmed'}
            >
              {lang.toUpperCase()}
            </Text>
          </UnstyledButton>
        </Group>
      ))}
    </Group>
  );
}
