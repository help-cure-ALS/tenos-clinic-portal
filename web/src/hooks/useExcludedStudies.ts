import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../stores/auth';
import { listExcludedStudies } from '../lib/studiesSyncApi';

/**
 * Loads the exclusion list from the studies-sync service. Used when
 * rendering the StudiesPage to hide studies matching one of the
 * listed identifiers — regardless of whether Medplum's search index
 * still returns them.
 *
 * Only `enabled: isAuthenticated` — the endpoint returns 403 when not
 * an hca-admin, react-query caches the error, and we then show an
 * empty list. That is more robust than a role-based enable check,
 * which is disabled at the wrong moments during async role loading.
 *
 * `staleTime: 0` and `refetchOnMount: 'always'` make sure that every
 * mount and every invalidateQueries is guaranteed to trigger a fresh
 * fetch — excludes are the source of truth and must stay
 * consistent.
 */
export function useExcludedStudies() {
  const { isAuthenticated } = useAuthStore();
  return useQuery({
    queryKey: ['studies-excluded'],
    queryFn: listExcludedStudies,
    enabled: isAuthenticated,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
}
