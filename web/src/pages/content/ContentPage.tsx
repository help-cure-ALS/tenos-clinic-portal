/**
 * Editorial content — articles for the app's news tab.
 *
 * hca admins: global articles + category management.
 * Clinic admins: articles of their own clinic (visible only to
 * patients connected to that clinic; goes live without review).
 *
 * List built on the workbench components (PageHeader, DataGrid,
 * SearchInput); the editor lives in a Drawer like the other detail
 * views. Publishing mirrors the article to the care server; the
 * targeting (countries, phase since symptom onset, ALSFRS-R) is
 * evaluated on the patients' devices, never here.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Center,
  CloseButton,
  Divider,
  Drawer,
  FileButton,
  Group,
  Image,
  Loader,
  Modal,
  MultiSelect,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { Newspaper, Pin, Plus, Tags, Trash2 } from 'lucide-react';
import {
  PageHeader,
  DataGrid,
  SearchInput,
  BulkActionBar,
  BulkPill,
  useGridSort,
  useRowSelection,
  type Column,
} from '@hca/mantine-workbench';
import { RichTextEditor } from '@hca/mantine-workbench/rich-text';
import { useAuthStore } from '../../stores/auth';
import {
  createContentArticle,
  deleteContentArticle,
  deleteContentCategory,
  fetchContentArticleImage,
  getContentArticle,
  listContentArticles,
  listContentCategories,
  saveContentCategory,
  setContentArticleImage,
  setContentArticleStatus,
  updateContentArticle,
  type AlsfrsScale,
  type ArticleInput,
  type ArticleRole,
  type ArticleStatus,
  type ContentArticle,
  type ContentCategory,
} from '../../lib/contentApi';

const APP_LANGUAGES = ['de', 'en', 'es', 'fr', 'it', 'ja', 'nl', 'pl', 'pt', 'ro', 'tr', 'zh'];

/** Curated country list — the app's plausible markets. */
const COUNTRY_CODES = [
  'DE', 'AT', 'CH', 'FR', 'IT', 'ES', 'PT', 'NL', 'BE', 'LU', 'DK', 'SE', 'NO', 'FI', 'IS',
  'GB', 'IE', 'PL', 'CZ', 'SK', 'HU', 'RO', 'BG', 'GR', 'HR', 'SI', 'EE', 'LV', 'LT',
  'US', 'CA', 'AU', 'NZ', 'JP', 'TR', 'IL',
];

const MAX_IMAGE_DIMENSION = 1600;

const STATUS_COLOR: Record<ArticleStatus, string> = {
  draft: 'gray',
  publishing: 'blue',
  public: 'teal',
  archived: 'orange',
};

interface FormState {
  category_id: string;
  original_lang: string;
  translate: boolean;
  title: string;
  teaser: string;
  body_html: string;
  link_url: string;
  countries: string[];
  roles: ArticleRole[];
  pinned: boolean;
  phase_min: number | '';
  phase_max: number | '';
  alsfrs_scale: AlsfrsScale | '';
  /** Direction: 'lte' = at most (scores fall over the course), 'gte' = at least. */
  alsfrs_op: 'lte' | 'gte';
  alsfrs_value: number | '';
  article_date: string;
  starts_at: string;
  ends_at: string;
  hide_read_days: number | '';
}

function emptyForm(lang: string, firstCategory: string): FormState {
  return {
    category_id: firstCategory,
    original_lang: APP_LANGUAGES.includes(lang) ? lang : 'de',
    translate: true,
    title: '',
    teaser: '',
    body_html: '',
    link_url: '',
    countries: [],
    roles: [],
    pinned: false,
    phase_min: '',
    phase_max: '',
    alsfrs_scale: '',
    alsfrs_op: 'lte',
    alsfrs_value: '',
    article_date: new Date().toISOString().slice(0, 10),
    starts_at: '',
    ends_at: '',
    hide_read_days: '',
  };
}

