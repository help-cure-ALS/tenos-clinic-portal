import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Stack,
  Text,
  Badge,
  Switch,
  Loader,
  Center,
  Button,
  Group,
  Modal,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { Pencil, Trash2, UserPlus } from 'lucide-react';
import {
  DataGrid,
  BulkActionBar,
  BulkPill,
  useGridSort,
  useRowSelection,
  type Column,
} from '@hca/mantine-workbench';

import {
  useClinicUsers,
  useUpdateUserPermissions,
  useUpdateUserName,
  useDeleteUser,
} from '../../hooks/useClinicUsers';
import { useAuthStore } from '../../stores/auth';
import { InviteDialog } from '../common/InviteDialog';
import type { ClinicUser } from '../../lib/api';

// Wave UI.24 (2026-05-20) — ClinicUsersTab on Workbench. Pattern
// like UsersPage (tab variant without PageHeader). Bulk pills for
// Edit (only with exactly 1 selected user) + Delete. Invite button
// stays as a toolbar top right.

interface Props {
  clinicId: string;
}

export function ClinicUsersTab({ clinicId }: Props) {
  const { t } = useTranslation();
  const userRole = useAuthStore((s) => s.userRole);
  const { data: users = [], isLoading } = useClinicUsers(clinicId);
  const updatePermissions = useUpdateUserPermissions();
  const updateName = useUpdateUserName();
  const deleteUserMutation = useDeleteUser();
  const [inviteOpened, { open: openInvite, close: closeInvite }] =
    useDisclosure(false);

  const [editUser, setEditUser] = useState<ClinicUser | null>(null);
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');

  // ─── Sort + Selection ─────────────────────────────────
  const sort = useGridSort<ClinicUser>({
    mode: 'client',
    rows: users,
    initial: { sortBy: 'last_name', sortDir: 'asc' },
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

  useEffect(() => {
    if (selection.value.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') selection.clear();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection]);

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
        minWidth: 220,
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
        width: 260,
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
  const openEditName = () => {
    const user = selectedUsers[0];
    if (!user) return;
    setEditUser(user);
    setEditFirstName(user.firstName);
    setEditLastName(user.lastName);
  };

  const handleSaveName = () => {
    if (!editUser) return;
    updateName.mutate(
      {
        userId: editUser.practitionerId,
        firstName: editFirstName,
        lastName: editLastName,
      },
      {
        onSuccess: () => {
          setEditUser(null);
          selection.clear();
        },
      }
    );
  };

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
      labels: {
        confirm: t('common.delete'),
        cancel: t('common.cancel'),
      },
      confirmProps: { color: 'red' },
      onConfirm: () => {
        selectedUsers.forEach((u) =>
          deleteUserMutation.mutate(u.practitionerRoleId)
        );
        selection.clear();
      },
    });
  };

  if (isLoading) {
    return (
      <Center h={200}>
        <Loader color="hca-purple" />
      </Center>
    );
  }

  return (
    <Stack gap="md">
      <Group justify="flex-end">
        {(() => {
          // Backend (`/admin/invitations`) only allows hca-admin or
          // clinic-admin. Disabled for other roles, tooltip explains.
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
        })()}
      </Group>

      <DataGrid<ClinicUser>
        columns={columns}
        data={sort.sortedData}
        getRowId={(row) => row.practitionerId}
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
            onClick={openEditName}
            disabled={selection.value.size !== 1}
            tooltip={
              selection.value.size !== 1
                ? t('users.editNameOnlyOne')
                : undefined
            }
          >
            <Pencil size={14} />
            {t('common.edit')}
          </BulkPill>
          <BulkPill variant="text" onClick={handleDelete}>
            <Trash2 size={14} />
            {t('common.delete')}
          </BulkPill>
        </BulkActionBar>
      )}

      <InviteDialog
        opened={inviteOpened}
        onClose={closeInvite}
        clinicId={clinicId}
      />

      <Modal
        opened={!!editUser}
        onClose={() => setEditUser(null)}
        title={t('users.editName')}
      >
        <Stack gap="md">
          <TextInput
            label={t('invitations.firstName')}
            value={editFirstName}
            onChange={(e) => setEditFirstName(e.currentTarget.value)}
            required
          />
          <TextInput
            label={t('invitations.lastName')}
            value={editLastName}
            onChange={(e) => setEditLastName(e.currentTarget.value)}
            required
          />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => setEditUser(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              color="teal"
              onClick={handleSaveName}
              loading={updateName.isPending}
              disabled={!editFirstName.trim() || !editLastName.trim()}
            >
              {t('common.save')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
