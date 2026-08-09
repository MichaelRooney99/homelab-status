import type { ServiceStatus } from './types'

const PROXY_URL = import.meta.env.VITE_PROXY_URL ?? 'http://localhost:3001'
const PROMETHEUS_URL = import.meta.env.VITE_PROMETHEUS_URL ?? 'http://10.10.10.105:9090'

export interface DetailPoint {
  timestamp: number
  value: number
}

export interface DetailLogEntry {
  timestamp: number
  status: string
}

export interface ServiceDetail {
  statusLog: DetailLogEntry[]
  responseTime: DetailPoint[]
}

interface PrometheusRangeResult {
  metric: Record<string, string>
  values: [number, string][]
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
    throw new Error(`Prometheus range query error: ${json.error ?? 'unknown'}`)
  }

  return json.data.result
}

const RECENT_HOURS = 24
// 5-minute resolution over 24h — ~288 points. Fine enough to show real
// shape in a chart without being an excessive number of points to
// render or an excessive number of samples to ask Prometheus for.
const RECENT_STEP_SECONDS = 5 * 60

async function fetchPrometheusNodeDetail(instance: string): Promise<ServiceDetail> {
  const end = Math.floor(Date.now() / 1000)
  const start = end - RECENT_HOURS * 3600

  const [statusResults, durationResults] = await Promise.all([
    queryPrometheusRange(
      `up{job="node_exporter", instance="${instance}"}`,
      start,
      end,
      RECENT_STEP_SECONDS
    ),
    queryPrometheusRange(
      `scrape_duration_seconds{job="node_exporter", instance="${instance}"}`,
      start,
      end,
      RECENT_STEP_SECONDS
    ),
  ])

  const statusLog: DetailLogEntry[] = (statusResults[0]?.values ?? []).map(
    ([timestamp, value]) => ({
      timestamp,
      status: value === '1' ? 'operational' : 'outage',
    })
  )

  // Prometheus reports scrape duration in seconds — converted to ms to
  // match the unit the poller-backed categories record in, so the chart
  // component doesn't need to know or care which source a reading came
  // from.
  const responseTime: DetailPoint[] = (durationResults[0]?.values ?? []).map(
    ([timestamp, value]) => ({
      timestamp,
      value: parseFloat(value) * 1000,
    })
  )

  return { statusLog, responseTime }
}

async function fetchPrometheusUpsDetail(): Promise<ServiceDetail> {
  const end = Math.floor(Date.now() / 1000)
  const start = end - RECENT_HOURS * 3600

  const [statusResults, durationResults] = await Promise.all([
    queryPrometheusRange('nut_ups_status{status=~"OL|OB|LB"}', start, end, RECENT_STEP_SECONDS),
    queryPrometheusRange('scrape_duration_seconds{job="nut"}', start, end, RECENT_STEP_SECONDS),
  ])

  // Same flag-priority logic as the 90-day history version — LB worst,
  // then OB, then OL — applied per-reading instead of per-day, since
  // this is a raw log, not a rolled-up bucket.
  const flagsByTimestamp = new Map<number, Set<string>>()

  for (const series of statusResults) {
    const flag = series.metric.status
    for (const [timestamp, value] of series.values) {
      if (value !== '1') continue
      const flags = flagsByTimestamp.get(timestamp) ?? new Set<string>()
      flags.add(flag)
      flagsByTimestamp.set(timestamp, flags)
    }
  }

  const statusLog: DetailLogEntry[] = Array.from(flagsByTimestamp.entries()).map(
    ([timestamp, flags]) => {
      let status = 'unknown'
      if (flags.has('LB')) status = 'outage'
      else if (flags.has('OB')) status = 'degraded'
      else if (flags.has('OL')) status = 'operational'
      return { timestamp, status }
    }
  )

  const responseTime: DetailPoint[] = (durationResults[0]?.values ?? []).map(
    ([timestamp, value]) => ({
      timestamp,
      value: parseFloat(value) * 1000,
    })
  )

  return { statusLog, responseTime }
}

interface RawSnapshotRow {
  timestamp: number
  status: string
  response_time_ms: number | null
}

async function fetchProxySnapshotDetail(serviceId: string): Promise<ServiceDetail> {
  const response = await fetch(`${PROXY_URL}/history/${serviceId}/recent`)

  if (!response.ok) {
    throw new Error(`Recent history request failed for ${serviceId}: ${response.status}`)
  }

  const rows = await response.json() as RawSnapshotRow[]

  const statusLog: DetailLogEntry[] = rows.map(row => ({
    timestamp: row.timestamp,
    status: row.status,
  }))

  const responseTime: DetailPoint[] = rows
    .filter((row): row is RawSnapshotRow & { response_time_ms: number } => row.response_time_ms !== null)
    .map(row => ({ timestamp: row.timestamp, value: row.response_time_ms }))

  return { statusLog, responseTime }
}

// Branches by category, same idea history.ts already uses for the
// 90-day view — Prometheus for the two categories it backs directly,
// the proxy's own raw-snapshot route for the two the background poller
// backs. This is that same split at 24-hour, per-reading granularity
// instead of 90-day, per-day granularity.
export async function fetchServiceDetail(service: ServiceStatus): Promise<ServiceDetail> {
  if (service.category === 'Proxmox Nodes') {
    return fetchPrometheusNodeDetail(service.id)
  }

  if (service.category === 'Power') {
    return fetchPrometheusUpsDetail()
  }

  // Proxmox API and Zabbix — both backed by the proxy's own poller
  return fetchProxySnapshotDetail(service.id)
}