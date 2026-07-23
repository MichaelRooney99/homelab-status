import type { IncidentStatus } from '../services/types'

interface IncidentBadgeProps {
  status: IncidentStatus
}

const incidentConfig: Record<IncidentStatus, { label: string; dot: string; badge: string }> = {
  investigating: {
    label: 'Investigating',
    dot: 'bg-red-500',
    badge: 'bg-red-500/10 text-red-400 border-red-500/20',
  },
  identified: {
    label: 'Identified',
    dot: 'bg-orange-500',
    badge: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  },
  monitoring: {
    label: 'Monitoring',
    dot: 'bg-yellow-500',
    badge: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  },
  resolved: {
    label: 'Resolved',
    dot: 'bg-green-500',
    badge: 'bg-green-500/10 text-green-400 border-green-500/20',
  },
}

export default function IncidentBadge({ status }: IncidentBadgeProps) {
  const config = incidentConfig[status]

  // Only pulse for states that are still actively changing. A resolved
  // incident pulsing forever on a historical list reads as "something is
  // still happening" — StatusBadge always pulses because live status can
  // always change again, but a resolved incident is a closed record, not
  // a live reading, so it should look settled.
  const isActive = status !== 'resolved'

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${config.badge}`}
      role="status"
      aria-label={config.label}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${config.dot} ${isActive ? 'animate-pulse' : ''}`}
        aria-hidden="true"
      />
      {config.label}
    </span>
  )
}