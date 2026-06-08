import type { ServiceStatus, Status } from './types'

const PROMETHEUS_URL = import.meta.env.VITE_PROMETHEUS_URL ?? 'http://10.10.10.105:9090' //local prometheus instance running in docker on the homelab server

async function queryPrometheus(query: string): Promise<any> {
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