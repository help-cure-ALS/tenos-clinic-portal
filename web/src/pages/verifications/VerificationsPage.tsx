import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Stack,
  Text,
  Badge,
  Select,
  Center,
  ThemeIcon,
  Loader,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { Check, ShieldCheck, X } from 'lucide-react';
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

import {
  useVerifications,
  useApproveVerification,
  useRejectVerification,
} from '../../hooks/useVerifications';
import type { PendingRequest } from '../../lib/api';

// Wave UI.12 (2026-05-20) — VerificationsPage on Workbench.
// Pattern identical to TokensPage/UsersPage/ClinicStudiesPage.

const ALS_DIAGNOSIS_CODES = [
  {
    value: 'http://hl7.org/fhir/sid/icd-10|G12.2',
    label: 'G12.2 — Motor neuron disease (ICD-10)',
    system: 'http://hl7.org/fhir/sid/icd-10',
    code: 'G12.2',
    display: 'Motor neuron disease (ICD-10)',
  },
  {
    value: 'http://fhir.de/CodeSystem/bfarm/icd-10-gm|G12.2',
    label: 'G12.2 — ALS (ICD-10-GM, DE)',
    system: 'http://fhir.de/CodeSystem/bfarm/icd-10-gm',
    code: 'G12.2',
    display: 'ALS (ICD-10-GM, DE)',
  },
  {
    value: 'http://hl7.org/fhir/sid/icd-10-cm|G12.21',
    label: 'G12.21 — ALS (ICD-10-CM, US)',
    system: 'http://hl7.org/fhir/sid/icd-10-cm',
    code: 'G12.21',
    display: 'Amyotrophic lateral sclerosis (ICD-10-CM, US)',
  },
];

