import type { StatusPage, ServiceStatus, Status } from './types'
import { fetchNodeStatus, fetchUpsStatus } from './prometheus'
import { fetchProxmoxNodeStatus } from './proxmox'
import { fetchZabbixStatus } from './zabbix'
  
export async function fetchAllServices(): Promise<StatusPage> {
  const results = await Promise.allSettled([
    fetchNodeStatus(),
    fetchUpsStatus(),
    fetchProxmoxNodeStatus(),
    fetchZabbixStatus(),
  ])

  const services: ServiceStatus[] = []

  for (const result of results) {
    if (result.status === 'fulfilled') {
      services.push(...result.value)
    }
  }
//If any of the service fetches failed, we can still return the others and just mark the overall status as degraded or unknown depending on how many succeeded. 
// The UI can also show which specific services failed to load if needed.
  return {
    overall: deriveOverallStatus(services),
    services,
    incidents: [],
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