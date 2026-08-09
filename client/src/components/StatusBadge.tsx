import type { Status } from '../services/types'

interface StatusBadgeProps {
  status: Status
}

const statusConfig: Record<Status, { label: string; dot: string; badge: string }> = {
  operational: {
    label: 'Operational',
    dot: 'bg-green-500',
    badge: 'bg-green-500/10 text-green-400 border-green-500/20',
  },
  degraded: {
    label: 'Degraded',
    dot: 'bg-yellow-500',
    badge: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  },
  outage: {
    label: 'Outage',
    dot: 'bg-red-500',
    badge: 'bg-red-500/10 text-red-400 border-red-500/20',
  },
  unknown: {
    label: 'Unknown',
    dot: 'bg-zinc-500',
    badge: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
  },
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status]

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${config.badge}`}
      role="status"
      aria-label={config.label}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${config.dot} animate-pulse`}
        aria-hidden="true"
      />
      {config.label}
    </span>
  )
}