import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Stack,
  TextInput,
  Button,
  Paper,
  SimpleGrid,
  Loader,
  Center,
  Text,
  Divider,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import type { Organization, OrganizationContact } from '@medplum/fhirtypes';
import { PageHeader } from '@hca/mantine-workbench';

import { useAuthStore } from '../../stores/auth';
import { medplum } from '../../lib/medplum';

// Wave UI.27 — study contact details in Organization.contact[].
// FHIR StandardEntityType codes (BILL, ADMIN, HR, PAYOR, PATINF,
// PRESS) do not cover `research`/`study`, hence an HCA-specific
// CodeSystem URL. The mobile app reads `contact[purpose=study-contact]`
// and shows phone+email in the "apply for study" flow.
const STUDY_CONTACT_SYSTEM = 'http://help-cure-als.org/contact-type';
const STUDY_CONTACT_CODE = 'study-contact';

function isStudyContact(c: OrganizationContact): boolean {
  return !!c.purpose?.coding?.some(
    (co) => co.system === STUDY_CONTACT_SYSTEM && co.code === STUDY_CONTACT_CODE
  );
}

function getStudyContact(org: Organization | null): {
  phone: string;
  email: string;
} {
  const c = org?.contact?.find(isStudyContact);
  return {
    phone: c?.telecom?.find((t) => t.system === 'phone')?.value ?? '',
    email: c?.telecom?.find((t) => t.system === 'email')?.value ?? '',
  };
}

function buildStudyContact(
  phone: string,
  email: string
): OrganizationContact | null {
  const telecom: { system: 'phone' | 'email'; value: string }[] = [];
  if (phone.trim()) telecom.push({ system: 'phone', value: phone.trim() });
  if (email.trim()) telecom.push({ system: 'email', value: email.trim() });
  if (telecom.length === 0) return null;
  return {
    purpose: {
      coding: [
        {
          system: STUDY_CONTACT_SYSTEM,
          code: STUDY_CONTACT_CODE,
          display: 'Studien-Kontakt',
        },
      ],
    },
    telecom,
  };
}

export function ClinicProfilePage() {
  const { t } = useTranslation();
  const { organization } = useAuthStore();

  const form = useForm({
    initialValues: {
      name: '',
      line: '',
      postalCode: '',
      city: '',
      country: '',
      phone: '',
      email: '',
      website: '',
      studyPhone: '',
      studyEmail: '',
    },
  });

  useEffect(() => {
    if (organization) {
      const addr = organization.address?.[0];
      const phone = organization.telecom?.find(
        (t) => t.system === 'phone'
      )?.value;
      const email = organization.telecom?.find(
        (t) => t.system === 'email'
      )?.value;
      const website = organization.telecom?.find(
        (t) => t.system === 'url'
      )?.value;
      const study = getStudyContact(organization);

      form.setValues({
        name: organization.name || '',
        line: addr?.line?.join(', ') || '',
        postalCode: addr?.postalCode || '',
        city: addr?.city || '',
        country: addr?.country || '',
        phone: phone || '',
        email: email || '',
        website: website || '',
        studyPhone: study.phone,
        studyEmail: study.email,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization]);

  if (!organization) {
    return (
      <Center h={300}>
        <Loader color="hca-purple" />
      </Center>
    );
  }

  const handleSubmit = async (values: typeof form.values) => {
    try {
      const telecom = [];
      if (values.phone)
        telecom.push({ system: 'phone' as const, value: values.phone });
      if (values.email)
        telecom.push({ system: 'email' as const, value: values.email });
      if (values.website)
        telecom.push({ system: 'url' as const, value: values.website });

      // Other `contact` entries (e.g. BILL/ADMIN) remain unchanged;
      // only the study contact is replaced.
      const otherContacts =
        organization.contact?.filter((c) => !isStudyContact(c)) ?? [];
      const studyContact = buildStudyContact(
        values.studyPhone,
        values.studyEmail
      );
      const nextContacts = studyContact
        ? [...otherContacts, studyContact]
        : otherContacts;

      const updated = await medplum.updateResource({
        ...organization,
        name: values.name,
        address: [
          {
            line: values.line ? [values.line] : undefined,
            postalCode: values.postalCode || undefined,
            city: values.city || undefined,
            country: values.country || undefined,
          },
        ],
        telecom,
        contact: nextContacts.length > 0 ? nextContacts : undefined,
      });

      useAuthStore.setState({ organization: updated });

      notifications.show({
        title: t('common.saved'),
        message: t('clinicProfile.savedMessage'),
        color: 'green',
      });
    } catch {
      notifications.show({
        title: t('common.error'),
        message: t('clinicProfile.saveError'),
        color: 'red',
      });
    }
  };

  return (
    <Stack gap="lg" h="100%" style={{ minHeight: 0 }}>
      <PageHeader
        title={t('clinicProfile.title')}
        subtitle={t('clinicProfile.subtitle')}
      />

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <Paper withBorder p="lg">
          <form onSubmit={form.onSubmit(handleSubmit)}>
            <Stack gap="md">
              <TextInput
                label={t('clinicProfile.name')}
                {...form.getInputProps('name')}
                required
              />
              <TextInput
                label={t('clinicProfile.street')}
                {...form.getInputProps('line')}
              />
              <SimpleGrid cols={3}>
                <TextInput
                  label={t('clinicProfile.postalCode')}
                  {...form.getInputProps('postalCode')}
                />
                <TextInput
                  label={t('clinicProfile.city')}
                  {...form.getInputProps('city')}
                />
                <TextInput
                  label={t('clinicProfile.country')}
                  {...form.getInputProps('country')}
                />
              </SimpleGrid>
              <SimpleGrid cols={3}>
                <TextInput
                  label={t('clinicProfile.phone')}
                  {...form.getInputProps('phone')}
                />
                <TextInput
                  label={t('auth.email')}
                  {...form.getInputProps('email')}
                />
                <TextInput
                  label={t('clinicProfile.website')}
                  {...form.getInputProps('website')}
                />
              </SimpleGrid>

              <Divider my="sm" />

              <div>
                <Text fw={500}>
                  {t('clinicProfile.studyContactSection')}
                </Text>
                <Text size="xs" c="dimmed" mt={2}>
                  {t('clinicProfile.studyContactDescription')}
                </Text>
              </div>
              <SimpleGrid cols={2}>
                <TextInput
                  label={t('clinicProfile.studyPhone')}
                  type="tel"
                  {...form.getInputProps('studyPhone')}
                />
                <TextInput
                  label={t('clinicProfile.studyEmail')}
                  type="email"
                  {...form.getInputProps('studyEmail')}
                />
              </SimpleGrid>

              <Button type="submit" color="teal">
                {t('common.save')}
              </Button>
            </Stack>
          </form>
        </Paper>
      </div>
    </Stack>
  );
}
