import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Stack,
  Text,
  Badge,
  Loader,
  Center,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { X } from 'lucide-react';
import {
  DataGrid,
  BulkActionBar,
  BulkPill,
  useGridSort,
  useRowSelection,
  type Column,
} from '@hca/mantine-workbench';

import {
  useVerificationTokens,
  useRevokeToken,
} from '../../hooks/useVerifications';
import type { VerificationTokenResponse } from '../../lib/api';

// Wave UI.24 (2026-05-20) — ClinicDevicesTab on Workbench, same
// pattern as TokensPage (smaller variant without SearchInput and
// PageHeader, since the tab lives inside ClinicDetailPage).

interface Props {
  clinicId: string;
}

export function ClinicDevicesTab({ clinicId }: Props) {
  const { t } = useTranslation();
  const { data: allTokens = [], isLoading } = useVerificationTokens();
  const revokeToken = useRevokeToken();

  const tokens = useMemo(
    () => allTokens.filter((tk) => tk.clinicId === clinicId),
    [allTokens, clinicId]
  );

  const sort = useGridSort<VerificationTokenResponse>({
    mode: 'client',
    rows: tokens,
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

  useEffect(() => {
    if (selection.value.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') selection.clear();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection]);

  const selectedTokens = useMemo(
    () => tokens.filter((t) => selection.value.has(t.tokenId)),
    [tokens, selection.value]
  );
  const validSelected = selectedTokens.filter((r) => r.status === 'valid');

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

  const columns: Column<VerificationTokenResponse>[] = useMemo(
    () => [
      {
        id: 'token_id',
        header: t('tokens.tokenId'),
        sortable: true,
        minWidth: 320,
        cell: (r) => <Text fz="sm">{r.tokenId}</Text>,
      },
      {
        id: 'issued_at',
        header: t('tokens.issuedAt'),
        sortable: true,
        width: 160,
        cell: (r) => (
          <Text fz="sm">
            {r.issuedAt ? new Date(r.issuedAt).toLocaleDateString() : '—'}
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

  if (isLoading) {
    return (
      <Center h={200}>
        <Loader color="hca-purple" />
      </Center>
    );
  }

  return (
    <Stack gap="md">
      <DataGrid<VerificationTokenResponse>
        columns={columns}
        data={sort.sortedData}
        getRowId={(row) => row.tokenId}
        sort={sort.value}
        onSortChange={sort.set}
        selection={selection.value}
        onSelectionChange={selection.set}
      />

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
    </Stack>
  );
}
