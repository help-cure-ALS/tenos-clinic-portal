import { useQuery } from '@tanstack/react-query';
import { medplum } from '../lib/medplum';
import { useAuthStore } from '../stores/auth';

export function useStudies() {
  const { isAuthenticated } = useAuthStore();

  return useQuery({
    queryKey: ['studies'],
    queryFn: () => medplum.searchResources('ResearchStudy', {
      _sort: '-date',
      _count: '1000',
    }),
    enabled: isAuthenticated,
  });
}
