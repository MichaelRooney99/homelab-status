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
  // Anything Proxmox itself doesn't report as "online" is genuinely
  // down (or in a state Proxmox hasn't classified as online) — these
  // previously vanished from the page entirely instead of showing as
  // an outage, since the old code filtered them out before building
  // the result at all. The ternary below that checked node.status
  // could never actually reach its 'outage' branch, because only
  // online nodes ever made it that far.
  const offlineNodes = nodes.filter(n => n.status !== 'online')

  const onlineStatuses = await Promise.allSettled(
    onlineNodes.map(node =>
      queryProxmox<ProxmoxNodeStatus>(`nodes/${node.node}/status`)
        .then(status => ({ node, status }))
    )
  )

  const onlineResults: ServiceStatus[] = onlineStatuses
    .filter((result): result is PromiseFulfilledResult<{
      node: ProxmoxNodeSummary
      status: ProxmoxNodeStatus
    }> => result.status === 'fulfilled')
    .map(result => {
      const { node, status } = result.value

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
        status: 'operational',
        metadata: {
          cpu: `${cpuPercent}%`,
          memory: `${memPercent}%`,
          uptime: uptimeDisplay,
        },
      }
    })

  // A node Proxmox itself reports as down can't answer a detailed status
  // query — there's no cpu/memory/uptime to show, and that's fine. The
  // outage itself is the information.
  const offlineResults: ServiceStatus[] = offlineNodes.map(node => ({
    id: `proxmox-${node.node}`,
    name: capitalize(node.node),
    category: 'Proxmox API',
    status: 'outage',
    metadata: {
      cpu: '—',
      memory: '—',
      uptime: 'offline',
    },
  }))

  // A node Proxmox reports as online, but whose detailed status query
  // itself failed (network blip, timeout) — Promise.allSettled already
  // isolates this from crashing the whole adapter, but previously it
  // just vanished from the result the same way a truly offline node
  // did. Surfacing it as an outage instead of dropping it, same
  // reasoning as the branch above.
  const unreachableResults: ServiceStatus[] = onlineStatuses
    .map((result, index) => ({ result, node: onlineNodes[index] }))
    .filter(({ result }) => result.status === 'rejected')
    .map(({ node }) => ({
      id: `proxmox-${node.node}`,
      name: capitalize(node.node),
      category: 'Proxmox API',
      status: 'outage',
      metadata: {
        cpu: '—',
        memory: '—',
        uptime: 'unreachable',
      },
    }))

  return [...onlineResults, ...offlineResults, ...unreachableResults]
}