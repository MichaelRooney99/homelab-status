import { useQuery } from '@tanstack/react-query'
import { fetchAllServices } from '../services'
import type { StatusPage } from '../services/types'

// The single data-fetching hook the whole app is built around. Chose
// TanStack Query here over a hand-rolled useEffect + useState + setInterval
// specifically for what it gives for free: request deduplication if
// multiple components ever call this hook, automatic retry on failure,
// and — the one that matters most for a status page specifically —
// refetchIntervalInBackground. A plain setInterval driven by useEffect
// stops firing the moment the browser throttles a backgrounded tab,
// which is exactly the situation where someone would still want to know
// their homelab went down. TanStack Query's background refetch bypasses
// that throttling.
//
// staleTime (55s) is set just under refetchInterval (60s) rather than
// equal to it — if they matched exactly, a component remounting right at
// the boundary could either double-fetch or serve slightly-too-stale
// data depending on timing. Leaving a 5s gap means the cached data is
// always considered "fresh enough" between scheduled refetches, and a
// remount never triggers an extra unscheduled request.
//
// retry: 2 (not the TanStack default of 3, not 0) — enough to survive a
// single transient blip against real infrastructure without extending a
// genuine outage's time-to-first-error by too many retry/backoff cycles.
export function useServiceStatus() {
  const { data, isLoading, isError } = useQuery<StatusPage>({
    queryKey: ['serviceStatus'],
    queryFn: fetchAllServices,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
    retry: 2,
    staleTime: 55_000,
  })

  return {
    statusPage: data,
    isLoading,
    isError,
  }
}
