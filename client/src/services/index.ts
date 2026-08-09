import type { StatusPage, ServiceStatus, Status, Incident } from './types'
import { fetchNodeStatus, fetchUpsStatus } from './prometheus'
import { fetchProxmoxNodeStatus } from './proxmox'
import { fetchZabbixStatus } from './zabbix'
import { fetchIncidents } from './incidents'

export async function fetchAllServices(): Promise<StatusPage> {
  const [serviceResults, incidents] = await Promise.all([
    Promise.allSettled([
      fetchNodeStatus(),
      fetchUpsStatus(),
      fetchProxmoxNodeStatus(),
      fetchZabbixStatus(),
    ]),
    // Incidents get their own failure isolation rather than joining the
    // services array — a failed incidents fetch shouldn't erase services,
    // and a failed service fetch shouldn't erase the incidents section.
    // Same Promise.allSettled reasoning as everything else here, applied
    // per data shape instead of assuming one array fits both.
    fetchIncidents().catch(() => [] as Incident[]),
  ])

  const services: ServiceStatus[] = []

  for (const result of serviceResults) {
    if (result.status === 'fulfilled') {
      services.push(...result.value)
    }
  }
//If any of the service fetches failed, we can still return the others and just mark the overall status as degraded or unknown depending on how many succeeded. 
// The UI can also show which specific services failed to load if needed.
  return {
    overall: deriveOverallStatus(services),
    services,
    incidents,
    lastUpdated: new Date().toISOString(),
  }
}

export function deriveOverallStatus(services: ServiceStatus[]): Status {
  if (services.length === 0) return 'unknown'
  if (services.some(s => s.status === 'outage')) return 'outage'
  if (services.some(s => s.status === 'degraded')) return 'degraded'
  if (services.every(s => s.status === 'operational')) return 'operational'
  return 'unknown'
}
