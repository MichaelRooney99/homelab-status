import type { ServiceStatus, UptimeDay } from '../services/types'
import StatusBadge from './StatusBadge'
import UptimeBars from './UptimeBars'

interface ServiceRowProps {
  service: ServiceStatus
  days?: UptimeDay[]
  uptimePercent?: number
  onSelect?: (service: ServiceStatus) => void
}

function MetadataDisplay({ metadata }: { metadata: Record<string, string> }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
      {Object.entries(metadata).map(([key, value]) => (
        <span key={key} className="text-xs text-capstone-muted">
          <span className="text-capstone-muted capitalize">
            {key.replace(/([A-Z])/g, ' $1').trim()}
          </span>
          {': '}
          {value}
        </span>
      ))}
    </div>
  )
}

export default function ServiceRow({ service, days, uptimePercent, onSelect }: ServiceRowProps) {
  const header = (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-capstone-text">{service.name}</span>
          <span className="text-xs text-capstone-muted uppercase tracking-wide">
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
  )

  return (
    <div className="py-4 border-b border-capstone-border last:border-0">
      {onSelect ? (
        // Click target scoped to the header only, not the whole row —
        // UptimeBars has its own focusable bars (tabIndex on each one,
        // from the earlier keyboard-accessibility pass), and nesting
        // that inside another interactive wrapper would force a keyboard
        // user to tab through all 90 bar segments just to get past one
        // service row.
        <button
          type="button"
          onClick={() => onSelect(service)}
          className="w-full text-left hover:bg-capstone-subtle/50 transition-colors rounded-sm -mx-2 -my-1 px-2 py-1"
          aria-label={`View details for ${service.name}`}
        >
          {header}
        </button>
      ) : (
        header
      )}
      {days && days.length > 0 && (
        <UptimeBars days={days} uptimePercent={uptimePercent} /> //only show if we have data for the uptime bars, otherwise it just looks like a gap between services which is confusing
      )}
    </div>
  )
}