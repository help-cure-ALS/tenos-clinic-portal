import { useEffect, useRef } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Anchor, Box, Stack, Text } from '@mantine/core';

// Wave UI.16 — shared branding for all auth pages
// (login + invite redeem). The hero video lives at
// `web/public/hero.mp4`, the logo at `web/public/hca-logo.svg`.
// Vite serves both under the `base` prefix `/app/`.

const BASE = import.meta.env.BASE_URL ?? '/app/';

// Plain dark background under the hero video — shown while the video
// loads and whenever autoplay is blocked. No poster image (deliberate
// design decision): the panel fades from this color into the video.
export const AUTH_HERO_BG = 'rgb(33 32 33)';

const LOGO_SRC = `${BASE}hca-logo.svg`;

/**
 * Full-bleed background video for the hero panel. Absolutely
 * positioned inside a `position: relative` parent; muted + playsInline
 * so mobile browsers allow autoplay. While the video loads or when
 * autoplay is blocked (e.g. iOS low-power mode), the plain dark
 * AUTH_HERO_BG color shows through — no poster image by design.
 *
 * Mobile autoplay needs two workarounds beyond the attributes:
 *   1. React does not render the `muted` attribute into the DOM on
 *      the initial mount (github.com/facebook/react issue #10389) —
 *      iOS Safari then treats the video as unmuted and blocks
 *      autoplay. We set the property + attribute via effect.
 *   2. If autoplay is still rejected (e.g. low-power mode or data
 *      saver), we retry once on the first touch/click anywhere —
 *      a user gesture lifts the restriction.
 */
export function HeroVideo() {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;

    video.muted = true;
    video.defaultMuted = true;
    video.setAttribute('muted', '');

    const tryPlay = () => {
      video.play().catch(() => {
        // Autoplay blocked — poster stays visible; the gesture
        // listener below gets another chance.
      });
    };
    tryPlay();

    const onFirstGesture = () => {
      if (video.paused) tryPlay();
    };
    window.addEventListener('touchend', onFirstGesture, { once: true, passive: true });
    window.addEventListener('click', onFirstGesture, { once: true });
    return () => {
      window.removeEventListener('touchend', onFirstGesture);
      window.removeEventListener('click', onFirstGesture);
    };
  }, []);

  return (
    <video
      ref={ref}
      autoPlay
      muted
      loop
      playsInline
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        zIndex: 0,
        pointerEvents: 'none',
      }}
    >
      <source src={`${BASE}hero.mp4`} type="video/mp4" />
    </video>
  );
}

/**
 * Content of the hero panel: logo top-left, tagline + footer mark
 * bottom-left, everything as an overlay on the hero background.
 */
export function BrandedHero() {
  const { t } = useTranslation();
  return (
    <Stack
      justify="space-between"
      style={{
        height: '100%',
        padding: '2.5rem',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Background video (image poster as fallback) */}
      <HeroVideo />

      {/* Logo top-left */}
      <Anchor href="/" style={{ display: 'inline-block', position: 'relative', zIndex: 1 }}>
        <img src={LOGO_SRC} alt="help cure ALS" style={{ height: 32 }} />
      </Anchor>

      {/* Tagline + Footer-Mark bottom-left */}
      <Box style={{ maxWidth: 460, position: 'relative', zIndex: 1 }}>
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
