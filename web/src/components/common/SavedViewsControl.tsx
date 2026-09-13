/**
 * Saved-views control for the grid toolbars — the portal variant of
 * the evidencespace SavedViewsSection, condensed into a Menu button.
 *
 * Shows the current view name (or "Standard" / the unsaved marker),
 * lists the saved views of the page's scope, and offers save /
 * update / rename / default / delete. All state handling lives in
 * useViewState; this component is pure UI.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActionIcon,
  Button,
  Checkbox,
  Group,
  Menu,
  Modal,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { Bookmark, Check, Pencil, Star, Trash2 } from 'lucide-react';
import type { SavedView } from '../../lib/viewsApi';
import type { UseViewStateResult } from '../../hooks/useViewState';

export function SavedViewsControl({ vs }: { vs: UseViewStateResult }) {
  const { t } = useTranslation();
  const { state, savedViews } = vs;

  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveDefault, setSaveDefault] = useState(false);
  const [renameTarget, setRenameTarget] = useState<SavedView | null>(null);
  const [renameName, setRenameName] = useState('');

  const label = state.matchedSavedView?.name
    ?? (state.isVirtual ? t('views.unsaved') : t('views.default'));

  const fail = (err: unknown) =>
    notifications.show({ color: 'red', title: t('views.error'), message: String(err) });

  return (
    <>
      <Menu position="bottom-end" width={280} closeOnItemClick={false}>
        <Menu.Target>
          <Button
            variant="default"
            size="sm"
            leftSection={<Bookmark size={15} />}
          >
            <Group gap={6} wrap="nowrap">
              <Text fz="sm" fw={500} truncate style={{ maxWidth: 160 }}>{label}</Text>
              {state.isVirtual && (
                <span
                  aria-label={t('views.unsaved')}
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    background: 'var(--mantine-color-hca-purple-5)',
                    flexShrink: 0,
                  }}
                />
              )}
            </Group>
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>{t('views.title')}</Menu.Label>
          {savedViews.length === 0 && (
            <Text fz="xs" c="dimmed" px="sm" py={4}>{t('views.none')}</Text>
          )}
          {savedViews.map((view) => (
            <Menu.Item
              key={view.id}
              onClick={() => vs.applyView(view)}
              leftSection={view.id === state.viewId
                ? <Check size={14} />
                : <span style={{ width: 14 }} />}
              rightSection={
                <Group gap={2} wrap="nowrap" onClick={(e) => e.stopPropagation()}>
                  <Tooltip label={t('views.setDefault')}>
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      color={view.is_default ? 'yellow' : 'gray'}
                      onClick={() => void vs.setDefaultView(view).catch(fail)}
                    >
                      <Star size={13} fill={view.is_default ? 'currentColor' : 'none'} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label={t('views.rename')}>
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      onClick={() => { setRenameTarget(view); setRenameName(view.name); }}
                    >
                      <Pencil size={13} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label={t('views.delete')}>
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      color="red"
                      onClick={() => void vs.deleteView(view).catch(fail)}
                    >
                      <Trash2 size={13} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              }
            >
              <Text fz="sm" truncate style={{ maxWidth: 120 }}>{view.name}</Text>
            </Menu.Item>
          ))}
          {state.isVirtual && (
            <>
              <Menu.Divider />
              {state.parentSavedView && (
                <Menu.Item
                  onClick={() => void vs.updateCurrentView().catch(fail)}
                  closeMenuOnClick
                >
                  {t('views.updateParent', { name: state.parentSavedView.name })}
                </Menu.Item>
              )}
              <Menu.Item
                onClick={() => { setSaveName(''); setSaveDefault(false); setSaveOpen(true); }}
                closeMenuOnClick
              >
                {t('views.saveCurrent')}
              </Menu.Item>
            </>
          )}
        </Menu.Dropdown>
      </Menu>

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
    </>
  );
}
