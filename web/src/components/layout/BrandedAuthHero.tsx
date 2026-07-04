import { Trans, useTranslation } from 'react-i18next';
import { Anchor, Box, Stack, Text } from '@mantine/core';

// Wave UI.16 — shared branding for all auth pages
// (login + invite redeem). The background image lives at
// `web/public/auth-hero.jpg`, the logo at
// `web/public/hca-logo.svg`. Vite serves both under the
// `base` prefix `/app/`.

const BASE = import.meta.env.BASE_URL ?? '/app/';

// Image center/cover as the top layer, dark brand tint as fallback
// color underneath — prevents the white flash on first image load
// and fills any edges (very wide viewports, AR mismatch).
export const AUTH_HERO_BG = `url(${BASE}auth-hero.jpg) center / cover no-repeat, #1a1021`;

const LOGO_SRC = `${BASE}hca-logo.svg`;

/**
 * Content of the hero panel: logo top-left, tagline + footer mark
 * bottom-left, everything as an overlay on the hero background.
 */
export function BrandedHero() {
  const { t } = useTranslation();
  return (
    <Stack
      justify="space-between"
      style={{ height: '100%', padding: '2.5rem', position: 'relative' }}
    >
      {/* Logo top-left */}
      <Anchor href="/" style={{ display: 'inline-block' }}>
        <img src={LOGO_SRC} alt="help cure ALS" style={{ height: 32 }} />
      </Anchor>

      {/* Tagline + Footer-Mark bottom-left */}
      <Box style={{ maxWidth: 460 }}>
        <Text
          fw={700}
          c="white"
          style={{
            fontSize: '2.5rem',
            lineHeight: 1.1,
            letterSpacing: '-0.02em',
          }}
        >
          {t('auth.taglineLine1')}
        </Text>
        <Text
          fw={700}
          c="white"
          style={{
            fontSize: '2.5rem',
            lineHeight: 1.1,
            letterSpacing: '-0.02em',
            opacity: 0.7,
          }}
        >
          {t('auth.taglineLine2')}
        </Text>
        <Text
          c="white"
          mt="lg"
          size="sm"
          style={{ opacity: 0.85, lineHeight: 1.5, maxWidth: 380 }}
        >
          {/* `<Trans>` replaces the `<0>...</0>` marker from the
              i18n strings with the passed-in component — here an
              external anchor to help-cure-als.org. Cleaner than
              splitting the text into three pieces, and the org name
              sits in its natural place in the translation file. */}
          <Trans
            i18nKey="auth.footerMark"
            t={t}
            components={[
              <Anchor
                key="hca-link"
                href="https://help-cure-als.org/"
                target="_blank"
                rel="noopener noreferrer"
                c="white"
                td="underline"
                style={{ opacity: 1 }}
              />,
            ]}
          />
        </Text>
      </Box>
    </Stack>
  );
}

/**
 * Small logo for mobile mode (hero hidden, form fills). Passed
 * to `<AuthSplitLayout mobileBrand={<MobileBrand />}>`.
 */
export function MobileBrand() {
  return (
    <Anchor href="/">
      <img src={LOGO_SRC} alt="help cure ALS" style={{ height: 26 }} />
    </Anchor>
  );
}
