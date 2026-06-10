import type { ServiceStatus, UptimeDay } from '../services/types'
import StatusBadge from './StatusBadge'
import UptimeBars from './UptimeBars'

interface ServiceRowProps {
  service: ServiceStatus
  days?: UptimeDay[]
  uptimePercent?: number
}

function MetadataDisplay({ metadata }: { metadata: Record<string, string> }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
      {Object.entries(metadata).map(([key, value]) => (
        <span key={key} className="text-xs text-zinc-500">
          <span className="text-zinc-400 capitalize">
            {key.replace(/([A-Z])/g, ' $1').trim()}
          </span>
          {': '}
          {value}
        </span>
      ))}
    </div>
  )
}

export default function ServiceRow({ service, days, uptimePercent }: ServiceRowProps) {
  return (
    <div className="py-4 border-b border-zinc-800 last:border-0">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-zinc-100">{service.name}</span>
            <span className="text-xs text-zinc-600 uppercase tracking-wide">
              {service.category}
            </span>
          </div>
          {service.metadata && Object.keys(service.metadata).length > 0 && (
            <MetadataDisplay metadata={service.metadata} />
          )}
        </div>
        <div className="shrink-0">
          <StatusBadge status={service.status} />
        </div>
      </div>
      {days && days.length > 0 && (
        <UptimeBars days={days} uptimePercent={uptimePercent} /> //only show if we have data for the uptime bars, otherwise it just looks like a gap between services which is confusing
      )}
    </div>
  )
}