export function VerificationsPage() {
  const { t } = useTranslation();
  const { data: requests = [], isLoading } = useVerifications();
  const approveVerification = useApproveVerification();
  const rejectVerification = useRejectVerification();
  const [selectedDiagnosis, setSelectedDiagnosis] = useState(
    ALS_DIAGNOSIS_CODES[0].value
  );

  // ─── Search + Sort + Selection ─────────────────────────
  const [query, setQuery] = useState('');

  const filteredRequests = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return requests;
    return requests.filter((r) => r.code.toLowerCase().includes(q));
  }, [requests, query]);

  const sort = useGridSort<PendingRequest>({
    mode: 'client',
    rows: filteredRequests,
    initial: { sortBy: 'created_at', sortDir: 'desc' },
    getValue: (row, columnId) => {
      switch (columnId) {
        case 'code':
          return row.code;
        case 'created_at':
          return row.created_at ? new Date(row.created_at) : null;
        case 'expires_at':
          return row.expires_at ? new Date(row.expires_at) : null;
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

  const selectedRequests = useMemo(
    () => requests.filter((r) => selection.value.has(r.id)),
    [requests, selection.value]
  );

  // ─── Columns ──────────────────────────────────────────
  const columns: Column<PendingRequest>[] = useMemo(
    () => [
      {
        id: 'code',
        header: t('verifications.code'),
        sortable: true,
        minWidth: 160,
        cell: (r) => (
          <Text ff="monospace" fw={600} c="hca-purple">
            {r.code}
          </Text>
        ),
      },
      {
        id: 'request_id',
        header: t('verifications.requestId'),
        width: 180,
        cell: (r) => <Text fz="sm">{r.id}</Text>,
      },
      {
        id: 'created_at',
        header: t('verifications.requestedAt'),
        sortable: true,
        width: 180,
        cell: (r) => (
          <Text fz="sm">
            {new Date(r.created_at).toLocaleDateString()}{' '}
            <Text span c="dimmed" fz="xs">
              {new Date(r.created_at).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Text>
          </Text>
        ),
      },
      {
        id: 'expires_at',
        header: t('verifications.expiresAt'),
        sortable: true,
        width: 180,
        cell: (r) => (
          <Text fz="sm">
            {new Date(r.expires_at).toLocaleDateString()}{' '}
            <Text span c="dimmed" fz="xs">
              {new Date(r.expires_at).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Text>
          </Text>
        ),
      },
      {
        id: 'status',
        header: t('common.status'),
        width: 140,
        cell: () => (
          <Badge variant="light" color="orange">
            {t('common.pending')}
          </Badge>
        ),
      },
    ],
    [t]
  );

  // ─── Handlers ────────────────────────────────────────
  const openApproveModal = () => {
    const codes = selectedRequests.map((r) => r.code).join(', ');
    modals.openConfirmModal({
      title: t('verifications.approve'),
      children: (
        <Stack gap="sm">
          <Text size="sm">
            {t('verifications.approveConfirm', { code: codes })}
          </Text>
          <Select
            label={t('verifications.diagnosisCode')}
            data={ALS_DIAGNOSIS_CODES}
            value={selectedDiagnosis}
            onChange={(v) => v && setSelectedDiagnosis(v)}
          />
        </Stack>
      ),
      labels: {
        confirm: t('verifications.approve'),
        cancel: t('common.cancel'),
      },
      confirmProps: { color: 'green' },
      onConfirm: () => {
        const diag = ALS_DIAGNOSIS_CODES.find(
          (d) => d.value === selectedDiagnosis
        )!;
        selectedRequests.forEach((r) =>
          approveVerification.mutate({
            code: r.code,
            diagnosis: {
              system: diag.system,
              code: diag.code,
              display: diag.display,
            },
          })
        );
        selection.clear();
      },
    });
  };

  const openRejectModal = () => {
    const codes = selectedRequests.map((r) => r.code).join(', ');
    modals.openConfirmModal({
      title: t('verifications.reject'),
      children: (
        <Text size="sm">
          {t('verifications.rejectConfirm', { code: codes })}
        </Text>
      ),
      labels: {
        confirm: t('verifications.reject'),
        cancel: t('common.cancel'),
      },
      confirmProps: { color: 'red' },
      onConfirm: () => {
        selectedRequests.forEach((r) => rejectVerification.mutate(r.code));
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
      <PageHeader
        title={t('verifications.title')}
        subtitle={t('verifications.subtitle')}
      />

      {requests.length === 0 ? (
        <Center style={{ flex: 1, minHeight: 0 }}>
          <Stack align="center" gap="sm" maw={360}>
            <ThemeIcon variant="light" size="xl" color="gray" radius="xl">
              <ShieldCheck size={24} />
            </ThemeIcon>
            <Text fw={500}>{t('verifications.noPending')}</Text>
            <Text size="sm" c="dimmed" ta="center">
              {t('verifications.noPendingDesc')}
            </Text>
          </Stack>
        </Center>
      ) : (
        <>
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder={t('verifications.searchPlaceholder')}
            style={{
              maxWidth: 360,
              marginInline: 'var(--mantine-spacing-md)',
            }}
          />

          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <DataGrid<PendingRequest>
              columns={columns}
              data={sort.sortedData}
              getRowId={(row) => row.id}
              sort={sort.value}
              onSortChange={sort.set}
              selection={selection.value}
              onSelectionChange={selection.set}
            />
          </div>

          {selection.value.size > 0 && (
            <BulkActionBar
              selectedLabel={t('common.selected', {
                count: selection.value.size,
              })}
              onClear={() => selection.clear()}
              clearLabel={t('common.cancel')}
              clearShortcutHint="(Esc)"
            >
              <BulkPill variant="text" onClick={openApproveModal}>
                <Check size={14} />
                {t('verifications.approve')}
              </BulkPill>
              <BulkPill variant="text" onClick={openRejectModal}>
                <X size={14} />
                {t('verifications.reject')}
              </BulkPill>
            </BulkActionBar>
          )}
        </>
      )}
    </Stack>
  );
}
