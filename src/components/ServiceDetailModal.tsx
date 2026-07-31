import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchServiceDetail } from '../services/detail'
import type { ServiceStatus, Incident } from '../services/types'
import StatusBadge from './StatusBadge'
import MiniLineChart from './MiniLineChart'

interface ServiceDetailModalProps {
  service: ServiceStatus
  incidents: Incident[]
  onClose: () => void
}

const statusDotColor: Record<string, string> = {
  operational: 'bg-green-500',
  degraded: 'bg-yellow-500',
  outage: 'bg-red-500',
  unknown: 'bg-zinc-500',
}

function formatLogTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function ServiceDetailModal({ service, incidents, onClose }: ServiceDetailModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['serviceDetail', service.id],
    queryFn: () => fetchServiceDetail(service),
  })

  // Escape closes the modal — standard modal keyboard convention.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Focus the dialog itself on open, so keyboard/screen-reader users land
  // somewhere sensible instead of focus silently staying on whatever was
  // clicked behind the now-open modal.
  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  const relatedIncidents = incidents.filter(incident =>
    incident.affectedServices.includes(service.id)
  )

  const recentLog = data
    ? [...data.statusLog].sort((a, b) => b.timestamp - a.timestamp).slice(0, 20)
    : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="service-detail-title"
        tabIndex={-1}
        onClick={event => event.stopPropagation()}
        className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900 p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-500">{service.category}</p>
            <h2 id="service-detail-title" className="text-lg font-semibold text-zinc-100">
              {service.name}
            </h2>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={service.status} />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close detail view"
              className="text-zinc-500 hover:text-zinc-100 transition-colors text-lg leading-none"
            >
              ✕
            </button>
          </div>
        </div>

        {isLoading && (
          <p className="text-sm text-zinc-500 mt-6">Loading last 24 hours…</p>
        )}

        {isError && (
          <p className="text-sm text-red-400 mt-6">
            Couldn't load recent history for this service.
          </p>
        )}

        {data && (
          <>
            <div className="mt-6">
              <h3 className="text-xs uppercase tracking-wide text-zinc-500 mb-2">
                Response time — last 24h
              </h3>
              <MiniLineChart data={data.responseTime} />
            </div>

            <div className="mt-6">
              <h3 className="text-xs uppercase tracking-wide text-zinc-500 mb-2">
                Recent readings
              </h3>
              {recentLog.length === 0 ? (
                <p className="text-xs text-zinc-500">No recent readings yet.</p>
              ) : (
                <ol className="space-y-1.5 max-h-40 overflow-y-auto pr-2">
                  {recentLog.map((entry, index) => (
                    <li key={index} className="flex items-center gap-2 text-xs">
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDotColor[entry.status] ?? 'bg-zinc-500'}`}
                        aria-hidden="true"
                      />
                      <time className="text-zinc-500 w-32 shrink-0">
                        {formatLogTimestamp(entry.timestamp)}
                      </time>
                      <span className="text-zinc-300 capitalize">{entry.status}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </>
        )}

        {relatedIncidents.length > 0 && (
          <div className="mt-6">
            <h3 className="text-xs uppercase tracking-wide text-zinc-500 mb-2">
              Related incidents
            </h3>
            <ul className="space-y-1">
              {relatedIncidents.map(incident => (
                <li key={incident.id} className="text-xs text-zinc-300">
                  {incident.title}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}