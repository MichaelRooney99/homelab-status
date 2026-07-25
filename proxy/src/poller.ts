import { recordSnapshot, pruneOldSnapshots } from './db'

// 15 minutes — frequent enough to catch a same-day partial outage for
// the two categories that have no other history source at all (unlike
// Proxmox Nodes and Power, which fall back on Prometheus's own real
// scrape data even if this poller's granularity misses something),
// light enough that it's a non-issue against Proxmox/Zabbix for a
// homelab of this size. See 14-Full-Category History.md.
const POLL_INTERVAL_MS = 15 * 60 * 1000

interface ProxmoxNodeSummary {
  node: string
  status: string
}

interface ZabbixInterface {
  available: string
  type: string
}

interface ZabbixHost {
  hostid: string
  name: string
  status: string
  interfaces: ZabbixInterface[]
}

// Response shapes for the two proxy routes this poller calls into —
// cast immediately on the way out of .json(), same as index.ts already
// does. Node's own fetch types (from @types/node, not the DOM lib —
// this tsconfig only includes "ES2020") declare Response.json() as
// Promise<unknown> rather than Promise<any>, so leaving it uncast means
// every property access on it fails to typecheck. tsx doesn't catch
// this since it skips type-checking entirely, but tsc does — and tsc is
// what the Docker build actually runs.
interface ProxmoxNodesResponse {
  data: ProxmoxNodeSummary[]
}

interface ZabbixHostGetResponse {
  result?: ZabbixHost[]
  error?: { message: string; data: string }
}

const ZABBIX_SERVER_NAME = 'Zabbix server'

// Mirrors the (fixed) derivation logic in the client's zabbix.ts exactly
// — same interface lookup, same available-code mapping. Duplicated
// rather than shared, per the scope doc's decision: the amount of logic
// is small, and building shared-package tooling across two separate npm
// projects for one small function would be disproportionate.
function deriveZabbixStatus(interfaces: ZabbixInterface[]): string {
  const agentInterface = interfaces.find(i => i.type === '1')
  if (!agentInterface) return 'unknown'

  switch (agentInterface.available) {
    case '1': return 'operational'
    case '2': return 'outage'
    default:  return 'unknown'
  }
}

// Calls this same process's own /proxmox route over localhost rather
// than duplicating the upstream Proxmox host/token/TLS-bypass logic a
// second time — one source of truth for "how to reach Proxmox," used by
// both the browser (via the client adapter) and this poller.
async function pollProxmox(port: string | number): Promise<void> {
  try {
    const response = await fetch(`http://localhost:${port}/proxmox/nodes`)
    if (!response.ok) throw new Error(`Proxmox poll failed: ${response.status}`)

    const json = await response.json() as ProxmoxNodesResponse
    const nodes = json.data

    // Deliberately not pre-filtering to online nodes before recording a
    // status — that was the exact bug fixed in the client adapter this
    // same session. An offline node here gets recorded as an outage,
    // not silently skipped.
    for (const node of nodes) {
      const status = node.status === 'online' ? 'operational' : 'outage'
      recordSnapshot(`proxmox-${node.node}`, status)
    }
  } catch (error) {
    console.error('Proxmox poll failed:', error)
  }
}

async function pollZabbix(port: string | number): Promise<void> {
  try {
    const response = await fetch(`http://localhost:${port}/zabbix`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'host.get',
        params: {
          output: ['hostid', 'name', 'status'],
          selectInterfaces: ['type', 'available'],
        },
        id: 1,
      }),
    })

    if (!response.ok) throw new Error(`Zabbix poll failed: ${response.status}`)

    const json = await response.json() as ZabbixHostGetResponse
    if (json.error) throw new Error(`Zabbix poll error: ${json.error.message}`)

    const hosts = json.result ?? []

    for (const host of hosts) {
      if (host.name === ZABBIX_SERVER_NAME) continue
      recordSnapshot(`zabbix-${host.hostid}`, deriveZabbixStatus(host.interfaces))
    }
  } catch (error) {
    console.error('Zabbix poll failed:', error)
  }
}

export function startPoller(port: string | number): void {
  const tick = async () => {
    await Promise.all([pollProxmox(port), pollZabbix(port)])
    pruneOldSnapshots()
    console.log(`Snapshot poll completed at ${new Date().toISOString()}`)
  }

  // Run once immediately rather than waiting a full interval for the
  // first data point — otherwise a freshly deployed proxy has zero
  // history until the first tick fires, up to 15 minutes later.
  tick()
  setInterval(tick, POLL_INTERVAL_MS)
}