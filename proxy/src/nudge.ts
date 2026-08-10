import type { Response } from 'express'

// How often this checks for a status change worth nudging clients about
// — deliberately its own interval, NOT poller.ts's existing 15-minute
// tick. That interval is right for "how much 90-day history granularity
// do we need," but reusing it literally for the nudge signal (as 17-'s
// text loosely suggests — "the poller already ticks independently,
// extend it") would mean nudges arrive up to 15 minutes late. That
// would make Proxmox API / Zabbix updates *less* responsive than the
// 60-second client polling this feature exists to improve on — worth
// naming as a deliberate departure from the doc's original framing,
// not an oversight.
const NUDGE_CHECK_INTERVAL_MS = 20 * 1000

// Cloudflare's edge proxy kills an idle connection that's gone quiet for
// too long — well under two minutes, confirmed directly in testing
// 08-06-2026 via a real curl connection that died with
// "HTTP/2 stream ... INTERNAL_ERROR" after sitting silent for a while.
// This has nothing to do with nginx or Express's own timeouts; it's
// Cloudflare's tunnel specifically. Fix is a periodic no-op write well
// under that threshold — EventSource ignores lines starting with ':' by
// spec, so this never surfaces as a fake nudge on the client side, it's
// purely there to keep the connection looking "active" to Cloudflare.
const KEEPALIVE_INTERVAL_MS = 15 * 1000

interface ZabbixInterface {
  available: string
  type: string
}

interface ZabbixHost {
  hostid: string
  name: string
  interfaces: ZabbixInterface[]
}

interface ProxmoxNodeSummary {
  node: string
  status: string
}

interface PrometheusResult {
  metric: Record<string, string>
  value: [number, string]
}

type Status = 'operational' | 'degraded' | 'outage' | 'unknown'

const ZABBIX_SERVER_NAME = 'Zabbix server'
const PROMETHEUS_HOST = process.env.PROMETHEUS_HOST ?? 'http://10.10.10.105:9090'

// Exported for the same reason as deriveOverallStatus above — see
// nudge.test.ts and fixtures/parity/zabbix-availability.json. Return
// type tightened from string to Status to match the client's copy
// exactly; behavior is unchanged.
export function deriveZabbixStatus(interfaces: ZabbixInterface[]): Status {
  const agentInterface = interfaces.find(i => i.type === '1')
  if (!agentInterface) return 'unknown'

  switch (agentInterface.available) {
    case '1': return 'operational'
    case '2': return 'outage'
    default:  return 'unknown'
  }
}

interface PrometheusQueryResponse {
  status: string
  data: { result: PrometheusResult[] }
  error?: string
}

async function queryPrometheus(query: string): Promise<PrometheusResult[]> {
  const url = `${PROMETHEUS_HOST}/api/v1/query?query=${encodeURIComponent(query)}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Prometheus query failed: ${response.status}`)

  const json = await response.json() as PrometheusQueryResponse
  if (json.status !== 'success') throw new Error('Prometheus returned an error')

  return json.data.result
}


// Exported as a deliberate, narrow testability exception — same
// reasoning as client/src/services/zabbix.ts's deriveAvailability (see
// 18-Automated Test Coverage). This is the proxy-side copy that
// 20-Embeddable Status Badge introduced; see nudge.test.ts and
// fixtures/parity/overall-status.json for the parity check against the
// client's copy.
export function deriveOverallStatus(statuses: Status[]): Status {
  if (statuses.length === 0) return 'unknown'
  if (statuses.some(s => s === 'outage')) return 'outage'
  if (statuses.some(s => s === 'degraded')) return 'degraded'
  if (statuses.every(s => s === 'operational')) return 'operational'
  return 'unknown'
}

interface PrometheusCheckResult {
  signature: string
  statuses: Status[]
}

async function getPrometheusCheck(): Promise<PrometheusCheckResult> {
  const [upResults, statusResults] = await Promise.all([
    queryPrometheus('up{job="node_exporter"}'),
    queryPrometheus('nut_ups_status'),
  ])

  const nodes = upResults.map(r => `${r.metric.instance}:${r.value[1]}`).sort()
  const nodeStatuses: Status[] = upResults.map(r => (r.value[1] === '1' ? 'operational' : 'outage'))

  const activeFlags = statusResults
    .filter(r => r.value[1] === '1')
    .map(r => r.metric.status)
    .sort()

  // Same OL/OB/LB priority as prometheus.ts's fetchUpsStatus — LB
  // (low battery) worst, then OB (on battery), then OL (online).
  // Mirrored, not shared — same reasoning as deriveZabbixStatus below.
  let upsStatus: Status = 'unknown'
  if (activeFlags.includes('LB')) upsStatus = 'outage'
  else if (activeFlags.includes('OB')) upsStatus = 'degraded'
  else if (activeFlags.includes('OL')) upsStatus = 'operational'

  return {
    signature: JSON.stringify({ nodes, ups: activeFlags }),
    statuses: [...nodeStatuses, upsStatus],
  }
}

