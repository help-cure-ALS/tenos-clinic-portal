import { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Drawer,
  Stack,
  Title,
  Text,
  Badge,
  Group,
  Divider,
  Anchor,
  List,
  SegmentedControl,
} from '@mantine/core';
import type { ResearchStudy } from '@medplum/fhirtypes';
import { useStudyText, getAvailableLocales } from '../../hooks/useStudyText';

const STATUS_COLOR: Record<string, string> = {
  active: 'green',
  completed: 'blue',
  draft: 'gray',
  'in-review': 'orange',
  approved: 'cyan',
  'temporarily-closed-to-accrual': 'yellow',
  withdrawn: 'red',
};

// Native language labels analogous to the studies-sync settings page.
// Falls back to the ISO code if we see an unknown locale (should not
// happen, we only translate into the 11 mobile app languages).
const LANGUAGE_LABELS: Record<string, string> = {
  en: 'EN',
  de: 'DE',
  es: 'ES',
  fr: 'FR',
  it: 'IT',
  ja: 'JA',
  nl: 'NL',
  pl: 'PL',
  pt: 'PT',
  ro: 'RO',
  tr: 'TR',
  zh: 'ZH',
};

function LabelValue({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Text size="xs" c="dimmed" fw={500} mb={2}>{label}</Text>
      {children}
    </div>
  );
}

