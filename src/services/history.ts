import type { DayStatus, ServiceStatus, UptimeDay } from './types'

// Fetches real 90-day uptime history. Proxmox Nodes and Power pull from
// Prometheus range queries. Proxmox API and Zabbix have no Prometheus
// backing at all, so they're routed to the proxy's own snapshot poller
// instead — see the PROXY_URL section below. Separate from the other
// adapters in this folder on purpose — this answers "what happened over
// the last 90 days" rather than "what's the state right now," so it's
// on its own polling cadence via its own hook (useUptimeHistory) rather
// than living in the main services facade.

const PROXY_URL = import.meta.env.VITE_PROXY_URL ?? 'http://localhost:3001'
const PROMETHEUS_URL = import.meta.env.VITE_PROMETHEUS_URL ?? 'http://10.10.10.105:9090'
const HISTORY_DAYS = 90

// Anchors to actual UTC midnight rather than "right now." Without this,
// a query window built as `Date.now() - 90*86400` shifts by however many
// hours have passed since the code last ran — the sample Prometheus
// returns for "the bucket labeled July 16th" lands on a different real
// instant depending on what time of day the page happens to load, which
// means the same nominal day can show a different status run to run.
// Anchoring every step to a fixed UTC midnight makes each day's sample
// stable regardless of when the query fires.
//
// Exported as a deliberate, narrow exception to this file's usual
// export surface (see 04-Services Index) — this exact function is what
// broke in the real 07-24-2026 day-boundary bug, so it's exactly the
// kind of pure, high-bug-risk logic 18-Automated Test Coverage.md calls
// out as worth testing directly rather than only through fetchUptimeHistory.
export function utcMidnightSeconds(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 1000
}

interface PrometheusInstantResult {
  metric: Record<string, string>
  value: [number, string]
}

interface PrometheusRangeResult {
  metric: Record<string, string>
  values: [number, string][]
}

async function queryPrometheusInstant(query: string): Promise<PrometheusInstantResult[]> {
  const url = `${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(query)}`
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Prometheus query failed: ${response.status}`)
  }

  const json = await response.json()

  if (json.status !== 'success') {
    throw new Error(`Prometheus returned error: ${json.error ?? 'unknown'}`)
  }

  return json.data.result
}

async function queryPrometheusRange(
  query: string,
  startSeconds: number,
  endSeconds: number,
  stepSeconds: number
): Promise<PrometheusRangeResult[]> {
  const url =
    `${PROMETHEUS_URL}/api/v1/query_range?query=${encodeURIComponent(query)}` +
    `&start=${startSeconds}&end=${endSeconds}&step=${stepSeconds}`
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Prometheus range query failed: ${response.status}`)
  }

  const json = await response.json()

  if (json.status !== 'success') {
    throw new Error(`Prometheus range query returned error: ${json.error ?? 'unknown'}`)
  }

  return json.data.result
}

// Builds a 90-day array, oldest first, from whatever range-query results
// actually came back. Days with no matching sample — because Prometheus's
// 30-day retention doesn't reach that far back, or because of a real gap
// in scraping — get 'no-data' rather than a guessed value. This is the
// same "grey block, not a lie" behavior the placeholder version used.
//
// Exported for testing — same reasoning as utcMidnightSeconds above,
// this function's day-bucketing is the other half of the logic that
// caused the real 07-24-2026 bug.
export function buildUptimeDays(results: PrometheusRangeResult[]): UptimeDay[] {
  const valueByDate = new Map<string, string>()

  for (const series of results) {
    for (const [timestamp, value] of series.values) {
      const dateStr = new Date(timestamp * 1000).toISOString().split('T')[0]
      valueByDate.set(dateStr, value)
    }
  }

  const days: UptimeDay[] = []
  const todayUtcMidnight = utcMidnightSeconds(new Date())

  for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
    const dateStr = new Date((todayUtcMidnight - i * 86400) * 1000)
      .toISOString()
      .split('T')[0]
    const value = valueByDate.get(dateStr)

    days.push({
      date: dateStr,
      status: value === undefined ? 'no-data' : value === '1' ? 'operational' : 'outage',
    })
  }

  return days
}

