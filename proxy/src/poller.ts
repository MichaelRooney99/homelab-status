import {
  recordSnapshot,
  pruneOldSnapshots,
  pruneOldIncidents,
  getLastStatuses,
  getActiveDraftedIncident,
  createDraftedIncident,
  resolveDraftedIncident,
} from './db'

// 15 minutes — frequent enough to catch a same-day partial outage for
// the two categories that have no other history source at all (unlike
// Proxmox Nodes and Power, which fall back on Prometheus's own real
// scrape data even if this poller's granularity misses something),
// light enough that it's a non-issue against Proxmox/Zabbix for a
// homelab of this size.
const POLL_INTERVAL_MS = 15 * 60 * 1000

// 2 consecutive readings at the poller's own 15-minute cadence — roughly
// 30 minutes of sustained status before drafting or auto-resolving an
// incident. Chosen specifically to avoid drafting an incident for a
// single blip (one bad reading that recovers by the next tick) while
// still catching a genuinely sustained problem within half an hour.
export const THRESHOLD_READINGS = 2

export type ThresholdDecision = 'draft' | 'resolve' | 'none'

// Pure decision logic, extracted from checkIncidentThreshold specifically
// so it's testable without a real database. Takes exactly the two facts
// the decision actually depends on (the last N readings, and whether an
// incident is
// already active) rather than the serviceId/timestamp/DB access the
// original inline version needed, so a test can call this directly with
// plain arrays and booleans, no database involved at all.
export function decideIncidentAction(
  recentStatuses: string[],
  hasActiveIncident: boolean
): ThresholdDecision {
  if (recentStatuses.length < THRESHOLD_READINGS) return 'none' // not enough history yet to judge a streak

  const allOutage = recentStatuses.every(status => status === 'outage')
  const allOperational = recentStatuses.every(status => status === 'operational')

  if (allOutage && !hasActiveIncident) return 'draft'
  if (allOperational && hasActiveIncident) return 'resolve'
  return 'none'
  // Mixed readings (one outage, one operational) fall through to 'none'
  // on purpose — neither threshold is met, so an already-active incident
  // stays open and a service that hasn't sustained outage long enough
  // doesn't get one drafted yet.
}

// Checks whether a service just crossed the auto-incident threshold in
// either direction. Called after every recorded snapshot, for every
// service this poller tracks — cheap at this scale (a handful of
// services, one query for two rows each), and re-deriving from the
// snapshots table on every call means this is correct even right after
// a proxy restart, with no volatile in-memory streak counter to lose.
// Now just orchestration — the actual decision lives in
// decideIncidentAction above.
function checkIncidentThreshold(serviceId: string, timestamp: number): void {
  const recent = getLastStatuses(serviceId, THRESHOLD_READINGS)
  if (recent.length < THRESHOLD_READINGS) return // avoids a wasted DB call below when there's not enough history yet

  const active = getActiveDraftedIncident(serviceId)
  const decision = decideIncidentAction(recent, active !== undefined)

  if (decision === 'draft') {
    createDraftedIncident(serviceId, timestamp)
  } else if (decision === 'resolve' && active) {
    resolveDraftedIncident(active.id, timestamp)
  }
}

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
// rather than shared: the amount of logic is small, and building
// shared-package tooling across two separate npm projects for one small
// function would be disproportionate.
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
    const start = Date.now()
    const response = await fetch(`http://localhost:${port}/proxmox/nodes`)
    // This is the time for the whole /proxmox/nodes call, covering
    // every node in one request — not a true per-node latency, since
    // Proxmox's own API returns the full node list in a single response.
    // Recorded identically against every node in this batch. Honest
    // about what it actually measures rather than implying a precision
    // this endpoint shape can't give.
    const responseTimeMs = Date.now() - start
    if (!response.ok) throw new Error(`Proxmox poll failed: ${response.status}`)

    const json = await response.json() as ProxmoxNodesResponse
    const nodes = json.data
    const now = Math.floor(Date.now() / 1000)

    // Deliberately not pre-filtering to online nodes before recording a
    // status — that was the exact bug fixed in the client adapter this
    // same session. An offline node here gets recorded as an outage,
    // not silently skipped.
    for (const node of nodes) {
      const status = node.status === 'online' ? 'operational' : 'outage'
      const serviceId = `proxmox-${node.node}`
      recordSnapshot(serviceId, status, responseTimeMs, now)
      checkIncidentThreshold(serviceId, now)
    }
  } catch (error) {
    console.error('Proxmox poll failed:', error)
  }
}

async function pollZabbix(port: string | number): Promise<void> {
  try {
    const start = Date.now()
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
    // Same batch-level caveat as the Proxmox timing above — one
    // host.get call covers every host, this isn't true per-host latency.
    const responseTimeMs = Date.now() - start

    if (!response.ok) throw new Error(`Zabbix poll failed: ${response.status}`)

    const json = await response.json() as ZabbixHostGetResponse
    if (json.error) throw new Error(`Zabbix poll error: ${json.error.message}`)

    const hosts = json.result ?? []
    const now = Math.floor(Date.now() / 1000)

    for (const host of hosts) {
      if (host.name === ZABBIX_SERVER_NAME) continue
      const serviceId = `zabbix-${host.hostid}`
      const status = deriveZabbixStatus(host.interfaces)
      recordSnapshot(serviceId, status, responseTimeMs, now)
      checkIncidentThreshold(serviceId, now)
    }
  } catch (error) {
    console.error('Zabbix poll failed:', error)
  }
}

export function startPoller(port: string | number): void {
  const tick = async () => {
    await Promise.all([pollProxmox(port), pollZabbix(port)])
    pruneOldSnapshots()
    pruneOldIncidents()
    console.log(`Snapshot poll completed at ${new Date().toISOString()}`)
  }

  // Run once immediately rather than waiting a full interval for the
  // first data point — otherwise a freshly deployed proxy has zero
  // history until the first tick fires, up to 15 minutes later.
  tick()
  setInterval(tick, POLL_INTERVAL_MS)
}
