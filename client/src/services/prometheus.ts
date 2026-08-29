import type { ServiceStatus, Status } from './types'

interface PrometheusResult {
  metric: Record<string, string>
  value: [number, string]
}
const PROMETHEUS_URL = import.meta.env.VITE_PROMETHEUS_URL ?? 'http://10.10.10.105:9090'
// Falls back to the LAN Prometheus instance directly for local dev.
// In production VITE_PROMETHEUS_URL is baked to a same-origin
// '/prometheus' path at build time, which nginx forwards to this
// same proxy's own allowlisted route — same BFF boundary as the
// Proxmox/Zabbix adapters below, just reached via build-time env
// substitution instead of a hardcoded proxy call.

async function queryPrometheus(query: string): Promise<PrometheusResult[]> {
  const url = `${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(query)}`
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Prometheus query failed: ${response.status}`) //network error or non-2xx response
  }

  const json = await response.json()

  if (json.status !== 'success') {
    throw new Error(`Prometheus returned error: ${json.error ?? 'unknown'}`) //prometheus returned an error response
  }

  return json.data.result
}

// Three independent PromQL queries — 'up' for liveness, then CPU and
// memory usage — run in parallel and joined on Prometheus's own
// 'instance' label. Liveness alone drives the operational/outage
// verdict; CPU and memory ride alongside purely as display metadata,
// not as inputs to the status itself.
export async function fetchNodeStatus(): Promise<ServiceStatus[]> {
  const [upResults, cpuResults, memResults] = await Promise.all([
    queryPrometheus('up{job="node_exporter"}'),
    queryPrometheus('100 - (avg by (instance, friendly_name) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)'),
    queryPrometheus('100 * (1 - ((avg_over_time(node_memory_MemFree_bytes[5m]) + avg_over_time(node_memory_Cached_bytes[5m]) + avg_over_time(node_memory_Buffers_bytes[5m])) / avg_over_time(node_memory_MemTotal_bytes[5m])))'),
  ])

  const cpuMap = new Map<string, string>()
  const memMap = new Map<string, string>()

  for (const result of cpuResults) {
    const instance = result.metric.instance
    const value = parseFloat(result.value[1]).toFixed(1)
    cpuMap.set(instance, value)
  }

  for (const result of memResults) {
    const instance = result.metric.instance
    const value = parseFloat(result.value[1]).toFixed(1)
    memMap.set(instance, value)
  }

  // Now we have maps of CPU and memory usage by instance, we can combine that with the 'up' results to create our ServiceStatus objects.
  return upResults.map((result: PrometheusResult): ServiceStatus => {
    const instance = result.metric.instance
    const friendlyName = result.metric.friendly_name ?? instance
    const isUp = result.value[1] === '1'

    return {
      id: instance,
      name: friendlyName,
      category: 'Proxmox Nodes',
      status: isUp ? 'operational' : 'outage',
      metadata: {
        cpu: `${cpuMap.get(instance) ?? '—'}%`,
        memory: `${memMap.get(instance) ?? '—'}%`,
      },
    }
  })
}

// Similar to the above, but for UPS status using NUT exporter metrics. prometheus already pulls data from NUT, so we just need to query the relevant metrics and shape them into ServiceStatus objects.
export async function fetchUpsStatus(): Promise<ServiceStatus[]> {
  const [statusResults, runtimeResults, loadResults] = await Promise.all([
    queryPrometheus('nut_ups_status'),
    queryPrometheus('nut_battery_runtime_seconds'),
    queryPrometheus('nut_load'),
  ])

  const activeFlags: string[] = []
  for (const result of statusResults) {
    if (result.value[1] === '1') {
      activeFlags.push(result.metric.status)// label key is 'status' not 'flag' — varies by nut_exporter version
    }
  }

  const isOnBattery = activeFlags.includes('OB')
  const isLowBattery = activeFlags.includes('LB')
  const isOnline = activeFlags.includes('OL')

  let status: Status = 'unknown'
  if (isLowBattery) status = 'outage'
  else if (isOnBattery) status = 'degraded'
  else if (isOnline) status = 'operational'

  const runtimeSeconds = runtimeResults[0]
    ? parseFloat(runtimeResults[0].value[1])
    : null
  const runtimeMinutes = runtimeSeconds !== null
    ? `${Math.floor(runtimeSeconds / 60)}m`
    : '—'

  const loadRatio = loadResults[0]
    ? parseFloat(loadResults[0].value[1])
    : null
  const loadPercent = loadRatio !== null
    ? `${(loadRatio * 100).toFixed(0)}%`
    : '—'

  return [{
    id: 'ups-cyberpower',
    name: 'CyberPower UPS',
    category: 'Power',
    status,
    metadata: {
      flags: activeFlags.join(', '),
      runtime: runtimeMinutes,
      load: loadPercent,
    },
  }]
}