function formFromArticle(a: ContentArticle): FormState {
  return {
    category_id: a.category_id,
    original_lang: a.original_lang,
    translate: a.translate,
    title: a.title,
    teaser: a.teaser,
    body_html: a.body_html,
    link_url: a.link_url ?? '',
    countries: a.countries,
    roles: a.roles,
    pinned: a.pinned,
    phase_min: a.phase_min_months ?? '',
    phase_max: a.phase_max_months ?? '',
    alsfrs_scale: a.alsfrs_scale ?? '',
    // Stored as a min/max range; the editor exposes one threshold
    // with a direction. A max bound wins (scores fall over time).
    alsfrs_op: a.alsfrs_max === null && a.alsfrs_min !== null ? 'gte' : 'lte',
    alsfrs_value: a.alsfrs_max ?? a.alsfrs_min ?? '',
    article_date: a.article_date,
    starts_at: a.starts_at ?? '',
    ends_at: a.ends_at ?? '',
    hide_read_days: a.hide_read_after_days ?? '',
  };
}

function toInput(f: FormState): ArticleInput {
  return {
    category_id: f.category_id,
    original_lang: f.original_lang,
    translate: f.translate,
    title: f.title.trim(),
    teaser: f.teaser.trim(),
    body_html: f.body_html,
    link_url: f.link_url.trim() === '' ? null : f.link_url.trim(),
    countries: f.countries,
    roles: f.roles,
    pinned: f.pinned,
    phase_min_months: f.phase_min === '' ? null : f.phase_min,
    phase_max_months: f.phase_max === '' ? null : f.phase_max,
    alsfrs_scale: f.alsfrs_scale === '' || f.alsfrs_value === '' ? null : f.alsfrs_scale,
    alsfrs_min: f.alsfrs_scale !== '' && f.alsfrs_value !== '' && f.alsfrs_op === 'gte' ? f.alsfrs_value : null,
    alsfrs_max: f.alsfrs_scale !== '' && f.alsfrs_value !== '' && f.alsfrs_op === 'lte' ? f.alsfrs_value : null,
    article_date: f.article_date,
    starts_at: f.starts_at === '' ? null : f.starts_at,
    ends_at: f.ends_at === '' ? null : f.ends_at,
    hide_read_after_days: f.hide_read_days === '' ? null : f.hide_read_days,
  };
}

/** Downscale to max 1600px and re-encode as JPEG (base64, no prefix). */
async function downscaleImage(file: File): Promise<{ base64: string; contentType: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not available');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return { base64: dataUrl.split(',')[1], contentType: 'image/jpeg' };
}