// The UPS isn't a plain up/down boolean the way node_exporter is — fetchUpsStatus
// in prometheus.ts derives status from which of the OL/OB/LB flags is active,
// with LB (low battery) taking priority over OB (on battery) over OL (online).
// History needs the same priority logic, not just a single flag, or every
// on-battery day would get flattened down to a plain outage instead of
// showing as degraded.
//
// Exported for testing, same reasoning as the two functions above.
export function buildUpsUptimeDays(results: PrometheusRangeResult[]): UptimeDay[] {
  const flagsByDate = new Map<string, Set<string>>()

  for (const series of results) {
    const flag = series.metric.status
    for (const [timestamp, value] of series.values) {
      if (value !== '1') continue
      const dateStr = new Date(timestamp * 1000).toISOString().split('T')[0]
      const flags = flagsByDate.get(dateStr) ?? new Set<string>()
      flags.add(flag)
      flagsByDate.set(dateStr, flags)
    }
  }

  const days: UptimeDay[] = []
  const todayUtcMidnight = utcMidnightSeconds(new Date())

  for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
    const dateStr = new Date((todayUtcMidnight - i * 86400) * 1000)
      .toISOString()
      .split('T')[0]
    const flags = flagsByDate.get(dateStr)

    let status: DayStatus = 'no-data'
    if (flags?.has('LB')) status = 'outage'
    else if (flags?.has('OB')) status = 'degraded'
    else if (flags?.has('OL')) status = 'operational'

    days.push({ date: dateStr, status })
  }

  return days
}

async function fetchNodeInstanceHistory(instance: string): Promise<UptimeDay[]> {
  // end is tomorrow's UTC midnight (exclusive upper bound) so today's own
  // step lands exactly on today's UTC midnight, not partway through today
  // at whatever time this happens to run.
  const end = utcMidnightSeconds(new Date()) + 86400
  const start = end - HISTORY_DAYS * 86400

  const results = await queryPrometheusRange(
    `up{job="node_exporter", instance="${instance}"}`,
    start,
    end,
    86400
  )

  return buildUptimeDays(results)
}

async function fetchUpsHistory(): Promise<UptimeDay[]> {
  const end = utcMidnightSeconds(new Date()) + 86400
  const start = end - HISTORY_DAYS * 86400

  const results = await queryPrometheusRange(
    'nut_ups_status{status=~"OL|OB|LB"}',
    start,
    end,
    86400
  )

  return buildUpsUptimeDays(results)
}

// Proxmox API and Zabbix history — backed by the proxy's own snapshot
// poller (proxy/src/poller.ts, proxy/src/db.ts), not Prometheus. The
// proxy already day-buckets this server-side using the same UTC-midnight
// anchoring and "worst status of the day" rollup as everything else, so
// this is just handing back what it returns.
async function fetchProxySnapshotHistory(serviceId: string): Promise<UptimeDay[]> {
  const response = await fetch(`${PROXY_URL}/history/${serviceId}`)

  if (!response.ok) {
    throw new Error(`History request failed for ${serviceId}: ${response.status}`)
  }

  return await response.json() as UptimeDay[]
}

// Returns a map of service id -> 90-day history, for every service that
// actually has history behind it. Proxmox Nodes and Power come from
// Prometheus; Proxmox API and Zabbix come from the proxy's own snapshot
// poller. `services` is the live status list from useServiceStatus —
// passed in specifically so this function doesn't need to independently
// re-derive which Proxmox API / Zabbix ids currently exist, it just asks
// the proxy for each one's recorded history. App.tsx falls back to the
// placeholder generator for any service id not present in the returned
// map (nothing recorded yet, or a fetch failed this poll).
export async function fetchUptimeHistory(
  services: ServiceStatus[] = []
): Promise<Record<string, UptimeDay[]>> {
  const history: Record<string, UptimeDay[]> = {}

  const nodeInstances = await queryPrometheusInstant('up{job="node_exporter"}')

  const nodeResults = await Promise.allSettled(
    nodeInstances.map(async result => {
      const instance = result.metric.instance
      const days = await fetchNodeInstanceHistory(instance)
      return { instance, days }
    })
  )

  for (const result of nodeResults) {
    if (result.status === 'fulfilled') {
      history[result.value.instance] = result.value.days
    }
  }

  try {
    history['ups-cyberpower'] = await fetchUpsHistory()
  } catch {
    // UPS history unavailable this poll — App.tsx falls back to the
    // placeholder for this one id rather than failing the whole map.
  }

  const snapshotBackedServices = services.filter(
    s => s.category === 'Proxmox API' || s.category === 'Zabbix'
  )

  const snapshotResults = await Promise.allSettled(
    snapshotBackedServices.map(async service => {
      const days = await fetchProxySnapshotHistory(service.id)
      return { id: service.id, days }
    })
  )

  for (const result of snapshotResults) {
    if (result.status === 'fulfilled') {
      history[result.value.id] = result.value.days
    }
  }

  return history
}