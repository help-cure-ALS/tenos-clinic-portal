import { useTranslation } from 'react-i18next';
import type { ResearchStudy, Extension } from '@medplum/fhirtypes';

const EXT_BASE = 'http://help-cure-als.org/ext';

/**
 * Field names that the studies-sync service stores per language
 * as extensions.
 */
export type LocalizableStudyField =
  | 'short-title'
  | 'summary'
  | 'description'
  | 'why-stopped'
  | 'eligibility';

/**
 * All base fields that can have a translation. Used by
 * `getAvailableLocales` to detect for which languages at least
 * one translated field is present.
 */
const LOCALIZABLE_FIELDS: LocalizableStudyField[] = [
  'short-title',
  'summary',
  'description',
  'why-stopped',
  'eligibility',
];

function findExtString(extensions: Extension[] | undefined, url: string): string | undefined {
  return extensions?.find((e) => e.url === url)?.valueString;
}

function normalizeLang(raw: string | undefined): string {
  return (raw ?? 'en').split('-')[0].toLowerCase();
}

/**
 * Reads the localized text for a study field.
 *
 * Order:
 *   1. `ext/{field}-{overrideLocale ?? i18n.language}` — language-specific translation
 *   2. `ext/{field}` — English base text
 *
 * `overrideLocale` allows overriding the global app state —
 * handy for a language switcher in the detail drawer, without the
 * whole app having to switch languages.
 */
export function useStudyText(
  study: ResearchStudy | null | undefined,
  field: LocalizableStudyField,
  overrideLocale?: string,
): string | undefined {
  const { i18n } = useTranslation();
  if (!study) return undefined;

  const lang = normalizeLang(overrideLocale ?? i18n.language);
  const extensions = study.extension;

  if (lang && lang !== 'en') {
    const translated = findExtString(extensions, `${EXT_BASE}/${field}-${lang}`);
    if (translated) return translated;
  }
  return findExtString(extensions, `${EXT_BASE}/${field}`);
}

/**
 * Scans a study's extensions and returns the languages for which
 * AT LEAST ONE translated text exists. `en` is always included as
 * the first entry (that is the original text).
 *
 * Order: `en` first, then the others alphabetically.
 */
export function getAvailableLocales(study: ResearchStudy | null | undefined): string[] {
  if (!study?.extension) return ['en'];
  const found = new Set<string>();
  const pattern = new RegExp(`^${EXT_BASE.replace(/[.]/g, '\\.')}/(?:${LOCALIZABLE_FIELDS.join('|')})-([a-z]{2})$`);
  for (const ext of study.extension) {
    if (!ext.url) continue;
    const m = ext.url.match(pattern);
    if (m) found.add(m[1]);
  }
  const others = Array.from(found).sort();
  return ['en', ...others.filter((l) => l !== 'en')];
}
