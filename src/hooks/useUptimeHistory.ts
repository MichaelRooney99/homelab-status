import { useQuery } from '@tanstack/react-query'
import { fetchUptimeHistory } from '../services/history'
import type { ServiceStatus, UptimeDay } from '../services/types'

// Daily-granularity data doesn't need 60-second polling like the live
// status page does — hourly is more than enough to pick up "today"
// filling in as the day progresses, without hammering Prometheus (or,
// as of the full-category history addition, the proxy's own snapshot
// endpoint) with a fanned-out request on every poll.
//
// Takes the live service list as an argument rather than fetching its
// own copy — this hook needs to know which Proxmox API / Zabbix ids
// currently exist to ask the proxy for their history, and the live list
// from useServiceStatus is already exactly that, fetched every 60s
// regardless. Re-deriving it here would just be a duplicate network
// call for data the app already has.
export function useUptimeHistory(services: ServiceStatus[]) {
  const { data, isLoading } = useQuery<Record<string, UptimeDay[]>>({
    // Service ids folded into the query key so a genuinely new or
    // removed service (a node joining the fleet, for instance) triggers
    // a refetch on its own, not just whenever the hourly timer happens
    // to fire next.
    queryKey: ['uptimeHistory', services.map(s => s.id).join(',')],
    queryFn: () => fetchUptimeHistory(services),
    enabled: services.length > 0,
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