import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Center,
  Checkbox,
  Divider,
  Group,
  Loader,
  MultiSelect,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';

import type { AidStatus, WorkflowPolicy, WorkflowRole } from '../../lib/supplierApi';
import {
  useSupplierWorkflowPolicy,
  useSupplierWorkflowPolicyList,
  useUpsertSupplierWorkflowPolicy,
} from '../../hooks/useSupplierPolicies';
import { AlertTriangle, Plus, RefreshCw, Trash2 } from 'lucide-react';

const STATUS_OPTIONS: AidStatus[] = ['none', 'suggested', 'requested', 'approved', 'rejected'];
const ROLE_OPTIONS: WorkflowRole[] = ['patient', 'caregiver', 'doctor'];

const STATUS_SELECT_DATA = STATUS_OPTIONS.map((status) => ({ value: status, label: status }));
const ROLE_LABELS: Record<WorkflowRole, string> = {
  patient: 'Patient',
  caregiver: 'Caregiver',
  doctor: 'Doctor',
};

function createEmptyPolicy(country: string): WorkflowPolicy {
  return {
    country,
    transitions: [],
    notify_provider_on: [],
  };
}

function normalizeCountry(value: string): string {
  return value.trim().toUpperCase();
}

type Props = {
  defaultCountry?: string;
};

