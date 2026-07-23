import type { Incident } from './types'

const PROXY_URL = import.meta.env.VITE_PROXY_URL ?? 'http://localhost:3001'

export async function fetchIncidents(): Promise<Incident[]> {
  const response = await fetch(`${PROXY_URL}/incidents`)

  if (!response.ok) {
    throw new Error(`Incidents request failed: ${response.status}`)
  }

  const incidents = await response.json() as Incident[]

  // Most recent first. Sorting here rather than trusting incidents.json's
  // on-disk order keeps the display order correct even if someone appends
  // a new incident to the end of the file instead of the top.
  return [...incidents].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )
}