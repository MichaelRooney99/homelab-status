import type { ServiceStatus } from './types'

const PROXY_URL = import.meta.env.VITE_PROXY_URL ?? 'http://localhost:3001'

interface ProxmoxNode {
  node: string
  status: string
  uptime: number
  maxcpu: number
  cpu: number
  maxmem: number
  mem: number
}

//fetches the status of the proxmox nodes, and returns a ServiceStatus for each node. Proxmox is different from prometheus, grafana, NUT, and Zabbix in that it doesn't have a concept of "services" that can be "degraded" or "outage". Instead, we will treat each node as a "service", and determine its status based on its CPU and memory usage. If the CPU or memory usage is above 80%, we will consider the node to be "degraded". If the CPU or memory usage is above 90%, we will consider the node to be in "outage". Otherwise, we will consider the node to be "operational".
async function queryProxmox<T>(path: string): Promise<T> {
  const response = await fetch(`${PROXY_URL}/proxmox/${path}`)

    if (!response.ok) {
        throw new Error(`Proxmox proxy request failed: ${response.status}`)
    }

  const json = await response.json()
  return json.data as T
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

export async function fetchProxmoxNodeStatus(): Promise<ServiceStatus[]> {
  const nodes = await queryProxmox<ProxmoxNode[]>('nodes')

  return nodes.map((node): ServiceStatus => {
    const cpu = node.cpu ?? 0
    const mem = node.mem ?? 0
    const maxmem = node.maxmem ?? 0
    const uptime = node.uptime ?? 0

    const cpuPercent = (cpu * 100).toFixed(1)
    const memPercent = maxmem > 0
      ? ((mem / maxmem) * 100).toFixed(1)
      : '0.0'
    const uptimeDays = Math.floor(uptime / 86400)
    const uptimeHours = Math.floor(uptime / 3600)

    const uptimeDisplay = uptime === 0
      ? 'offline'
      : uptimeDays > 0
        ? `${uptimeDays}d ${Math.floor((uptime % 86400) / 3600)}h`
        : `${uptimeHours}h`

    return {
      id: `proxmox-${node.node}`,
      name: capitalize(node.node),
      category: 'Proxmox API',
      status: node.status === 'online' ? 'operational' : 'outage',
      metadata: {
        cpu: `${cpuPercent}%`,
        memory: `${memPercent}%`,
        uptime: uptimeDisplay,
      },
    }
  })
}