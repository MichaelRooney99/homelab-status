import type { Status } from '../services/types'
import StatusBadge from './StatusBadge'

interface OverallHealthProps {
  status: Status
  lastUpdated: string
  serviceCount: number
  outageCount: number
}

const barColor: Record<Status, string> = {
  operational: 'bg-green-500',
  degraded: 'bg-yellow-500',
  outage: 'bg-red-500',
  unknown: 'bg-zinc-500',
}

const headline: Record<Status, string> = {
  operational: 'All systems operational',
  degraded: 'Partial system degradation',
  outage: 'Service disruption detected',
  unknown: 'System status unknown',
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export default function OverallHealth({
  status,
  lastUpdated,
  serviceCount,
  outageCount,
}: OverallHealthProps) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden">
      <div className={`h-1.5 w-full ${barColor[status]}`} aria-hidden="true" />
      <div className="px-6 py-5 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <StatusBadge status={status} />
          <span className="text-sm font-medium text-zinc-100">
            {headline[status]}
          </span>
        </div>
        <div className="flex items-center gap-6 text-xs text-zinc-500">
          <span>{serviceCount} services monitored</span>
          {outageCount > 0 && (
            <span className="text-red-400">{outageCount} outage{outageCount !== 1 ? 's' : ''}</span>
          )}
          <span>Updated {formatTimestamp(lastUpdated)}</span>
        </div>
      </div>
    </div>
  )
}