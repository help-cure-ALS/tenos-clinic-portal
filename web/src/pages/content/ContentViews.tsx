/**
 * Cards and board views for the Redaktion page — the same view trio
 * as the evidencespace Claims Explorer (grid | cards | board) with a
 * selectable grouping (status, category, source). The grid stays the
 * workbench DataGrid in ContentPage; these two views render the same
 * filtered/sorted data with the same selection set, so the
 * BulkActionBar keeps working across all views.
 */
import { useEffect, useState } from 'react';
import { Badge, Box, Checkbox, Group, ScrollArea, Stack, Text } from '@mantine/core';
import { Pin } from 'lucide-react';
import { fetchContentArticleImage, type ArticleStatus, type ContentArticle } from '../../lib/contentApi';

export type ContentViewMode = 'grid' | 'cards' | 'board';
export type ContentGroupBy = 'none' | 'status' | 'category' | 'source';

export const STATUS_ORDER: ArticleStatus[] = ['draft', 'publishing', 'public', 'archived'];

export interface ContentGroup {
  key: string;
  label: string;
  count: number;
}

export interface GroupContext {
  groupBy: ContentGroupBy;
  categoryLabel: (id: string) => string;
  statusLabel: (status: ArticleStatus) => string;
  sourceHcaLabel: string;
  sourceClinicFallback: string;
}

export function articleGroupKey(a: ContentArticle, groupBy: ContentGroupBy): string {
  switch (groupBy) {
    case 'status': return a.status;
    case 'category': return a.category_id;
    case 'source': return a.source === 'hca' ? 'hca' : (a.clinic_id ?? 'clinic');
    default: return '';
  }
}

/**
 * Groups for the current grouping. Status shows its fixed workflow
 * order (publishing only when present); category and source list the
 * values that actually occur, ordered by count.
 */
