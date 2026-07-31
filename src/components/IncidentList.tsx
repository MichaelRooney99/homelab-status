import { useEffect, useRef, useState } from 'react'
import type { Incident } from '../services/types'
import IncidentBadge from './IncidentBadge'

interface IncidentListProps {
  incidents: Incident[]
  focusId?: string | null
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-4 h-4 text-zinc-500 transition-transform duration-150 shrink-0 ${open ? 'rotate-180' : ''}`}
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M5 7.5L10 12.5L15 7.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IncidentCard({ incident, forceOpen }: { incident: Incident; forceOpen: boolean }) {
  // Active incidents default open — a visitor should see what's currently
  // wrong without an extra click. Resolved incidents default collapsed —
  // history stays accessible but doesn't take up space once it's settled.
  const [isOpen, setIsOpen] = useState(incident.status !== 'resolved')
  const [prevForceOpen, setPrevForceOpen] = useState(forceOpen)
  const cardRef = useRef<HTMLDivElement>(null)
  const panelId = `incident-updates-${incident.id}`

  // Adjusting state during render, not inside an effect — this is the
  // pattern React's own docs recommend for "a prop changed, sync some
  // state to it" (see "Adjusting some state when a prop changes"), as
  // opposed to an effect whose body calls setState synchronously and
  // triggers a cascading extra render (the exact rule this tripped:
  // react-hooks/set-state-in-effect). Comparing against the tracked
  // previous value means this only reacts the moment forceOpen flips to
  // true — a fresh palette selection — not on every render where it
  // simply happens to already be true.
  if (forceOpen !== prevForceOpen) {
    setPrevForceOpen(forceOpen)
    if (forceOpen) {
      setIsOpen(true)
    }
  }

  // Scrolling the card into view is a real external-system interaction
  // (imperative DOM call), not a setState — this part legitimately
  // belongs in an effect.
  useEffect(() => {
    if (forceOpen) {
      cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [forceOpen])

  return (
    <div ref={cardRef} className="rounded-lg border border-zinc-800 bg-zinc-900 px-6 py-5">
      <button
        type="button"
        onClick={() => setIsOpen(open => !open)}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className="flex items-start justify-between gap-4 flex-wrap w-full text-left"
      >
        <span className="flex items-center gap-2">
          <ChevronIcon open={isOpen} />
          <h3 className="text-sm font-medium text-zinc-100">{incident.title}</h3>
        </span>
        <IncidentBadge status={incident.status} />
      </button>

      {isOpen && (
        <ol id={panelId} className="mt-4 space-y-3 border-l border-zinc-800 pl-4">
          {incident.updates.map((update, index) => (
            <li key={index} className="text-xs">
              <time className="text-zinc-500" dateTime={update.timestamp}>
                {formatTimestamp(update.timestamp)}
              </time>
              <p className="text-zinc-300 mt-0.5">{update.message}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

// Renders nothing at all when there are no incidents, rather than an
// empty "Incident History" header with nothing under it — matches
// ServiceRow's reasoning for hiding UptimeBars when there's no data to
// show: an empty section header reads as a bug, not a section that
// legitimately has nothing to say right now.
export default function IncidentList({ incidents, focusId = null }: IncidentListProps) {
  if (incidents.length === 0) return null

  return (
    <section>
      <h2 className="text-xs uppercase tracking-widest text-zinc-500 mb-3">
        Incident History
      </h2>
      <div className="space-y-4">
        {incidents.map(incident => (
          <IncidentCard
            key={incident.id}
            incident={incident}
            forceOpen={incident.id === focusId}
          />
        ))}
      </div>
    </section>
  )
}