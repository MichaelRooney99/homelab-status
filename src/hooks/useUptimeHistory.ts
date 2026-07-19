import { useQuery } from '@tanstack/react-query'
import { fetchUptimeHistory } from '../services/history'
import type { UptimeDay } from '../services/types'

// Daily-granularity data doesn't need 60-second polling like the live
// status page does — hourly is more than enough to pick up "today"
// filling in as the day progresses, without hammering Prometheus with
// a query_range call (fanned out across every node) on every poll.
export function useUptimeHistory() {
  const { data, isLoading } = useQuery<Record<string, UptimeDay[]>>({
    queryKey: ['uptimeHistory'],
    queryFn: fetchUptimeHistory,
    refetchInterval: 60 * 60_000,
    refetchIntervalInBackground: true,
    retry: 1,
    staleTime: 55 * 60_000,
  })

  return {
    history: data ?? {},
    isLoading,
  }
}