import type { Incident } from '../services/types'
import IncidentBadge from './IncidentBadge'

interface IncidentListProps {
  incidents: Incident[]
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function IncidentCard({ incident }: { incident: Incident }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-6 py-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <h3 className="text-sm font-medium text-zinc-100">{incident.title}</h3>
        <IncidentBadge status={incident.status} />
      </div>

      <ol className="mt-4 space-y-3 border-l border-zinc-800 pl-4">
        {incident.updates.map((update, index) => (
          <li key={index} className="text-xs">
            <time className="text-zinc-500" dateTime={update.timestamp}>
              {formatTimestamp(update.timestamp)}
            </time>
            <p className="text-zinc-300 mt-0.5">{update.message}</p>
          </li>
        ))}
      </ol>
    </div>
  )
}

// Renders nothing at all when there are no incidents, rather than an
// empty "Incident History" header with nothing under it — matches
// ServiceRow's reasoning for hiding UptimeBars when there's no data to
// show: an empty section header reads as a bug, not a section that
// legitimately has nothing to say right now.
export default function IncidentList({ incidents }: IncidentListProps) {
  if (incidents.length === 0) return null

  return (
    <section>
      <h2 className="text-xs uppercase tracking-widest text-zinc-500 mb-3">
        Incident History
      </h2>
      <div className="space-y-4">
        {incidents.map(incident => (
          <IncidentCard key={incident.id} incident={incident} />
        ))}
      </div>
    </section>
  )
}