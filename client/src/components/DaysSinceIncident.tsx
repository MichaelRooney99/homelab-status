import { useSyncExternalStore } from 'react'
import type { Incident } from '../services/types'

interface DaysSinceIncidentProps {
  incidents: Incident[]
}

// Date.now() is impure — a component's render body must be a pure
// function of props/state. useSyncExternalStore is the React-sanctioned
// way to read a value that lives outside React (the system clock, here)
// safely during render — no purity violation, and no extra cascading
// render the way a setState-in-an-effect version would cause. The
// subscribe function never actually calls back; this component already
// re-renders whenever new incident data arrives from the 60s poll,
// which is a fine cadence to refresh "how many days" against.
function subscribeToNothing() {
  return () => {}
}

function getNow() {
  return Date.now()
}

// The classic industrial-safety-sign counter, computed entirely from
// data already in hand — no new backend, no new storage. Resets to zero
// the moment any incident is non-resolved, matching the actual
// convention this is riffing on: "0 days" while something is actively
// wrong, counting again from the moment it's marked resolved.
export default function DaysSinceIncident({ incidents }: DaysSinceIncidentProps) {
  const now = useSyncExternalStore(subscribeToNothing, getNow)

  const hasActiveIncident = incidents.some(i => i.status !== 'resolved')
  const resolvedIncidents = incidents.filter(i => i.status === 'resolved')

  let value: string
  let label: string
  let colorClass: string

  if (hasActiveIncident) {
    value = '0'
    label = 'days since last incident'
    colorClass = 'text-red-400'
  } else if (resolvedIncidents.length === 0) {
    value = '—'
    label = 'no incidents recorded yet'
    colorClass = 'text-green-400'
  } else {
    const mostRecent = [...resolvedIncidents].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )[0]
    const days = Math.max(
      0,
      Math.floor((now - new Date(mostRecent.updatedAt).getTime()) / 86_400_000)
    )
    value = String(days)
    label = `day${days === 1 ? '' : 's'} since last incident`
    colorClass = 'text-green-400'
  }

  return (
    <div className="rounded-lg border border-capstone-border bg-capstone-bg-raised px-6 py-4 flex items-baseline justify-center gap-2">
      <span className={`text-2xl font-bold ${colorClass}`}>{value}</span>
      <span className="text-xs text-capstone-muted uppercase tracking-widest">{label}</span>
    </div>
  )
}