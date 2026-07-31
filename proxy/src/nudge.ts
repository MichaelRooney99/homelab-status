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

const ZABBIX_SERVER_NAME = 'Zabbix server'
const PROMETHEUS_HOST = process.env.PROMETHEUS_HOST ?? 'http://10.10.10.105:9090'

// Same derivation as poller.ts's own copy, which itself mirrors the
// client's zabbix.ts — a third duplicate now rather than shared, same
// reasoning as before: the logic is small, and three small copies
// still costs less than real cross-package tooling at this project's
// size.
function deriveZabbixStatus(interfaces: ZabbixInterface[]): string {
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

// Deliberately narrow — only the two queries that actually determine a
// status (up{} and nut_ups_status), not the CPU/memory/runtime/load
// metadata the client's own prometheus.ts also fetches for display.
// Those change essentially every tick and would nudge constantly,
// defeating the entire point of a *change* signal. This function's only
// job is "did anything's status actually flip," not "reproduce
// everything the client shows."
async function getPrometheusSignature(): Promise<string> {
  const [upResults, statusResults] = await Promise.all([
    queryPrometheus('up{job="node_exporter"}'),
    queryPrometheus('nut_ups_status'),
  ])

  const nodes = upResults.map(r => `${r.metric.instance}:${r.value[1]}`).sort()

  const activeFlags = statusResults
    .filter(r => r.value[1] === '1')
    .map(r => r.metric.status)
    .sort()

  return JSON.stringify({ nodes, ups: activeFlags })
}

async function getProxmoxSignature(port: string | number): Promise<string> {
  const response = await fetch(`http://localhost:${port}/proxmox/nodes`)
  if (!response.ok) throw new Error(`Proxmox check failed: ${response.status}`)

  const json = await response.json() as { data: ProxmoxNodeSummary[] }
  const nodes = json.data.map(n => `${n.node}:${n.status}`).sort()
  return JSON.stringify(nodes)
}

async function getZabbixSignature(port: string | number): Promise<string> {
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
  const signature = hosts.map(h => `${h.hostid}:${deriveZabbixStatus(h.interfaces)}`).sort()
  return JSON.stringify(signature)
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

async function checkForChanges(port: string | number): Promise<void> {
  try {
    const [prometheus, proxmox, zabbix] = await Promise.all([
      getPrometheusSignature(),
      getProxmoxSignature(port),
      getZabbixSignature(port),
    ])

    const signature = JSON.stringify({ prometheus, proxmox, zabbix })

    // First check ever — establish a baseline silently. Every already-
    // connected client already fetched fresh data on mount; nudging
    // them again immediately would just be a redundant refetch with
    // nothing new to show for it.
    if (lastSignature === null) {
      lastSignature = signature
      return
    }

    if (signature !== lastSignature) {
      lastSignature = signature
      broadcastNudge()
    }
  } catch (error) {
    // A failed check (Prometheus briefly unreachable, a timeout, etc.)
    // shouldn't crash this loop or spuriously nudge every connected
    // client — skip this tick and try again on the next one. The
    // client's own 60s poll is still the fallback for exactly this
    // scenario, which is the whole reason this stays "hybrid" rather
    // than becoming the sole source of truth.
    console.error('Nudge check failed:', error)
  }
}

export function startNudgeChecker(port: string | number): void {
  setInterval(() => checkForChanges(port), NUDGE_CHECK_INTERVAL_MS)
  setInterval(sendKeepAlive, KEEPALIVE_INTERVAL_MS)
}