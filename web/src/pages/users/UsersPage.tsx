import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Stack,
  Text,
  Badge,
  Switch,
  Loader,
  Center,
  ThemeIcon,
  Button,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { Trash2, UserPlus } from 'lucide-react';
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

import { useAuthStore } from '../../stores/auth';
import {
  useClinicUsers,
  useUpdateUserPermissions,
  useDeleteUser,
} from '../../hooks/useClinicUsers';
import { InviteDialog } from '../../components/common/InviteDialog';
import { UserDetailDrawer } from '../../components/common/UserDetailDrawer';
import type { ClinicUser } from '../../lib/api';

// Wave UI.10 (2026-05-20) — UsersPage on Workbench, pattern
// identical to TokensPage: PageHeader + SearchInput + DataGrid +
// BulkActionBar.

export function UsersPage() {
  const { t } = useTranslation();
  const { organization, userRole } = useAuthStore();
  const clinicId = organization?.id;
  const { data: users = [], isLoading } = useClinicUsers(clinicId || '');
  const updatePermissions = useUpdateUserPermissions();
  const deleteUserMutation = useDeleteUser();
  const [inviteOpened, { open: openInvite, close: closeInvite }] =
    useDisclosure(false);
  const [detailUser, setDetailUser] = useState<ClinicUser | null>(null);

  // ─── Search + Sort + Selection ─────────────────────────
  const [query, setQuery] = useState('');

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      const fullName = `${u.firstName} ${u.lastName}`.toLowerCase();
      const email = u.email?.toLowerCase() ?? '';
      return fullName.includes(q) || email.includes(q);
    });
  }, [users, query]);

  const sort = useGridSort<ClinicUser>({
    mode: 'client',
    rows: filteredUsers,
    initial: { columnId: 'last_name', direction: 'asc' },
    getValue: (row, columnId) => {
      switch (columnId) {
        case 'last_name':
          return `${row.lastName ?? ''} ${row.firstName ?? ''}`;
        case 'email':
          return row.email ?? '';
        case 'role':
          return row.clinicRole ?? '';
        case 'can_verify':
          return row.canVerify ? 1 : 0;
        default:
          return null;
      }
    },
  });

  const selection = useRowSelection();

  // Esc clears the selection.
  useEffect(() => {
    if (selection.value.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') selection.clear();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection]);

  // useRowSelection holds IDs (practitionerId). Derive domain objects
  // from them — the delete mutation needs practitionerRoleId.
  const selectedUsers = useMemo(
    () => users.filter((u) => selection.value.has(u.practitionerId)),
    [users, selection.value]
  );

  // ─── Columns ──────────────────────────────────────────
  const columns: Column<ClinicUser>[] = useMemo(
    () => [
      {
        id: 'last_name',
        header: t('users.name'),
        sortable: true,
        minWidth: 240,
        cell: (u) => (
          <Text fz="sm">
            {u.firstName} {u.lastName}
          </Text>
        ),
      },
      {
        id: 'email',
        header: t('auth.email'),
        sortable: true,
        width: 280,
        cell: (u) => (
          <Text fz="sm" c="dimmed">
            {u.email}
          </Text>
        ),
      },
      {
        id: 'role',
        header: t('users.role'),
        sortable: true,
        width: 140,
        cell: (u) => (
          <Badge
            variant="light"
            color={u.clinicRole === 'admin' ? 'hca-purple' : 'gray'}
          >
            {u.clinicRole || t('users.member')}
          </Badge>
        ),
      },
      {
        id: 'can_verify',
        header: t('users.canVerify'),
        sortable: true,
        width: 160,
        cell: (u) => (
          <div onClick={(e) => e.stopPropagation()}>
            <Switch
              checked={u.canVerify}
              onChange={(e) =>
                updatePermissions.mutate({
                  userId: u.practitionerRoleId,
                  permissions: { canVerify: e.currentTarget.checked },
                })
              }
              size="sm"
            />
          </div>
        ),
      },
    ],
    [t, updatePermissions]
  );

  // ─── Handlers ────────────────────────────────────────
  const handleDelete = () => {
    const names = selectedUsers
      .map((u) => `${u.firstName} ${u.lastName}`)
      .join(', ');
    modals.openConfirmModal({
      title: t('users.deleteConfirmTitle'),
      children: (
        <Text size="sm">
          {t('users.deleteConfirmText', { name: names })}
        </Text>
      ),
      labels: { confirm: t('common.delete'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () => {
        selectedUsers.forEach((u) =>
          deleteUserMutation.mutate(u.practitionerRoleId)
        );
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
        title={t('users.title')}
        subtitle={t('users.subtitle')}
        actions={
          (() => {
            // Backend (`/admin/invitations`) only allows hca-admin or
            // clinic-admin. Disabled for member/verifier — the tooltip
            // explains why. Mantine Tooltip needs a <span> wrapper
            // around disabled buttons so hover events get through.
            const canInvite =
              userRole === 'hca-admin' || userRole === 'clinic-admin';
            const button = (
              <Button
                leftSection={<UserPlus size={16} />}
                color="hca-purple"
                onClick={openInvite}
                disabled={!canInvite}
              >
                {t('users.invite')}
              </Button>
            );
            return canInvite ? (
              button
            ) : (
              <Tooltip label={t('invitations.noPermissionTooltip')} withArrow>
                <span>{button}</span>
              </Tooltip>
            );
          })()
        }
      />

      {users.length === 0 ? (
        <Center style={{ flex: 1, minHeight: 0 }}>
          <Stack align="center" gap="sm" maw={360}>
            <ThemeIcon variant="light" size="xl" color="gray" radius="xl">
              <UserPlus size={24} />
            </ThemeIcon>
            <Text fw={500}>{t('users.noUsers')}</Text>
            <Text size="sm" c="dimmed" ta="center">
              {t('users.noUsersDesc')}
            </Text>
          </Stack>
        </Center>
      ) : (
        <>
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder={t('users.searchPlaceholder')}
            style={{
              maxWidth: 360,
              marginInline: 'var(--mantine-spacing-md)',
            }}
          />

          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <DataGrid<ClinicUser>
              columns={columns}
              data={sort.sortedData}
              getRowId={(row) => row.practitionerId}
              sort={sort.value}
              onSortChange={sort.set}
              selection={selection.value}
              onSelectionChange={selection.set}
              onRowClick={(row) => setDetailUser(row)}
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
              <BulkPill variant="text" onClick={handleDelete}>
                <Trash2 size={14} />
                {t('common.delete')}
              </BulkPill>
            </BulkActionBar>
          )}
        </>
      )}

      {clinicId && (
        <InviteDialog
          opened={inviteOpened}
          onClose={closeInvite}
          clinicId={clinicId}
        />
      )}

      <UserDetailDrawer
        user={detailUser}
        opened={!!detailUser}
        onClose={() => setDetailUser(null)}
      />
    </Stack>
  );
}
