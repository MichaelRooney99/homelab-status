import type { DayStatus, UptimeDay } from './types'

// Fetches real 90-day uptime history from Prometheus range queries.
// Separate from the other adapters in this folder on purpose — this
// answers "what happened over the last 90 days" rather than "what's the
// state right now," so it's on its own polling cadence via its own hook
// (useUptimeHistory) rather than living in the main services facade.

const PROMETHEUS_URL = import.meta.env.VITE_PROMETHEUS_URL ?? 'http://10.10.10.105:9090'
const HISTORY_DAYS = 90

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
function buildUptimeDays(results: PrometheusRangeResult[]): UptimeDay[] {
  const valueByDate = new Map<string, string>()

  for (const series of results) {
    for (const [timestamp, value] of series.values) {
      const dateStr = new Date(timestamp * 1000).toISOString().split('T')[0]
      valueByDate.set(dateStr, value)
    }
  }

  const today = new Date()
  const days: UptimeDay[] = []

  for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
    const date = new Date(today)
    date.setDate(today.getDate() - i)
    const dateStr = date.toISOString().split('T')[0]
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
function buildUpsUptimeDays(results: PrometheusRangeResult[]): UptimeDay[] {
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

  const today = new Date()
  const days: UptimeDay[] = []

  for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
    const date = new Date(today)
    date.setDate(today.getDate() - i)
    const dateStr = date.toISOString().split('T')[0]
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
  const end = Math.floor(Date.now() / 1000)
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
  const end = Math.floor(Date.now() / 1000)
  const start = end - HISTORY_DAYS * 86400

  const results = await queryPrometheusRange(
    'nut_ups_status{status=~"OL|OB|LB"}',
    start,
    end,
    86400
  )

  return buildUpsUptimeDays(results)
}

// Returns a map of service id -> 90-day history, for every service that
// actually has a Prometheus time series behind it. Proxmox API and Zabbix
// services are deliberately absent from this map — their adapters only
// ever see current state, there's no range query that could answer for
// them. App.tsx falls back to the placeholder generator for any service
// id not present here.
export async function fetchUptimeHistory(): Promise<Record<string, UptimeDay[]>> {
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

  return history
}