export function StudyDetailDrawer({
  study,
  opened,
  onClose,
  isOpenForApplications,
}: {
  study: ResearchStudy | null;
  opened: boolean;
  onClose: () => void;
  isOpenForApplications?: boolean;
}) {
  const { t, i18n } = useTranslation();

  // Compute available languages — depends on the study. If only EN
  // is present, we hide the switcher.
  const availableLocales = useMemo(() => getAvailableLocales(study), [study]);

  // Default: current app language if it is available; otherwise EN.
  const [selectedLocale, setSelectedLocale] = useState<string>('en');
  useEffect(() => {
    const appLang = i18n.language.split('-')[0].toLowerCase();
    setSelectedLocale(availableLocales.includes(appLang) ? appLang : 'en');
  }, [availableLocales, i18n.language, study?.id]);

  // Localized texts — overridden via selectedLocale.
  const localizedShortTitle = useStudyText(study, 'short-title', selectedLocale);
  const localizedSummary = useStudyText(study, 'summary', selectedLocale);
  const localizedDescription = useStudyText(study, 'description', selectedLocale);
  const localizedWhyStopped = useStudyText(study, 'why-stopped', selectedLocale);
  const localizedEligibilityText = useStudyText(study, 'eligibility', selectedLocale);

  if (!study) return null;

  const phase = study.phase?.text || study.phase?.coding?.[0]?.display || study.phase?.coding?.[0]?.code;
  const start = study.period?.start;
  const end = study.period?.end;

  const sponsorRef = (study.sponsor as { reference?: string } | undefined)?.reference;
  const sponsorOrg = sponsorRef?.startsWith('#')
    ? (study.contained?.find(
        (r) => r.resourceType === 'Organization' && r.id === sponsorRef.slice(1),
      ) as { name?: string } | undefined)
    : null;
  const sponsorName = sponsorOrg?.name;

  const nctId = study.identifier?.find((id) => id.system === 'https://clinicaltrials.gov')?.value;
  const euctId = study.identifier?.find((id) => id.system === 'https://euclinicaltrials.eu')?.value;

  const contactName = study.contact?.[0]?.name;
  const contactEmail = study.contact?.[0]?.telecom?.find((t) => t.system === 'email')?.value;
  const contactPhone = study.contact?.[0]?.telecom?.find((t) => t.system === 'phone')?.value;

  const externalUrl = study.relatedArtifact?.find((a) => (a.type as string) === 'url')?.url;

  const summary = localizedSummary;
  const displayTitle = localizedShortTitle || study.title;

  const category = (study.category as { coding?: { display?: string; code?: string }[] }[] | undefined)?.[0]
    ?.coding?.[0];
  const categoryText = category?.display || category?.code;

  // Sites from contained Locations
  const siteRefs = (study.site || [])
    .map((s) => (s as { reference?: string }).reference)
    .filter((r): r is string => !!r && r.startsWith('#'));
  const sites = siteRefs.map((ref) => {
    const loc = study.contained?.find(
      (r) => r.resourceType === 'Location' && r.id === ref.slice(1),
    ) as { name?: string; address?: { city?: string; country?: string } } | undefined;
    return {
      name: loc?.name,
      city: loc?.address?.city,
      country: loc?.address?.country,
    };
  }).filter((s) => s.name || s.city || s.country);

  const formatSiteLabel = (s: { name?: string; city?: string; country?: string }): string => {
    // We assemble a clean label from the three levels — without
    // duplicates. Examples:
    //   "Klinikum X, München (DE)"
    //   "München (DE)"
    //   "Germany"
    const parts: string[] = [];
    if (s.name) parts.push(s.name);
    if (s.city && s.city !== s.name) parts.push(s.city);
    const head = parts.join(', ');
    if (s.country && s.country !== s.name && s.country !== s.city) {
      return head ? `${head} (${s.country})` : s.country;
    }
    return head || s.country || '';
  };

  // Eligibility — for EN or without translation: structured criteria.
  // For non-EN with translated free text: show the free text as prose.
  const eligibilityExt = study.extension?.find((e) => e.url === 'http://help-cure-als.org/ext/eligibility');
  interface Criterion { type: string; description: string }
  const criteria = ((eligibilityExt?.extension || []) as Array<{ url?: string; extension?: Array<{ url?: string; valueCode?: string; valueString?: string }> }>)
    .filter((c) => c.url === 'criterion')
    .map((c) => {
      const subs = c.extension || [];
      const type = subs.find((s) => s.url === 'type')?.valueCode;
      const desc = subs.find((s) => s.url === 'description')?.valueString;
      return { type: type === 'exclusion' ? 'exclusion' : 'inclusion', description: desc };
    })
    .filter((c): c is Criterion => Boolean(c.description));

  const useTranslatedEligibility = selectedLocale !== 'en' && !!localizedEligibilityText;
  const inclusionCriteria = criteria.filter((c) => c.type === 'inclusion');
  const exclusionCriteria = criteria.filter((c) => c.type === 'exclusion');

  const keywords = study.keyword?.map((k) => k.text).filter((t): t is string => !!t);

  const showLanguageSwitch = availableLocales.length > 1;

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      title={t('studies.detailTitle')}
      position="right"
      size="lg"
    >
      <Stack gap="md">
        {showLanguageSwitch && (
          <div>
            <Text size="xs" c="dimmed" fw={500} mb={4}>
              {t('studies.languageLabel')}
            </Text>
            <SegmentedControl
              size="xs"
              value={selectedLocale}
              onChange={setSelectedLocale}
              data={availableLocales.map((code) => ({
                value: code,
                label: LANGUAGE_LABELS[code] ?? code.toUpperCase(),
              }))}
              fullWidth
            />
          </div>
        )}

        <Title order={4}>{displayTitle}</Title>

        <Group gap="xs">
          <Badge variant="light" color={STATUS_COLOR[study.status ?? ''] || 'gray'}>
            {study.status || '—'}
          </Badge>
          {phase && <Badge variant="outline" color="gray">{phase}</Badge>}
          {categoryText && <Badge variant="outline" color="gray">{categoryText}</Badge>}
        </Group>

        {isOpenForApplications !== undefined && (
          <Badge variant="light" color={isOpenForApplications ? 'green' : 'gray'}>
            {isOpenForApplications
              ? t('clinicProfile.openForApplications')
              : t('clinicProfile.closedForApplications')}
          </Badge>
        )}

        {summary && (
          <LabelValue label={t('studies.description')}>
            <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{summary}</Text>
          </LabelValue>
        )}

        {localizedDescription && localizedDescription !== summary && (
          <LabelValue label={t('studies.detailedDescription')}>
            <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{localizedDescription}</Text>
          </LabelValue>
        )}

        {localizedWhyStopped && (
          <LabelValue label={t('studies.whyStopped')}>
            <Text size="sm" c="red.7" style={{ whiteSpace: 'pre-wrap' }}>{localizedWhyStopped}</Text>
          </LabelValue>
        )}

        <Divider />

        <Group grow>
          {(start || end) && (
            <LabelValue label={t('studies.period')}>
              <Text size="sm">
                {start ? new Date(start).toLocaleDateString() : '?'}
                {' — '}
                {end ? new Date(end).toLocaleDateString() : t('studies.ongoing')}
              </Text>
            </LabelValue>
          )}
          {sponsorName && (
            <LabelValue label={t('studies.sponsor')}>
              <Text size="sm">{sponsorName}</Text>
            </LabelValue>
          )}
        </Group>

        {nctId && (
          <LabelValue label="ClinicalTrials.gov">
            <Anchor href={`https://clinicaltrials.gov/study/${nctId}`} target="_blank" size="sm">
              {nctId}
            </Anchor>
          </LabelValue>
        )}

        {euctId && (
          <LabelValue label="CTIS (EU)">
            <Anchor
              href={`https://euclinicaltrials.eu/ctis-public/view/${euctId}`}
              target="_blank"
              size="sm"
            >
              {euctId}
            </Anchor>
          </LabelValue>
        )}

        {externalUrl && (
          <LabelValue label={t('studies.externalLink')}>
            <Anchor href={externalUrl} target="_blank" size="sm">{externalUrl}</Anchor>
          </LabelValue>
        )}

        {(contactName || contactEmail || contactPhone) && (
          <>
            <Divider />
            <LabelValue label={t('studies.contact')}>
              <Stack gap={2}>
                {contactName && <Text size="sm">{contactName}</Text>}
                {contactEmail && <Anchor href={`mailto:${contactEmail}`} size="sm">{contactEmail}</Anchor>}
                {contactPhone && <Text size="sm">{contactPhone}</Text>}
              </Stack>
            </LabelValue>
          </>
        )}

        {sites.length > 0 && (
          <>
            <Divider />
            <LabelValue label={t('studies.sites', { count: sites.length })}>
              <List size="sm" spacing={2}>
                {sites.map((site, i) => (
                  <List.Item key={i}>{formatSiteLabel(site)}</List.Item>
                ))}
              </List>
            </LabelValue>
          </>
        )}

        {(useTranslatedEligibility || criteria.length > 0) && (
          <>
            <Divider />
            {useTranslatedEligibility ? (
              <LabelValue label={t('studies.eligibilityCriteria')}>
                <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{localizedEligibilityText}</Text>
              </LabelValue>
            ) : (
              <>
                {inclusionCriteria.length > 0 && (
                  <LabelValue label={t('studies.inclusionCriteria')}>
                    <List size="sm" spacing={2}>
                      {inclusionCriteria.map((c, i) => (
                        <List.Item key={i}>{c.description}</List.Item>
                      ))}
                    </List>
                  </LabelValue>
                )}
                {exclusionCriteria.length > 0 && (
                  <LabelValue label={t('studies.exclusionCriteria')}>
                    <List size="sm" spacing={2}>
                      {exclusionCriteria.map((c, i) => (
                        <List.Item key={i}>{c.description}</List.Item>
                      ))}
                    </List>
                  </LabelValue>
                )}
              </>
            )}
          </>
        )}

        {keywords && keywords.length > 0 && (
          <>
            <Divider />
            <LabelValue label={t('studies.keywords')}>
              <Group gap={4}>
                {keywords.map((kw) => (
                  <Badge key={kw} variant="light" color="gray" size="sm">{kw}</Badge>
                ))}
              </Group>
            </LabelValue>
          </>
        )}
      </Stack>
    </Drawer>
  );
}