export function SupplierWorkflowPolicyTab({ defaultCountry }: Props) {
  const { t } = useTranslation();
  const initialCountry = normalizeCountry(defaultCountry || 'DE');
  const [countryInput, setCountryInput] = useState(initialCountry);
  const [country, setCountry] = useState(initialCountry);
  const [draft, setDraft] = useState<WorkflowPolicy | null>(null);
  const [dirty, setDirty] = useState(false);

  const policyQuery = useSupplierWorkflowPolicy(country);
  const policyListQuery = useSupplierWorkflowPolicyList();
  const upsert = useUpsertSupplierWorkflowPolicy();

  const knownCountries = useMemo(() => {
    const set = new Set<string>(policyListQuery.data?.map((p) => p.country) ?? []);
    if (country) set.add(country);
    if (initialCountry) set.add(initialCountry);
    return Array.from(set).sort();
  }, [policyListQuery.data, country, initialCountry]);

  useEffect(() => {
    if (policyQuery.isLoading) return;
    const next = policyQuery.data ?? createEmptyPolicy(country);
    setDraft({
      ...next,
      country,
      transitions: next.transitions.map((transition) => ({
        ...transition,
        allowed_roles: [...transition.allowed_roles],
      })),
      notify_provider_on: [...next.notify_provider_on],
    });
    setDirty(false);
  }, [country, policyQuery.data, policyQuery.isLoading]);

  const saveDisabled = !draft || upsert.isPending || draft.transitions.some((transition) => transition.allowed_roles.length === 0);

  const handleLoadCountry = () => {
    const normalized = normalizeCountry(countryInput);
    if (normalized.length < 2 || normalized.length > 3) {
      notifications.show({
        title: t('common.error'),
        message: t('suppliers.workflowInvalidCountry'),
        color: 'red',
      });
      return;
    }
    setCountry(normalized);
  };

  const setTransitionField = (index: number, patch: Partial<WorkflowPolicy['transitions'][number]>) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const transitions = [...prev.transitions];
      transitions[index] = { ...transitions[index], ...patch };
      return { ...prev, transitions };
    });
    setDirty(true);
  };

  const toggleRole = (index: number, role: WorkflowRole, checked: boolean) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const transitions = [...prev.transitions];
      const current = transitions[index];
      const roles = new Set(current.allowed_roles);
      if (checked) {
        roles.add(role);
      } else if (roles.size > 1) {
        roles.delete(role);
      }
      transitions[index] = { ...current, allowed_roles: Array.from(roles) as WorkflowRole[] };
      return { ...prev, transitions };
    });
    setDirty(true);
  };

  const addTransition = () => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        transitions: [
          ...prev.transitions,
          { from: 'suggested', to: 'requested', allowed_roles: ['patient', 'caregiver'] },
        ],
      };
    });
    setDirty(true);
  };

  const removeTransition = (index: number) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const transitions = prev.transitions.filter((_, i) => i !== index);
      return { ...prev, transitions };
    });
    setDirty(true);
  };

  const handleSave = async () => {
    if (!draft) return;
    try {
      await upsert.mutateAsync({
        ...draft,
        country: normalizeCountry(country),
        notify_provider_on: [...new Set(draft.notify_provider_on)],
      });
      notifications.show({
        title: t('common.saved'),
        message: t('suppliers.workflowSaved'),
        color: 'green',
      });
      setDirty(false);
    } catch (err: any) {
      notifications.show({
        title: t('common.error'),
        message: err?.message ?? t('suppliers.workflowSaveError'),
        color: 'red',
      });
    }
  };

  return (
    <Stack gap="md">
      <Paper withBorder p="md">
        <Group align="end">
          <TextInput
            label={t('suppliers.workflowCountry')}
            value={countryInput}
            onChange={(event) => setCountryInput(event.currentTarget.value.toUpperCase())}
            placeholder="DE"
            maxLength={3}
            style={{ width: 140 }}
          />
          <Button
            leftSection={<RefreshCw size={16} />}
            variant="default"
            onClick={handleLoadCountry}
          >
            {t('suppliers.workflowLoad')}
          </Button>
          <Badge variant="light">{country}</Badge>
        </Group>
        <Group mt="sm" gap="xs">
          {knownCountries.map((item) => (
            <Badge
              key={item}
              variant={item === country ? 'filled' : 'light'}
              style={{ cursor: 'pointer' }}
              onClick={() => {
                setCountryInput(item);
                setCountry(item);
              }}
            >
              {item}
            </Badge>
          ))}
        </Group>
      </Paper>

      {policyQuery.isLoading && (
        <Center h={120}><Loader color="hca-purple" /></Center>
      )}

      {!policyQuery.isLoading && draft && (
        <>
          <Paper withBorder p="md">
            <Group justify="space-between" mb="sm">
              <Text fw={600}>{t('suppliers.workflowTransitions')}</Text>
              <Button size="xs" leftSection={<Plus size={14} />} onClick={addTransition}>
                {t('suppliers.workflowAddTransition')}
              </Button>
            </Group>

            {draft.transitions.length === 0 && (
              <Alert icon={<AlertTriangle size={16} />} color="yellow" variant="light">
                {t('suppliers.workflowNoTransitions')}
              </Alert>
            )}

            <Stack gap="sm">
              {draft.transitions.map((transition, index) => (
                <Paper key={`${index}-${transition.from}-${transition.to}`} withBorder p="sm">
                  <Group align="flex-end" grow>
                    <Select
                      label={t('suppliers.workflowFrom')}
                      data={STATUS_SELECT_DATA}
                      value={transition.from}
                      onChange={(value) => value && setTransitionField(index, { from: value as AidStatus })}
                    />
                    <Select
                      label={t('suppliers.workflowTo')}
                      data={STATUS_SELECT_DATA}
                      value={transition.to}
                      onChange={(value) => value && setTransitionField(index, { to: value as AidStatus })}
                    />
                    <Button
                      variant="subtle"
                      color="red"
                      leftSection={<Trash2 size={14} />}
                      onClick={() => removeTransition(index)}
                    >
                      {t('common.delete')}
                    </Button>
                  </Group>

                  <Divider my="sm" />
                  <Text size="sm" fw={500} mb={6}>{t('suppliers.workflowAllowedRoles')}</Text>
                  <Group gap="md">
                    {ROLE_OPTIONS.map((role) => (
                      <Checkbox
                        key={role}
                        label={ROLE_LABELS[role]}
                        checked={transition.allowed_roles.includes(role)}
                        onChange={(event) => toggleRole(index, role, event.currentTarget.checked)}
                      />
                    ))}
                  </Group>
                </Paper>
              ))}
            </Stack>
          </Paper>

          <Paper withBorder p="md">
            <MultiSelect
              label={t('suppliers.workflowNotifyOn')}
              placeholder={t('suppliers.workflowNotifyOnPlaceholder')}
              data={STATUS_SELECT_DATA}
              value={draft.notify_provider_on}
              onChange={(value) => {
                setDraft((prev) => prev ? { ...prev, notify_provider_on: value as AidStatus[] } : prev);
                setDirty(true);
              }}
            />
          </Paper>

          <Group justify="flex-end">
            <Button
              color="hca-purple"
              onClick={handleSave}
              loading={upsert.isPending}
              disabled={saveDisabled}
            >
              {t('common.save')}
            </Button>
          </Group>

          {dirty && (
            <Text size="xs" c="dimmed">{t('suppliers.workflowUnsaved')}</Text>
          )}
        </>
      )}
    </Stack>
  );
}
