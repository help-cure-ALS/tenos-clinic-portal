import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { List } from '@medplum/fhirtypes';
import { medplum } from '../lib/medplum';
import { useAuthStore } from '../stores/auth';
import { CLINIC_STUDIES_LIST, STUDY_APPLICATION_FLAG } from '../lib/constants';

type ListEntry = NonNullable<List['entry']>[number];

function hasOpenFlag(entry: ListEntry): boolean {
  return (entry.flag?.coding ?? []).some(
    (c: { system?: string; code?: string }) => c.system === STUDY_APPLICATION_FLAG.system && c.code === STUDY_APPLICATION_FLAG.code,
  );
}

/**
 * Fetches the clinic-studies List for a given Organization.
 * Returns the List resource, extracted study IDs, and IDs of studies flagged as open.
 */
export function useClinicStudyList(clinicId: string | undefined) {
  const { isAuthenticated } = useAuthStore();

  return useQuery({
    queryKey: ['clinic-studies', clinicId],
    queryFn: async () => {
      const results = await medplum.searchResources('List', {
        subject: `Organization/${clinicId}`,
        code: `${CLINIC_STUDIES_LIST.system}|${CLINIC_STUDIES_LIST.code}`,
      });

      const list = results[0] as List | undefined;
      const entries = list?.entry ?? [];

      const studyIds = entries
        .map((e) => e.item?.reference?.replace('ResearchStudy/', ''))
        .filter((id): id is string => !!id);

      const openStudyIds = entries
        .filter(hasOpenFlag)
        .map((e) => e.item?.reference?.replace('ResearchStudy/', ''))
        .filter((id): id is string => !!id);

      return { list, studyIds, openStudyIds };
    },
    enabled: isAuthenticated && !!clinicId,
  });
}

/**
 * Creates or updates the clinic-studies List resource.
 * Preserves existing flags when saving.
 */
export function useSaveClinicStudies() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      clinicId,
      studyIds,
      existingList,
    }: {
      clinicId: string;
      studyIds: string[];
      existingList?: List;
    }) => {
      // Build a lookup of existing flags by study reference
      const existingFlags = new Map<string, ListEntry['flag']>();
      for (const e of existingList?.entry ?? []) {
        const ref = e.item?.reference;
        if (ref && e.flag) existingFlags.set(ref, e.flag);
      }

      const entry = studyIds.map((id) => {
        const ref = `ResearchStudy/${id}`;
        const flag = existingFlags.get(ref);
        return flag ? { item: { reference: ref }, flag } : { item: { reference: ref } };
      });

      if (existingList?.id) {
        return medplum.updateResource<List>({
          ...existingList,
          entry,
        });
      }

      return medplum.createResource<List>({
        resourceType: 'List',
        status: 'current',
        mode: 'working',
        code: {
          coding: [{ system: CLINIC_STUDIES_LIST.system, code: CLINIC_STUDIES_LIST.code }],
        },
        subject: { reference: `Organization/${clinicId}` },
        entry,
      });
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['clinic-studies', variables.clinicId] });
    },
  });
}

/**
 * Toggles the open-for-applications flag on a single study entry.
 */
export function useToggleStudyOpen() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      studyId,
      open,
      existingList,
    }: {
      clinicId: string;
      studyId: string;
      open: boolean;
      existingList: List;
    }) => {
      const ref = `ResearchStudy/${studyId}`;
      const entry = (existingList.entry ?? []).map((e) => {
        if (e.item?.reference !== ref) return e;

        if (open) {
          return {
            ...e,
            flag: {
              coding: [{ system: STUDY_APPLICATION_FLAG.system, code: STUDY_APPLICATION_FLAG.code }],
            },
          };
        }
        // Remove flag
        const { flag: _removed, ...rest } = e;
        return rest;
      });

      return medplum.updateResource<List>({
        ...existingList,
        entry,
      });
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['clinic-studies', variables.clinicId] });
    },
  });
}
