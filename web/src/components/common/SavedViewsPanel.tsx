/**
 * Saved-views section for the FilterPanel `topSlot` — the portal port
 * of the evidencespace SavedViewsSection. Rows apply on click, the
 * kebab menu carries update/rename/default/delete, and an unsaved
 * (virtual) view surfaces the "Aktuelle Sicht speichern" entry plus
 * the plus icon in the header.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActionIcon,
  Box,
  Button,
  Checkbox,
  Group,
  Menu,
  Modal,
  Stack,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  BookmarkCheck,
  FileText,
  MoreVertical,
  Pencil,
  Plus,
  RotateCcw,
  Star,
  StarOff,
  Trash2,
} from 'lucide-react';
import type { SavedView } from '../../lib/viewsApi';
import type { UseViewStateResult } from '../../hooks/useViewState';

export function SavedViewsPanel({ vs }: { vs: UseViewStateResult }) {
  const { t } = useTranslation();
  const { state, savedViews } = vs;

  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveDefault, setSaveDefault] = useState(false);
  const [renameTarget, setRenameTarget] = useState<SavedView | null>(null);
  const [renameName, setRenameName] = useState('');

  const fail = (err: unknown) =>
    notifications.show({ color: 'red', title: t('views.error'), message: String(err) });

  return (
    <Box mb={10}>
      <Group gap={4} mb={3} align="center" justify="space-between" wrap="nowrap">
        <Text fz={11} fw={600} c="dimmed" tt="uppercase">
          {t('views.sectionTitle')}
        </Text>
        {state.isVirtual && (
          <Tooltip label={t('views.saveCurrent')}>
            <ActionIcon
              size="xs"
              variant="subtle"
              onClick={() => { setSaveName(''); setSaveDefault(false); setSaveOpen(true); }}
              aria-label={t('views.saveCurrent')}
            >
              <Plus size={12} />
            </ActionIcon>
          </Tooltip>
        )}
      </Group>

      <Stack gap={2}>
        {savedViews.length === 0 && !state.isVirtual && (
          <Text fz="sm" c="dimmed">{t('views.none')}</Text>
        )}
        {savedViews.map((view) => {
          const active = view.id === state.viewId;
          return (
            <Group key={view.id} gap={4} wrap="nowrap" style={{ padding: '2px 5px', borderRadius: 4 }}>
              <UnstyledButton
                onClick={() => vs.applyView(view)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <FileText size={18} style={{ opacity: 0.6, flexShrink: 0 }} />
                {view.is_default && <BookmarkCheck size={11} />}
                <Text fz={13} fw={active ? 600 : 400} truncate style={{ flex: 1, minWidth: 0 }}>
                  {view.name}
                </Text>
              </UnstyledButton>
              <Menu position="bottom-end" withinPortal>
                <Menu.Target>
                  <ActionIcon size="xs" variant="subtle" aria-label={t('views.title')}>
                    <MoreVertical size={12} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item
                    leftSection={<RotateCcw size={12} />}
                    onClick={() => void vs.updateCurrentView(view.id).catch(fail)}
                  >
                    {t('views.updateWithCurrent')}
                  </Menu.Item>
                  <Menu.Item
                    leftSection={<Pencil size={12} />}
                    onClick={() => { setRenameTarget(view); setRenameName(view.name); }}
                  >
                    {t('views.rename')}
                  </Menu.Item>
                  <Menu.Divider />
                  <Menu.Item
                    leftSection={view.is_default ? <StarOff size={12} /> : <Star size={12} />}
                    onClick={() => void vs.setDefaultView(view).catch(fail)}
                  >
                    {view.is_default ? t('views.removeDefault') : t('views.setDefault')}
                  </Menu.Item>
                  <Menu.Divider />
                  <Menu.Item
                    color="red"
                    leftSection={<Trash2 size={12} />}
                    onClick={() => void vs.deleteView(view).catch(fail)}
                  >
                    {t('views.delete')}
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </Group>
          );
        })}
        {state.isVirtual && (
          <UnstyledButton
            onClick={() => { setSaveName(''); setSaveDefault(false); setSaveOpen(true); }}
            style={{
              padding: '2px 5px',
              borderRadius: 4,
              fontSize: 13,
              color: 'var(--mantine-color-hca-purple-6)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <FileText size={18} style={{ opacity: 0.6, flexShrink: 0 }} />
            {t('views.saveCurrent')}
          </UnstyledButton>
        )}
      </Stack>

      {/* Save dialog */}
      <Modal
        opened={saveOpen}
        onClose={() => setSaveOpen(false)}
        title={t('views.saveTitle')}
        size="sm"
      >
        <Stack gap="sm">
          <TextInput
            label={t('views.nameLabel')}
            value={saveName}
            onChange={(e) => setSaveName(e.currentTarget.value)}
            data-autofocus
          />
          <Checkbox
            label={t('views.defaultLabel')}
            checked={saveDefault}
            onChange={(e) => setSaveDefault(e.currentTarget.checked)}
          />
          {state.parentSavedView && (
            <Button
              variant="light"
              onClick={() => {
                void vs.updateCurrentView()
                  .then(() => setSaveOpen(false))
                  .catch(fail);
              }}
            >
              {t('views.updateParent', { name: state.parentSavedView.name })}
            </Button>
          )}
          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => setSaveOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              color="hca-purple"
              disabled={saveName.trim() === ''}
              onClick={() => {
                void vs.saveCurrentView(saveName.trim(), { is_default: saveDefault })
                  .then(() => setSaveOpen(false))
                  .catch(fail);
              }}
            >
              {t('common.save')}
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Rename dialog */}
      <Modal
        opened={renameTarget !== null}
        onClose={() => setRenameTarget(null)}
        title={t('views.renameTitle')}
        size="sm"
      >
        <Stack gap="sm">
          <TextInput
            value={renameName}
            onChange={(e) => setRenameName(e.currentTarget.value)}
            data-autofocus
          />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => setRenameTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              color="hca-purple"
              disabled={renameName.trim() === ''}
              onClick={() => {
                if (!renameTarget) return;
                void vs.renameView(renameTarget, renameName.trim())
                  .then(() => setRenameTarget(null))
                  .catch(fail);
              }}
            >
              {t('common.save')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Box>
  );
}
