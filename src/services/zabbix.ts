import type { ServiceStatus, Status } from './types'

// ── Zabbix API response shapes ────────────────────────────────────────────

interface ZabbixInterface {
  available: string   // "0" = unknown, "1" = available, "2" = unavailable
  type: string        // "1" = agent
}

interface ZabbixHost {
  hostid: string
  name: string
  status: string        // "0" = enabled, "1" = disabled
  interfaces: ZabbixInterface[]
}

interface ZabbixResponse {
  jsonrpc: string
  result: ZabbixHost[]
  error?: { data: string; message: string }
  id: number
}

// ── Internal helper ───────────────────────────────────────────────────────

const PROXY_URL = import.meta.env.VITE_PROXY_URL ?? 'http://localhost:3001'

// Zabbix server's own host entry — not a node for the status page
const ZABBIX_SERVER_NAME = 'Zabbix server'

async function queryZabbix(
  method: string,
  params: Record<string, unknown>
): Promise<ZabbixHost[]> {
  const response = await fetch(`${PROXY_URL}/zabbix`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params, id: 1 }),
  })

  if (!response.ok) {
    throw new Error(`Zabbix proxy request failed: ${response.status}`)
  }

  const json = await response.json() as ZabbixResponse

  if (json.error) {
    throw new Error(`Zabbix API error: ${json.error.message} — ${json.error.data}`)
  }

  return json.result
}

// ── Availability mapping ──────────────────────────────────────────────────

// Find the agent interface (type "1") and read its available field.
// "0" = unknown, "1" = available, "2" = unavailable
//
// Exported as a deliberate, narrow exception to this file's usual "only
// the adapter itself" export surface (see 04-Services Index) — this
// exact class of derivation logic is duplicated three times across this
// codebase (here, proxy/src/poller.ts, proxy/src/nudge.ts) specifically
// because it's small enough that shared tooling wasn't worth it, and
// that kind of duplication is exactly what silently drifted in the real
// 07-24-2026 nut_exporter/nut job-name bug. Testing this canonical copy
// doesn't automatically protect the other two, but it's the cheapest
// place to start — see 18-Automated Test Coverage.md.
export function deriveAvailability(interfaces: ZabbixInterface[]): Status {
  const agentInterface = interfaces.find(i => i.type === '1')
  if (!agentInterface) return 'unknown'

  switch (agentInterface.available) {
    case '1': return 'operational'
    case '2': return 'outage'
    default:  return 'unknown'
  }
}

// ── Exported adapter ──────────────────────────────────────────────────────

export async function fetchZabbixStatus(): Promise<ServiceStatus[]> {
  const hosts = await queryZabbix('host.get', {
    output: ['hostid', 'name', 'status'],
    selectInterfaces: ['type', 'available'],
  })

  return hosts
    .filter(host => host.name !== ZABBIX_SERVER_NAME)
    .map(host => ({
      id:       `zabbix-${host.hostid}`,
      name:     host.name,
      category: 'Zabbix',
      status:   deriveAvailability(host.interfaces),
      metadata: {
        source: 'Zabbix Agent 2',
      },
    }))
}