export function ContentPage() {
  const { t, i18n } = useTranslation();
  const { userRole } = useAuthStore();
  const isHca = userRole === 'hca-admin';

  const [articles, setArticles] = useState<ContentArticle[]>([]);
  const [categories, setCategories] = useState<ContentCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm('de', ''));
  const [saving, setSaving] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const pendingImage = useRef<{ base64: string; contentType: string } | null | undefined>(undefined);
  const initialForm = useRef<string>('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ContentArticle[] | null>(null);

  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [newCategory, setNewCategory] = useState({ id: '', label: '' });

  const load = useCallback(async () => {
    setError('');
    try {
      const [arts, cats] = await Promise.all([listContentArticles(), listContentCategories()]);
      setArticles(arts);
      setCategories(cats);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A background publish is running — poll until it settles so the
  // status badge flips to public (or back to draft with an error).
  const anyPublishing = articles.some((a) => a.status === 'publishing');
  useEffect(() => {
    if (!anyPublishing) return;
    const timer = setInterval(() => { void load(); }, 3000);
    return () => clearInterval(timer);
  }, [anyPublishing, load]);

  const categoryLabel = useCallback((id: string): string => {
    const cat = categories.find((c) => c.id === id);
    return cat?.labels_i18n?.[i18n.language] ?? cat?.label ?? id;
  }, [categories, i18n.language]);

  const filteredArticles = useMemo(() => {
    const q = query.trim().toLowerCase();
    return articles.filter((a) => {
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      if (q && !a.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [articles, statusFilter, query]);

  const columns: Column<ContentArticle>[] = useMemo(
    () => [
      {
        id: 'title',
        header: t('content.colTitle'),
        sortable: true,
        minWidth: 280,
        cell: (a) => (
          <Group gap={6} wrap="nowrap">
            {a.pinned && <Pin size={14} style={{ flexShrink: 0, opacity: 0.6 }} />}
            <Text fz="sm" fw={500}>{a.title}</Text>
          </Group>
        ),
      },
      {
        id: 'category',
        header: t('content.colCategory'),
        width: 160,
        cell: (a) => (
          <Badge variant="light" color="blue">{categoryLabel(a.category_id)}</Badge>
        ),
      },
      {
        id: 'status',
        header: t('content.colStatus'),
        sortable: true,
        width: 150,
        cell: (a) => (
          <Badge variant="light" color={STATUS_COLOR[a.status]}>
            {t(`content.status${a.status[0].toUpperCase()}${a.status.slice(1)}`)}
          </Badge>
        ),
      },
      {
        id: 'date',
        header: t('content.colDate'),
        sortable: true,
        width: 130,
        cell: (a: ContentArticle) => <Text fz="sm">{a.article_date}</Text>,
      },
      {
        id: 'window',
        header: t('content.colWindow'),
        sortable: true,
        width: 210,
        cell: (a) => (
          <Text fz="sm" c="dimmed">
            {a.starts_at ?? '…'} – {a.ends_at ?? '…'}
          </Text>
        ),
      },
      ...(isHca
        ? [{
            id: 'source',
            header: t('content.colSource'),
            width: 180,
            cell: (a: ContentArticle) => (
              <Text fz="sm" c="dimmed">
                {a.source === 'hca' ? 'HCA' : a.clinic_name ?? t('content.sourceClinic')}
              </Text>
            ),
          }]
        : []),
    ],
    [t, isHca, categoryLabel],
  );

  const countryOptions = useMemo(() => {
    const names = new Intl.DisplayNames([i18n.language], { type: 'region' });
    return COUNTRY_CODES
      .map((code) => ({ value: code, label: names.of(code) ?? code }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [i18n.language]);

  const selection = useRowSelection();

  const sort = useGridSort<ContentArticle>({
    mode: 'client',
    rows: filteredArticles,
    initial: { sortBy: 'date', sortDir: 'desc' },
    getValue: (row, columnId) => {
      switch (columnId) {
        case 'title':
          return row.title;
        case 'status':
          return row.status;
        case 'date':
          return row.article_date;
        case 'window':
          return row.starts_at ?? '';
        default:
          return null;
      }
    },
  });

  async function openEditor(article?: ContentArticle) {
    pendingImage.current = undefined;
    setImageUrl(null);
    if (article) {
      try {
        const full = await getContentArticle(article.id);
        setEditingId(full.id);
        const initial = formFromArticle(full);
        setForm(initial);
        initialForm.current = JSON.stringify(initial);
        if (full.has_image) {
          setImageUrl(await fetchContentArticleImage(full.id));
        }
      } catch (err) {
        notifications.show({ color: 'red', title: t('content.loadFailed'), message: String(err) });
        return;
      }
    } else {
      setEditingId(null);
      const initial = emptyForm(i18n.language, categories.find((c) => c.active)?.id ?? '');
      setForm(initial);
      initialForm.current = JSON.stringify(initial);
    }
    setEditorOpen(true);
  }

  const isDirty = () =>
    JSON.stringify(form) !== initialForm.current || pendingImage.current !== undefined;

  /** Drawer close goes through here — unsaved changes need a decision. */
  function requestCloseEditor() {
    if (isDirty()) {
      setConfirmDiscard(true);
      return;
    }
    setEditorOpen(false);
  }

  async function handlePickImage(file: File | null) {
    if (!file) return;
    try {
      const scaled = await downscaleImage(file);
      pendingImage.current = scaled;
      setImageUrl(`data:${scaled.contentType};base64,${scaled.base64}`);
    } catch (err) {
      notifications.show({ color: 'red', title: t('content.imageFailed'), message: String(err) });
    }
  }

  function handleRemoveImage() {
    pendingImage.current = null;
    setImageUrl(null);
  }

  async function saveEditor(): Promise<string | null> {
    setSaving(true);
    try {
      const input = toInput(form);
      let id = editingId;
      if (id) {
        await updateContentArticle(id, input);
      } else {
        id = await createContentArticle(input);
        setEditingId(id);
      }
      if (pendingImage.current !== undefined) {
        if (pendingImage.current === null) {
          await setContentArticleImage(id, null, null);
        } else {
          await setContentArticleImage(id, pendingImage.current.base64, pendingImage.current.contentType);
        }
        pendingImage.current = undefined;
      }
      initialForm.current = JSON.stringify(form);
      await load();
      return id;
    } catch (err) {
      notifications.show({ color: 'red', title: t('content.saveFailed'), message: String(err) });
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    const id = await saveEditor();
    if (id) {
      setEditorOpen(false);
      notifications.show({ color: 'teal', title: t('content.saved'), message: '' });
    }
  }

  async function handleStatus(status: ArticleStatus) {
    const id = await saveEditor();
    if (!id) return;
    setSaving(true);
    try {
      await setContentArticleStatus(id, status);
      await load();
      setEditorOpen(false);
      notifications.show({
        color: 'teal',
        title: status === 'public' ? t('content.publishStarted') : t('content.statusChanged'),
        message: status === 'public' ? t('content.publishStartedMessage') : '',
      });
    } catch (err) {
      notifications.show({ color: 'red', title: t('content.statusFailed'), message: String(err) });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirmDelete || confirmDelete.length === 0) return;
    try {
      for (const article of confirmDelete) {
        await deleteContentArticle(article.id);
      }
      setConfirmDelete(null);
      setEditorOpen(false);
      selection.clear();
      await load();
    } catch (err) {
      notifications.show({ color: 'red', title: t('content.deleteFailed'), message: String(err) });
      await load();
    }
  }

  async function handleAddCategory() {
    if (!newCategory.id || !newCategory.label) return;
    try {
      await saveContentCategory({
        id: newCategory.id,
        label: newCategory.label,
        original_lang: i18n.language === 'de' ? 'de' : 'en',
        sort: categories.length,
        active: true,
      });
      setNewCategory({ id: '', label: '' });
      await load();
    } catch (err) {
      notifications.show({ color: 'red', title: t('content.saveFailed'), message: String(err) });
    }
  }

  const editingArticle = editingId ? articles.find((a) => a.id === editingId) : undefined;
  const currentStatus: ArticleStatus = editingArticle?.status ?? 'draft';

  if (isLoading) {
    return (
      <Center h={300}>
        <Loader color="hca-purple" />
      </Center>
    );
  }

  return (
    <Stack gap="lg" h="100%" style={{ minHeight: 0 }}>
      <PageHeader
        title={t('content.title')}
        subtitle={t('content.subtitle')}
        actions={
          <Group gap="xs">
            {isHca && (
              <Button
                variant="light"
                color="hca-purple"
                leftSection={<Tags size={16} />}
                onClick={() => setCategoriesOpen(true)}
              >
                {t('content.categories')}
              </Button>
            )}
            <Button
              color="hca-purple"
              leftSection={<Plus size={16} />}
              onClick={() => void openEditor()}
            >
              {t('content.newArticle')}
            </Button>
          </Group>
        }
      />

      {error && <Alert color="red" mx="md">{error}</Alert>}

      {articles.length === 0 ? (
        <Center style={{ flex: 1, minHeight: 0 }}>
          <Stack align="center" gap="sm" maw={360}>
            <ThemeIcon variant="light" size="xl" color="gray" radius="xl">
              <Newspaper size={24} />
            </ThemeIcon>
            <Text fw={500}>{t('content.empty')}</Text>
            <Text size="sm" c="dimmed" ta="center">
              {t('content.emptyDesc')}
            </Text>
          </Stack>
        </Center>
      ) : (
        <>
          <Group gap="md" mx="md" wrap="nowrap">
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder={t('content.searchPlaceholder')}
              style={{ maxWidth: 360, flex: 1 }}
            />
            <SegmentedControl
              value={statusFilter}
              onChange={setStatusFilter}
              data={[
                { value: 'all', label: t('content.filterAll') },
                { value: 'draft', label: t('content.statusDraft') },
                { value: 'public', label: t('content.statusPublic') },
                { value: 'archived', label: t('content.statusArchived') },
              ]}
            />
          </Group>

          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <DataGrid<ContentArticle>
              columns={columns}
              data={sort.sortedData}
              getRowId={(row) => row.id}
              sort={sort.value}
              onSortChange={sort.set}
              selection={selection.value}
              onSelectionChange={selection.set}
              onRowClick={(row) => void openEditor(row)}
            />
          </div>

          {selection.value.size > 0 && (
            <BulkActionBar
              selectedLabel={t('common.selected', { count: selection.value.size })}
              onClear={() => selection.clear()}
              clearLabel={t('common.cancel')}
              clearShortcutHint="(Esc)"
            >
              <BulkPill
                variant="text"
                onClick={() => setConfirmDelete(
                  articles.filter((a) => selection.value.has(a.id)),
                )}
              >
                <Trash2 size={14} />
                {t('content.deleteBulk')}
              </BulkPill>
            </BulkActionBar>
          )}
        </>
      )}

      {/* ─── Editor ─────────────────────────────────────────── */}
      <Drawer
        opened={editorOpen}
        onClose={requestCloseEditor}
        position="right"
        size="xl"
        title={editingId ? t('content.editArticle') : t('content.newArticle')}
      >
        <Stack gap="md">
          <Group gap="xs">
            <Badge variant="light" color={STATUS_COLOR[currentStatus]}>
              {t(`content.status${currentStatus[0].toUpperCase()}${currentStatus.slice(1)}`)}
            </Badge>
            {currentStatus === 'publishing' && <Loader size="xs" />}
          </Group>
          {editingArticle?.publish_error && (
            <Alert color="red" title={t('content.publishFailed')}>
              {editingArticle.publish_error}
            </Alert>
          )}

          <TextInput
            label={t('content.fieldTitle')}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.currentTarget.value })}
            required
          />
          <Textarea
            label={t('content.fieldTeaser')}
            description={t('content.fieldTeaserHint')}
            value={form.teaser}
            autosize
            minRows={2}
            onChange={(e) => setForm({ ...form, teaser: e.currentTarget.value })}
          />
          {/* tiptap captures onUpdate at editor creation — the handler
              MUST use a functional update, a captured `form` would
              reset every other field to its state at mount. */}
          <RichTextEditor
            label={t('content.fieldBody')}
            description={t('content.fieldBodyHint')}
            value={form.body_html}
            minHeight={240}
            onChange={(body_html) => setForm((f) => ({ ...f, body_html }))}
          />
          <TextInput
            label={t('content.fieldLink')}
            placeholder="https://…"
            value={form.link_url}
            onChange={(e) => setForm({ ...form, link_url: e.currentTarget.value })}
          />

          <Group grow>
            <Select
              label={t('content.fieldCategory')}
              data={categories.filter((c) => c.active).map((c) => ({
                value: c.id,
                label: categoryLabel(c.id),
              }))}
              value={form.category_id}
              onChange={(v) => v && setForm({ ...form, category_id: v })}
              required
            />
            <Select
              label={t('content.fieldLang')}
              data={APP_LANGUAGES}
              value={form.original_lang}
              onChange={(v) => v && setForm({ ...form, original_lang: v })}
            />
          </Group>

          <Switch
            label={t('content.fieldTranslate')}
            description={t('content.fieldTranslateHint')}
            checked={form.translate}
            onChange={(e) => setForm({ ...form, translate: e.currentTarget.checked })}
          />

          {/* Image */}
          <Stack gap="xs">
            <Text size="sm" fw={500}>{t('content.fieldImage')}</Text>
            {imageUrl && <Image src={imageUrl} radius="md" mah={200} w="auto" fit="contain" />}
            <Group gap="xs">
              <FileButton onChange={(f) => void handlePickImage(f)} accept="image/png,image/jpeg,image/webp">
                {(props) => <Button variant="light" size="xs" {...props}>{t('content.pickImage')}</Button>}
              </FileButton>
              {imageUrl && (
                <Button variant="subtle" color="red" size="xs" onClick={handleRemoveImage}>
                  {t('content.removeImage')}
                </Button>
              )}
            </Group>
          </Stack>

          <TextInput
            type="date"
            label={t('content.fieldArticleDate')}
            description={t('content.fieldArticleDateHint')}
            value={form.article_date}
            onChange={(e) => setForm({ ...form, article_date: e.currentTarget.value })}
            required
          />

          <Switch
            label={t('content.fieldPinned')}
            description={t('content.fieldPinnedHint')}
            checked={form.pinned}
            onChange={(e) => setForm({ ...form, pinned: e.currentTarget.checked })}
          />

          {/* Visibility window */}
          <Group grow>
            <TextInput
              type="date"
              label={t('content.fieldStartsAt')}
              value={form.starts_at}
              onChange={(e) => setForm({ ...form, starts_at: e.currentTarget.value })}
              rightSection={form.starts_at !== '' && (
                <CloseButton size="sm" onClick={() => setForm({ ...form, starts_at: '' })} />
              )}
            />
            <TextInput
              type="date"
              label={t('content.fieldEndsAt')}
              value={form.ends_at}
              onChange={(e) => setForm({ ...form, ends_at: e.currentTarget.value })}
              rightSection={form.ends_at !== '' && (
                <CloseButton size="sm" onClick={() => setForm({ ...form, ends_at: '' })} />
              )}
            />
          </Group>

          <NumberInput
            label={t('content.fieldHideReadDays')}
            description={t('content.fieldHideReadDaysHint')}
            min={1}
            max={365}
            value={form.hide_read_days}
            onChange={(v) => setForm({ ...form, hide_read_days: typeof v === 'number' ? v : '' })}
          />

          {/* Targeting */}
          <Title order={5}>{t('content.targeting')}</Title>
          <Text size="xs" c="dimmed">{t('content.targetingHint')}</Text>

          <MultiSelect
            label={t('content.fieldCountries')}
            description={t('content.fieldCountriesHint')}
            data={countryOptions}
            value={form.countries}
            onChange={(countries) => setForm({ ...form, countries })}
            searchable
            clearable
          />

          <MultiSelect
            label={t('content.fieldRoles')}
            description={t('content.fieldRolesHint')}
            data={[
              { value: 'patient', label: t('content.rolePatient') },
              { value: 'caregiver', label: t('content.roleCaregiver') },
              { value: 'doctor', label: t('content.roleDoctor') },
            ]}
            value={form.roles}
            onChange={(roles) => setForm({ ...form, roles: roles as ArticleRole[] })}
            clearable
          />

          <Group grow>
            <NumberInput
              label={t('content.fieldPhaseMin')}
              min={0}
              max={600}
              value={form.phase_min}
              onChange={(v) => setForm({ ...form, phase_min: typeof v === 'number' ? v : '' })}
            />
            <NumberInput
              label={t('content.fieldPhaseMax')}
              min={0}
              max={600}
              value={form.phase_max}
              onChange={(v) => setForm({ ...form, phase_max: typeof v === 'number' ? v : '' })}
            />
          </Group>

          <Group grow align="flex-end">
            <Select
              label={t('content.fieldAlsfrsScale')}
              data={[
                { value: '', label: t('content.alsfrsNone') },
                { value: 'total', label: t('content.alsfrsTotal') },
                { value: 'bulbar', label: t('content.alsfrsBulbar') },
                { value: 'fine_motor', label: t('content.alsfrsFineMotor') },
                { value: 'gross_motor', label: t('content.alsfrsGrossMotor') },
                { value: 'respiratory', label: t('content.alsfrsRespiratory') },
              ]}
              value={form.alsfrs_scale}
              onChange={(v) => setForm({ ...form, alsfrs_scale: (v ?? '') as FormState['alsfrs_scale'] })}
            />
            <Select
              label={t('content.fieldAlsfrsOp')}
              data={[
                { value: 'lte', label: t('content.alsfrsOpLte') },
                { value: 'gte', label: t('content.alsfrsOpGte') },
              ]}
              value={form.alsfrs_op}
              disabled={form.alsfrs_scale === ''}
              onChange={(v) => v && setForm({ ...form, alsfrs_op: v as 'lte' | 'gte' })}
            />
            <NumberInput
              label={t('content.fieldAlsfrsValue')}
              min={0}
              max={form.alsfrs_scale === 'total' ? 48 : 12}
              value={form.alsfrs_value}
              disabled={form.alsfrs_scale === ''}
              onChange={(v) => setForm({ ...form, alsfrs_value: typeof v === 'number' ? v : '' })}
            />
          </Group>

          {/* Actions */}
          <Group justify="space-between" mt="md">
            <Group gap="xs">
              {editingId && (
                <Button
                  variant="subtle"
                  color="red"
                  onClick={() => setConfirmDelete(editingArticle ? [editingArticle] : null)}
                  disabled={saving}
                >
                  {t('content.delete')}
                </Button>
              )}
            </Group>
            <Group gap="xs">
              {currentStatus === 'publishing' ? (
                <Text size="sm" c="dimmed">{t('content.publishingHint')}</Text>
              ) : (
              <>
              <Button variant="default" onClick={() => void handleSave()} loading={saving}>
                {t('content.save')}
              </Button>
              {currentStatus !== 'public' ? (
                <Button color="teal" onClick={() => void handleStatus('public')} loading={saving} disabled={!form.title || !form.category_id}>
                  {t('content.publish')}
                </Button>
              ) : (
                <>
                  <Button variant="light" onClick={() => void handleStatus('draft')} loading={saving}>
                    {t('content.unpublish')}
                  </Button>
                  <Button variant="light" color="orange" onClick={() => void handleStatus('archived')} loading={saving}>
                    {t('content.archive')}
                  </Button>
                  <Button color="teal" onClick={() => void handleStatus('public')} loading={saving}>
                    {t('content.republish')}
                  </Button>
                </>
              )}
              </>
              )}
            </Group>
          </Group>
        </Stack>
      </Drawer>

      {/* ─── Delete confirmation ────────────────────────────── */}
      <Modal
        opened={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title={(confirmDelete?.length ?? 0) > 1 ? t('content.deleteTitleMany') : t('content.deleteTitle')}
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            {(confirmDelete?.length ?? 0) > 1
              ? t('content.deleteBodyMany', { count: confirmDelete?.length ?? 0 })
              : t('content.deleteBody', { title: confirmDelete?.[0]?.title ?? '' })}
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => setConfirmDelete(null)}>
              {t('common.cancel')}
            </Button>
            <Button color="red" onClick={() => void handleDelete()}>
              {t('content.delete')}
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* ─── Unsaved changes ────────────────────────────────── */}
      <Modal
        opened={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        title={t('content.discardTitle')}
        centered
      >
        <Stack gap="md">
          <Text size="sm">{t('content.discardBody')}</Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => setConfirmDiscard(false)}>
              {t('content.discardKeepEditing')}
            </Button>
            <Button
              color="red"
              onClick={() => {
                pendingImage.current = undefined;
                setConfirmDiscard(false);
                setEditorOpen(false);
              }}
            >
              {t('content.discardConfirm')}
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* ─── Category management (hca) ──────────────────────── */}
      <Modal
        opened={categoriesOpen}
        onClose={() => setCategoriesOpen(false)}
        title={t('content.categories')}
        size="lg"
        centered
      >
        <Stack gap="lg">
          {categories.length === 0 ? (
            <Text size="sm" c="dimmed">{t('content.categoriesEmpty')}</Text>
          ) : (
            <Table verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('content.categoryLabel')}</Table.Th>
                  <Table.Th>{t('content.categoryId')}</Table.Th>
                  <Table.Th w={90}>{t('content.categoryInUse')}</Table.Th>
                  <Table.Th w={50} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {categories.map((cat) => {
                  const usedBy = articles.filter((a) => a.category_id === cat.id).length;
                  return (
                    <Table.Tr key={cat.id}>
                      <Table.Td>
                        <Group gap="xs">
                          <Text size="sm" fw={500}>{cat.label}</Text>
                          {!cat.active && (
                            <Badge variant="light" color="gray">{t('content.categoryInactive')}</Badge>
                          )}
                        </Group>
                      </Table.Td>
                      <Table.Td><Text size="sm" c="dimmed" ff="monospace">{cat.id}</Text></Table.Td>
                      <Table.Td><Text size="sm" c="dimmed">{usedBy}</Text></Table.Td>
                      <Table.Td>
                        <Tooltip
                          label={usedBy > 0 ? t('content.categoryDeleteBlocked') : t('content.delete')}
                        >
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            disabled={usedBy > 0}
                            onClick={() => {
                              void deleteContentCategory(cat.id)
                                .then(load)
                                .catch((err) => notifications.show({
                                  color: 'red',
                                  title: t('content.categoryDeleteFailed'),
                                  message: String(err),
                                }));
                            }}
                          >
                            <Trash2 size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          )}

          <Divider label={t('content.categoryAddTitle')} labelPosition="left" />

          <Group gap="md" align="flex-start">
            <TextInput
              label={t('content.categoryLabel')}
              placeholder={t('content.categoryLabelPlaceholder')}
              description={t('content.categoryLabelHint')}
              value={newCategory.label}
              onChange={(e) => setNewCategory({ ...newCategory, label: e.currentTarget.value })}
              style={{ flex: 1 }}
            />
            <TextInput
              label={t('content.categoryId')}
              placeholder="news"
              description={t('content.categoryIdHint')}
              value={newCategory.id}
              error={newCategory.id !== '' && !/^[a-z0-9-]{2,40}$/.test(newCategory.id)
                ? t('content.categoryIdInvalid')
                : undefined}
              onChange={(e) => setNewCategory({ ...newCategory, id: e.currentTarget.value })}
              style={{ flex: 1 }}
            />
          </Group>
          <Group justify="flex-end">
            <Button
              color="hca-purple"
              onClick={() => void handleAddCategory()}
              disabled={!newCategory.label.trim() || !/^[a-z0-9-]{2,40}$/.test(newCategory.id)}
            >
              {t('content.categoryAdd')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
