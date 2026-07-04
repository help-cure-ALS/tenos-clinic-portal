import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Stack,
  Text,
  Badge,
  Center,
  ThemeIcon,
  Loader,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { Award, X } from 'lucide-react';
import {
  PageHeader,
  DataGrid,
  BulkActionBar,
  BulkPill,
  SearchInput,
  useGridSort,
  useRowSelection,
  type Column,
} from '@hca/mantine-workbench';

import { useVerificationTokens, useRevokeToken } from '../../hooks/useVerifications';
import type { VerificationTokenResponse } from '../../lib/api';

// Wave UI.9 (2026-05-20) — TokensPage fully on Workbench:
// title/subtitle → PageHeader, DataTable + usePagination → DataGrid
// with useGridSort (client mode, virtualization instead of pagination)
// + useRowSelection, manual selected/revoke bar → BulkActionBar.
// Pattern identical to Moonshot's list pages.

export function TokensPage() {
  const { t } = useTranslation();
  const { data: tokens = [], isLoading } = useVerificationTokens();
  const revokeToken = useRevokeToken();

  // ─── Search + sort + selection ────────────────────────
  const [query, setQuery] = useState('');

  // The filter is applied BEFORE the sort so sortedData always
  // reflects the visible subset. Case-insensitive match on tokenId.
  const filteredTokens = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tokens;
    return tokens.filter((t) => t.tokenId.toLowerCase().includes(q));
  }, [tokens, query]);

  const sort = useGridSort<VerificationTokenResponse>({
    mode: 'client',
    rows: filteredTokens,
    initial: { columnId: 'issued_at', direction: 'desc' },
    getValue: (row, columnId) => {
      switch (columnId) {
        case 'token_id':
          return row.tokenId;
        case 'issued_at':
          return row.issuedAt ? new Date(row.issuedAt) : null;
        case 'status':
          return row.status;
        default:
          return null;
      }
    },
  });

  const selection = useRowSelection();

  // Esc clears the selection so the BulkActionBar can be dismissed
  // without a mouse. Pattern from Moonshot.
  useEffect(() => {
    if (selection.value.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') selection.clear();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection]);

  // Helper: derive the currently selected records — the library only
  // holds IDs, we look up the domain object from tokens.
  const selectedTokens = useMemo(
    () => tokens.filter((t) => selection.value.has(t.tokenId)),
    [tokens, selection.value]
  );
  const validSelected = selectedTokens.filter((r) => r.status === 'valid');

  // ─── Columns ──────────────────────────────────────────
  const columns: Column<VerificationTokenResponse>[] = useMemo(
    () => [
      {
        id: 'token_id',
        header: t('tokens.tokenId'),
        sortable: true,
        // The token ID grows with the remaining space but never drops
        // below this threshold (UUID length in the default font).
        minWidth: 320,
        cell: (r) => <Text fz="sm">{r.tokenId}</Text>,
      },
      {
        id: 'diagnosis',
        header: t('tokens.diagnosis'),
        width: 150,
        cell: (r) =>
          r.diagnosis ? (
            <Text fz="sm">
              {r.diagnosis.code}{' '}
              <Text span c="dimmed" fz="xs">
                {r.diagnosis.display}
              </Text>
            </Text>
          ) : (
            <Text c="dimmed" fz="sm">
              —
            </Text>
          ),
      },
      {
        id: 'issued_at',
        header: t('tokens.issuedAt'),
        sortable: true,
        width: 160,
        cell: (r) =>
          r.issuedAt ? (
            <Text fz="sm">
              {new Date(r.issuedAt).toLocaleDateString()}{' '}
              <Text span c="dimmed" fz="xs">
                {new Date(r.issuedAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
            </Text>
          ) : (
            <Text c="dimmed" fz="sm">
              —
            </Text>
          ),
      },
      {
        id: 'status',
        header: t('common.status'),
        sortable: true,
        width: 140,
        cell: (r) => (
          <Badge
            variant="light"
            color={r.status === 'valid' ? 'green' : 'red'}
          >
            {r.status === 'valid' ? t('common.valid') : t('common.revoked')}
          </Badge>
        ),
      },
    ],
    [t]
  );

  // ─── Handlers ────────────────────────────────────────
  const handleRevoke = () => {
    modals.openConfirmModal({
      title: t('tokens.revoke'),
      children: <Text size="sm">{t('tokens.revokeConfirm')}</Text>,
      labels: { confirm: t('tokens.revoke'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () => {
        validSelected.forEach((r) => revokeToken.mutate(r.tokenId));
        selection.clear();
      },
    });
  };

  // ─── Render ──────────────────────────────────────────
  if (isLoading) {
    return (
      <Center h={300}>
        <Loader color="hca-purple" />
      </Center>
    );
  }

  return (
    <Stack gap="lg" h="100%" style={{ minHeight: 0 }}>
      <PageHeader title={t('tokens.title')} subtitle={t('tokens.subtitle')} />

      {tokens.length === 0 ? (
        <Center style={{ flex: 1, minHeight: 0 }}>
          <Stack align="center" gap="sm" maw={360}>
            <ThemeIcon variant="light" size="xl" color="gray" radius="xl">
              <Award size={24} />
            </ThemeIcon>
            <Text fw={500}>{t('tokens.noTokens')}</Text>
            <Text size="sm" c="dimmed" ta="center">
              {t('tokens.noTokensDesc')}
            </Text>
          </Stack>
        </Center>
      ) : (
        <>
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder={t('tokens.searchPlaceholder')}
            style={{
              maxWidth: 360,
              marginInline: 'var(--mantine-spacing-md)',
            }}
          />

          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <DataGrid<VerificationTokenResponse>
              columns={columns}
              data={sort.sortedData}
              getRowId={(row) => row.tokenId}
              sort={sort.value}
              onSortChange={sort.set}
              selection={selection.value}
              onSelectionChange={selection.set}
            />
          </div>

          {/* BulkActionBar — floats at the bottom, visible when something is selected */}
          {selection.value.size > 0 && (
            <BulkActionBar
              selectedLabel={t('common.selected', {
                count: selection.value.size,
              })}
              onClear={() => selection.clear()}
              clearLabel={t('common.cancel')}
              clearShortcutHint="(Esc)"
            >
              <BulkPill
                variant="text"
                onClick={handleRevoke}
                disabled={validSelected.length === 0}
                tooltip={
                  validSelected.length === 0
                    ? t('tokens.revokeNothingSelectable')
                    : undefined
                }
              >
                <X size={14} />
                {t('tokens.revoke')}
              </BulkPill>
            </BulkActionBar>
          )}
        </>
      )}
    </Stack>
  );
}
