import type { StatusPage, ServiceStatus, Status, Incident } from './types'
import { fetchNodeStatus, fetchUpsStatus } from './prometheus'
import { fetchProxmoxNodeStatus } from './proxmox'
import { fetchZabbixStatus } from './zabbix'
import { fetchIncidents } from './incidents'

// Category name for each adapter promise below, in the exact same
// order — the only way to know *which* source actually rejected once
// Promise.allSettled resolves, since a rejected result on its own
// carries no indication of which promise it came from.
const SERVICE_ADAPTER_CATEGORIES = ['Proxmox Nodes', 'Power', 'Proxmox API', 'Zabbix'] as const

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
  const unavailableCategories: string[] = []

  serviceResults.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      services.push(...result.value)
    } else {
      // Previously just silently dropped here, with nothing in the
      // response indicating which source actually failed. The category
      // is known purely from this promise's position in the array
      // above — Promise.allSettled itself carries no other way to tie
      // a rejected result back to which adapter produced it.
      unavailableCategories.push(SERVICE_ADAPTER_CATEGORIES[index])
    }
  })

  return {
    overall: deriveOverallStatus(services),
    services,
    incidents,
    lastUpdated: new Date().toISOString(),
    unavailableCategories,
  }
}

export function deriveOverallStatus(services: ServiceStatus[]): Status {
  if (services.length === 0) return 'unknown'
  if (services.some(s => s.status === 'outage')) return 'outage'
  if (services.some(s => s.status === 'degraded')) return 'degraded'
  if (services.every(s => s.status === 'operational')) return 'operational'
  return 'unknown'
}