interface ProxmoxCheckResult {
  signature: string
  statuses: Status[]
}

async function getProxmoxCheck(port: string | number): Promise<ProxmoxCheckResult> {
  const response = await fetch(`http://localhost:${port}/proxmox/nodes`)
  if (!response.ok) throw new Error(`Proxmox check failed: ${response.status}`)

  const json = await response.json() as { data: ProxmoxNodeSummary[] }
  const nodes = json.data.map(n => `${n.node}:${n.status}`).sort()
  // Summary-level only — this hits /proxmox/nodes, not the per-node
  // detail call the client's two-stage adapter also makes, so there's
  // no "unreachable" third case here. 'online' -> operational,
  // anything else -> outage, same as poller.ts's own derivation.
  const statuses: Status[] = json.data.map(n => (n.status === 'online' ? 'operational' : 'outage'))

  return { signature: JSON.stringify(nodes), statuses }
}

interface ZabbixCheckResult {
  signature: string
  statuses: Status[]
}

async function getZabbixCheck(port: string | number): Promise<ZabbixCheckResult> {
  const response = await fetch(`http://localhost:${port}/zabbix`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      method: 'host.get',
      params: { output: ['hostid', 'name'], selectInterfaces: ['type', 'available'] },
      id: 1,
    }),
  })
  if (!response.ok) throw new Error(`Zabbix check failed: ${response.status}`)

  const json = await response.json() as { result?: ZabbixHost[] }
  const hosts = (json.result ?? []).filter(h => h.name !== ZABBIX_SERVER_NAME)
  const statuses = hosts.map(h => deriveZabbixStatus(h.interfaces) as Status)
  const signature = hosts.map((h, i) => `${h.hostid}:${statuses[i]}`).sort()

  return { signature: JSON.stringify(signature), statuses }
}

// Open SSE connections, keyed by nothing in particular — just a set of
// live response objects to write to. Express doesn't close these on its
// own; index.ts's /events handler is responsible for calling
// removeNudgeClient when the underlying request actually closes.
const clients = new Set<Response>()

export function addNudgeClient(res: Response): void {
  clients.add(res)
}

export function removeNudgeClient(res: Response): void {
  clients.delete(res)
}

function broadcastNudge(): void {
  for (const client of clients) {
    client.write('event: nudge\ndata: {}\n\n')
  }
}

function sendKeepAlive(): void {
  for (const client of clients) {
    client.write(': keep-alive\n\n')
  }
}

let lastSignature: string | null = null
let cachedOverallStatus: Status = 'unknown'

// Read by index.ts's /badge.svg route. Synchronous, no fetch — the
// badge's own staleness is bounded by this loop's 20s cadence, the
// same accepted tradeoff the nudge channel itself already has.
export function getCachedOverallStatus(): Status {
  return cachedOverallStatus
}

export type SignatureCheckResult = 'initial' | 'changed' | 'unchanged'

// Pure comparison logic, extracted from checkForChanges specifically so
// it's testable without mocking fetch or any of the three data-source
// checks — see 18-Automated Test Coverage.md's Phase 2 plan, the last
// item on that list. 'initial' is its own case rather than folded into
// 'changed' because the very first tick after a proxy restart has
// nothing real to compare against — treating a null baseline as "the
// status changed" would fire a spurious nudge to every connected client
// the moment the proxy comes back up, before anything has actually
// changed at all.
export function compareSignature(
  previous: string | null,
  current: string
): SignatureCheckResult {
  if (previous === null) return 'initial'
  if (previous !== current) return 'changed'
  return 'unchanged'
}

async function checkForChanges(port: string | number): Promise<void> {
  try {
    const [prometheus, proxmox, zabbix] = await Promise.all([
      getPrometheusCheck(),
      getProxmoxCheck(port),
      getZabbixCheck(port),
    ])

    const signature = JSON.stringify({
      prometheus: prometheus.signature,
      proxmox: proxmox.signature,
      zabbix: zabbix.signature,
    })

    // Recomputed and cached every tick regardless of whether the
    // signature changed — cheap, since it's just a reduce over data
    // already fetched this tick, and it keeps the badge's staleness
    // bounded by "last tick," not "last time something also changed."
    cachedOverallStatus = deriveOverallStatus([
      ...prometheus.statuses,
      ...proxmox.statuses,
      ...zabbix.statuses,
    ])

    const result = compareSignature(lastSignature, signature)
    lastSignature = signature

    if (result === 'changed') {
      broadcastNudge()
    }
  } catch (error) {
    console.error('Nudge check failed:', error)
  }
}

export function startNudgeChecker(port: string | number): void {
  setInterval(() => checkForChanges(port), NUDGE_CHECK_INTERVAL_MS)
  setInterval(sendKeepAlive, KEEPALIVE_INTERVAL_MS)
}
