import type { ServiceStatus } from './types'

const PROXY_URL = import.meta.env.VITE_PROXY_URL ?? 'http://localhost:3001'

interface ProxmoxNodeSummary {
  node: string
  status: string
}

interface ProxmoxNodeStatus {
  uptime: number
  cpu: number
  memory: {
    used: number
    total: number
  }
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

async function queryProxmox<T>(path: string): Promise<T> {
  const response = await fetch(`${PROXY_URL}/proxmox/${path}`)

  if (!response.ok) {
    throw new Error(`Proxmox proxy request failed: ${response.status}`)
  }

  const json = await response.json()
  return json.data as T
}

export async function fetchProxmoxNodeStatus(): Promise<ServiceStatus[]> {
  const nodes = await queryProxmox<ProxmoxNodeSummary[]>('nodes')

  const onlineNodes = nodes.filter(n => n.status === 'online')

  const nodeStatuses = await Promise.allSettled(
    onlineNodes.map(node =>
      queryProxmox<ProxmoxNodeStatus>(`nodes/${node.node}/status`)
        .then(status => ({ node, status }))
    )
  )

  return nodeStatuses
    .filter(result => result.status === 'fulfilled')
    .map(result => {
      const { node, status } = (result as PromiseFulfilledResult<{
        node: ProxmoxNodeSummary
        status: ProxmoxNodeStatus
      }>).value

      const cpu = status.cpu ?? 0
      const memUsed = status.memory?.used ?? 0
      const memTotal = status.memory?.total ?? 0
      const uptime = status.uptime ?? 0

      const cpuPercent = (cpu * 100).toFixed(1)
      const memPercent = memTotal > 0
        ? ((memUsed / memTotal) * 100).toFixed(1)
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