export function buildGroups(articles: ContentArticle[], ctx: GroupContext): ContentGroup[] {
  const { groupBy } = ctx;
  if (groupBy === 'none') return [];
  const counts = new Map<string, number>();
  for (const a of articles) {
    const key = articleGroupKey(a, groupBy);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (groupBy === 'status') {
    return STATUS_ORDER
      .filter((s) => s !== 'publishing' || (counts.get('publishing') ?? 0) > 0)
      .map((s) => ({ key: s, label: ctx.statusLabel(s), count: counts.get(s) ?? 0 }));
  }
  if (groupBy === 'category') {
    return [...counts.entries()]
      .map(([key, count]) => ({ key, label: ctx.categoryLabel(key), count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }
  // source
  const labelFor = (key: string): string => {
    if (key === 'hca') return ctx.sourceHcaLabel;
    const clinic = articles.find((a) => a.clinic_id === key);
    return clinic?.clinic_name ?? ctx.sourceClinicFallback;
  };
  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: labelFor(key), count }))
    .sort((a, b) => (a.key === 'hca' ? -1 : b.key === 'hca' ? 1 : b.count - a.count));
}

// ─── Thumbnails ────────────────────────────────────────────────────
// Object-URL cache for the session — the image route is authed, so
// plain <img src> does not work; fetched lazily per card, once.
const thumbCache = new Map<string, string | null>();
const thumbPending = new Map<string, Promise<string | null>>();

function useArticleThumb(article: ContentArticle): string | null {
  const [url, setUrl] = useState<string | null>(thumbCache.get(article.id) ?? null);
  useEffect(() => {
    if (!article.has_image || thumbCache.has(article.id)) return;
    let alive = true;
    let promise = thumbPending.get(article.id);
    if (!promise) {
      promise = fetchContentArticleImage(article.id)
        .catch(() => null)
        .then((u) => {
          thumbCache.set(article.id, u);
          thumbPending.delete(article.id);
          return u;
        });
      thumbPending.set(article.id, promise);
    }
    void promise.then((u) => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [article.id, article.has_image]);
  return article.has_image ? url : null;
}

// ─── Card tile ─────────────────────────────────────────────────────

const STATUS_COLOR: Record<ArticleStatus, string> = {
  draft: 'gray',
  publishing: 'blue',
  public: 'teal',
  archived: 'orange',
};

interface TileProps {
  article: ContentArticle;
  ctx: GroupContext;
  checked: boolean;
  onToggle: () => void;
  onOpen: () => void;
  /** Board variant: no image, tighter spacing. */
  compact?: boolean;
}

function ArticleTile({ article, ctx, checked, onToggle, onOpen, compact = false }: TileProps) {
  const thumb = useArticleThumb(article);
  return (
    <Box
      onClick={onOpen}
      style={{
        background: 'var(--mantine-color-body)',
        border: checked
          ? '1px solid var(--mantine-color-hca-purple-5)'
          : '1px solid var(--mantine-color-default-border)',
        borderRadius: 8,
        overflow: 'hidden',
        cursor: 'pointer',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {!compact && thumb && (
        <img
          src={thumb}
          alt=""
          style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block' }}
        />
      )}
      <Stack gap={6} p={compact ? 8 : 12} style={{ flex: 1 }}>
        <Group gap={8} wrap="nowrap" align="flex-start">
          <span onClick={(e) => e.stopPropagation()}>
            <Checkbox
              size="xs"
              checked={checked}
              onChange={onToggle}
              aria-label={article.title}
            />
          </span>
          {article.pinned && <Pin size={13} style={{ flexShrink: 0, marginTop: 2, opacity: 0.6 }} />}
          <Text fz="sm" fw={600} lineClamp={2} style={{ flex: 1 }}>
            {article.title}
          </Text>
        </Group>
        {!compact && article.teaser !== '' && (
          <Text fz="xs" c="dimmed" lineClamp={2}>{article.teaser}</Text>
        )}
        <Group gap={6} mt="auto" wrap="wrap">
          <Badge variant="light" size="sm" color={STATUS_COLOR[article.status]}>
            {ctx.statusLabel(article.status)}
          </Badge>
          <Badge variant="light" size="sm" color="blue">
            {ctx.categoryLabel(article.category_id)}
          </Badge>
          {article.source === 'clinic' && article.clinic_name && (
            <Badge variant="light" size="sm" color="gray">{article.clinic_name}</Badge>
          )}
          <Text fz={11} c="dimmed" style={{ marginLeft: 'auto' }}>{article.article_date}</Text>
        </Group>
      </Stack>
    </Box>
  );
}

// ─── Cards view ────────────────────────────────────────────────────

interface ViewProps {
  articles: ContentArticle[];
  groups: ContentGroup[];
  ctx: GroupContext;
  selection: Set<string>;
  onToggle: (id: string) => void;
  onOpen: (article: ContentArticle) => void;
  emptyLabel: string;
}

function CardRaster({ articles, ctx, selection, onToggle, onOpen }: Omit<ViewProps, 'groups' | 'emptyLabel'>) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
        gap: 10,
        gridAutoRows: '1fr',
        alignItems: 'stretch',
      }}
    >
      {articles.map((a) => (
        <ArticleTile
          key={a.id}
          article={a}
          ctx={ctx}
          checked={selection.has(a.id)}
          onToggle={() => onToggle(a.id)}
          onOpen={() => onOpen(a)}
        />
      ))}
    </div>
  );
}

export function ContentCardsView({ articles, groups, ctx, selection, onToggle, onOpen, emptyLabel }: ViewProps) {
  if (articles.length === 0) {
    return <Text ta="center" c="dimmed" p="xl">{emptyLabel}</Text>;
  }
  if (ctx.groupBy === 'none') {
    return (
      <Box p="md">
        <CardRaster articles={articles} ctx={ctx} selection={selection} onToggle={onToggle} onOpen={onOpen} />
      </Box>
    );
  }
  return (
    <Stack gap="lg" p="md">
      {groups.filter((g) => g.count > 0).map((g) => (
        <Stack key={g.key} gap={8}>
          <Group gap={8} align="baseline">
            <Text fw={600} fz="sm">{g.label}</Text>
            <Text fz="xs" c="dimmed" ff="monospace">{g.count}</Text>
          </Group>
          <CardRaster
            articles={articles.filter((a) => articleGroupKey(a, ctx.groupBy) === g.key)}
            ctx={ctx}
            selection={selection}
            onToggle={onToggle}
            onOpen={onOpen}
          />
        </Stack>
      ))}
    </Stack>
  );
}

// ─── Board view ────────────────────────────────────────────────────

export function ContentBoardView({ articles, groups, ctx, selection, onToggle, onOpen, emptyLabel }: ViewProps) {
  if (articles.length === 0) {
    return <Text ta="center" c="dimmed" p="xl">{emptyLabel}</Text>;
  }
  return (
    <ScrollArea type="auto" style={{ height: '100%' }}>
      <div
        style={{
          display: 'grid',
          gridAutoFlow: 'column',
          gridAutoColumns: '300px',
          gap: 12,
          padding: 16,
        }}
      >
        {groups.map((g) => (
          <Stack
            key={g.key}
            gap={8}
            style={{
              background: 'var(--mantine-color-default-hover)',
              borderRadius: 8,
              padding: 10,
              minHeight: 160,
              alignSelf: 'start',
            }}
          >
            <Group gap={8} align="baseline">
              <Text fw={600} fz={13}>{g.label}</Text>
              <Text fz={12} c="dimmed" ff="monospace">{g.count}</Text>
            </Group>
            {articles
              .filter((a) => articleGroupKey(a, ctx.groupBy) === g.key)
              .map((a) => (
                <ArticleTile
                  key={a.id}
                  article={a}
                  ctx={ctx}
                  checked={selection.has(a.id)}
                  onToggle={() => onToggle(a.id)}
                  onOpen={() => onOpen(a)}
                  compact
                />
              ))}
          </Stack>
        ))}
      </div>
    </ScrollArea>
  );
}
