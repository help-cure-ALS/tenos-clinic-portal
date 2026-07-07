import { useQuery } from '@tanstack/react-query';
import type { ResearchStudy } from '@medplum/fhirtypes';
import { medplum } from '../lib/medplum';
import { useAuthStore } from '../stores/auth';

export function useStudies() {
  const { isAuthenticated } = useAuthStore();

  return useQuery({
    queryKey: ['studies'],
    // Medplum caps _count at 1000 per request — paginate with _offset
    // so more than 1000 studies load completely. Guard at 20 pages.
    queryFn: async () => {
      const PAGE_SIZE = 1000;
      const all: ResearchStudy[] = [];
      for (let offset = 0; offset < 20000; offset += PAGE_SIZE) {
        const page = await medplum.searchResources('ResearchStudy', {
          _sort: '-date',
          _count: String(PAGE_SIZE),
          _offset: String(offset),
        });
        all.push(...page);
        if (page.length < PAGE_SIZE) break;
      }
      return all;
    },
    enabled: isAuthenticated,
  });
}
