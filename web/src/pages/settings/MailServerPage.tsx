/**
 * Settings -> Mail-Server (moonshot pattern): SMTP configuration,
 * test mail, and the invitation template. The password is write-only;
 * the server reports only whether one is stored.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Badge,
  Button,
  Divider,
  Group,
  NumberInput,
  PasswordInput,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { Mail, Send } from 'lucide-react';
import { PageHeader } from '@hca/mantine-workbench';
import {
  getMailSettings,
  saveMailSettings,
  saveMailTemplates,
  sendTestMail,
  type MailTemplates,
} from '../../lib/mailApi';

interface SmtpForm {
  host: string;
  port: number | '';
  secure: boolean;
  username: string;
  password: string;
  from_email: string;
  from_name: string;
  reply_to: string;
  portal_base_url: string;
}

const EMPTY_FORM: SmtpForm = {
  host: '',
  port: 587,
  secure: false,
  username: '',
  password: '',
  from_email: '',
  from_name: '',
  reply_to: '',
  portal_base_url: '',
};

export function MailServerPage() {
  const { t } = useTranslation();

  const [form, setForm] = useState<SmtpForm>(EMPTY_FORM);
  const [hasPassword, setHasPassword] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [templates, setTemplates] = useState<MailTemplates | null>(null);
  const [defaults, setDefaults] = useState<MailTemplates | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingSmtp, setSavingSmtp] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const data = await getMailSettings();
        setForm({
          host: data.smtp.host ?? '',
          port: data.smtp.port ?? 587,
          secure: data.smtp.secure ?? false,
          username: data.smtp.username ?? '',
          password: '',
          from_email: data.smtp.from_email ?? '',
          from_name: data.smtp.from_name ?? '',
          reply_to: data.smtp.reply_to ?? '',
          portal_base_url: data.smtp.portal_base_url ?? '',
        });
        setHasPassword(data.smtp.has_password);
        setConfigured(data.configured);
        setTemplates(data.templates);
        setDefaults(data.defaults);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSaveSmtp = async () => {
    setSavingSmtp(true);
    try {
      const result = await saveMailSettings({
        host: form.host,
        port: form.port === '' ? undefined : form.port,
        secure: form.secure,
        username: form.username,
        ...(form.password ? { password: form.password } : {}),
        from_email: form.from_email,
        from_name: form.from_name,
        reply_to: form.reply_to,
        portal_base_url: form.portal_base_url,
      });
      setHasPassword(result.smtp.has_password);
      setConfigured(result.configured);
      setForm((f) => ({ ...f, password: '' }));
      notifications.show({ color: 'teal', title: t('mail.saved'), message: '' });
    } catch (err) {
      notifications.show({ color: 'red', title: t('mail.saveFailed'), message: String(err) });
    } finally {
      setSavingSmtp(false);
    }
  };

  const handleSaveTemplate = async () => {
    if (!templates) return;
    setSavingTemplate(true);
    try {
      setTemplates(await saveMailTemplates({ invitation: templates.invitation }));
      notifications.show({ color: 'teal', title: t('mail.templateSaved'), message: '' });
    } catch (err) {
      notifications.show({ color: 'red', title: t('mail.saveFailed'), message: String(err) });
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      await sendTestMail(testTo.trim());
      notifications.show({ color: 'teal', title: t('mail.testSent'), message: testTo.trim() });
    } catch (err) {
      notifications.show({ color: 'red', title: t('mail.testFailed'), message: String(err) });
    } finally {
      setTesting(false);
    }
  };

  if (loading) return null;

  return (
    <Stack gap="lg" h="100%" style={{ minHeight: 0, overflow: 'auto' }}>
      <PageHeader
        title={t('settings.mailServer')}
        subtitle={t('mail.subtitle')}
        actions={
          <Badge variant="light" color={configured ? 'teal' : 'gray'}>
            {configured ? t('mail.configured') : t('mail.notConfigured')}
          </Badge>
        }
      />

      {error && <Alert color="red" mx="md">{error}</Alert>}

      <Stack gap="md" px="md" pb="xl" maw={720}>
        <Title order={5}>{t('mail.smtpSection')}</Title>
        <Group grow>
          <TextInput
            label={t('mail.host')}
            placeholder="smtp.example.org"
            value={form.host}
            onChange={(e) => setForm({ ...form, host: e.currentTarget.value })}
          />
          <NumberInput
            label={t('mail.port')}
            min={1}
            max={65535}
            value={form.port}
            onChange={(v) => setForm({ ...form, port: typeof v === 'number' ? v : '' })}
          />
        </Group>
        <Switch
          label={t('mail.secure')}
          checked={form.secure}
          onChange={(e) => setForm({ ...form, secure: e.currentTarget.checked })}
        />
        <Group grow>
          <TextInput
            label={t('mail.username')}
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.currentTarget.value })}
          />
          <PasswordInput
            label={t('mail.password')}
            placeholder={hasPassword ? t('mail.passwordStored') : ''}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.currentTarget.value })}
          />
        </Group>
        <Group grow>
          <TextInput
            label={t('mail.fromEmail')}
            placeholder="portal@tenos.app"
            value={form.from_email}
            onChange={(e) => setForm({ ...form, from_email: e.currentTarget.value })}
          />
          <TextInput
            label={t('mail.fromName')}
            value={form.from_name}
            onChange={(e) => setForm({ ...form, from_name: e.currentTarget.value })}
          />
        </Group>
        <Group grow>
          <TextInput
            label={t('mail.replyTo')}
            value={form.reply_to}
            onChange={(e) => setForm({ ...form, reply_to: e.currentTarget.value })}
          />
          <TextInput
            label={t('mail.portalBaseUrl')}
            description={t('mail.portalBaseUrlHint')}
            placeholder="https://clinic.tenos.app"
            value={form.portal_base_url}
            onChange={(e) => setForm({ ...form, portal_base_url: e.currentTarget.value })}
          />
        </Group>
        <Group>
          <Button color="hca-purple" loading={savingSmtp} onClick={() => void handleSaveSmtp()}>
            {t('common.save')}
          </Button>
        </Group>

        <Divider my="sm" />

        <Title order={5}>{t('mail.testSection')}</Title>
        <Group align="flex-end">
          <TextInput
            label={t('mail.testRecipient')}
            leftSection={<Mail size={14} />}
            value={testTo}
            onChange={(e) => setTestTo(e.currentTarget.value)}
            style={{ flex: 1, maxWidth: 360 }}
          />
          <Button
            variant="light"
            leftSection={<Send size={14} />}
            loading={testing}
            disabled={testTo.trim() === ''}
            onClick={() => void handleTest()}
          >
            {t('mail.sendTest')}
          </Button>
        </Group>

        <Divider my="sm" />

        <Title order={5}>{t('mail.templateSection')}</Title>
        <Text fz="xs" c="dimmed">{t('mail.templateHint')}</Text>
        {templates && (
          <>
            <TextInput
              label={t('mail.templateSubject')}
              value={templates.invitation.subject}
              onChange={(e) => setTemplates({
                invitation: { ...templates.invitation, subject: e.currentTarget.value },
              })}
            />
            <Textarea
              label={t('mail.templateBody')}
              autosize
              minRows={10}
              styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }}
              value={templates.invitation.body}
              onChange={(e) => setTemplates({
                invitation: { ...templates.invitation, body: e.currentTarget.value },
              })}
            />
            <Group>
              <Button
                color="hca-purple"
                loading={savingTemplate}
                onClick={() => void handleSaveTemplate()}
              >
                {t('mail.saveTemplate')}
              </Button>
              {defaults && (
                <Button
                  variant="subtle"
                  onClick={() => setTemplates({ invitation: defaults.invitation })}
                >
                  {t('mail.resetTemplate')}
                </Button>
              )}
            </Group>
          </>
        )}
      </Stack>
    </Stack>
  );
}
