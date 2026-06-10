import type { UptimeDay, DayStatus } from '../services/types'

interface UptimeBarsProps {
  days: UptimeDay[]
  uptimePercent?: number
}

const dayColor: Record<DayStatus, string> = {
  operational: 'bg-green-500',
  degraded: 'bg-yellow-500',
  outage: 'bg-red-500',
  unknown: 'bg-zinc-600',
  'no-data': 'bg-zinc-800',
}

const dayLabel: Record<DayStatus, string> = {
  operational: 'Operational',
  degraded: 'Degraded',
  outage: 'Outage',
  unknown: 'Unknown',
  'no-data': 'No data',
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  })
}
//where im holding history of status for each day, so i can show a graph of the uptime over time.
//This will be used to show the uptime percentage for the last 90 days, and also to show a 
//graph of the uptime over time.
export default function UptimeBars({ days, uptimePercent }: UptimeBarsProps) {
  const paddedDays: UptimeDay[] = Array.from({ length: 90 }, (_, i) => {
    return days[i] ?? { date: '', status: 'no-data' }
  })

  return (
    <div className="mt-3">
      <div
        className="flex items-end gap-px"
        role="img"
        aria-label="90-day uptime history"
      >
        {paddedDays.map((day, index) => (
          <div
            key={index}
            className="group relative flex-1"
          >
            <div
              className={`h-8 rounded-sm ${dayColor[day.status]} opacity-90 hover:opacity-100 transition-opacity`}
            />
            {day.date && (
              <div className="
                absolute bottom-full left-1/2 -translate-x-1/2 mb-2
                bg-zinc-800 border border-zinc-700 rounded px-2 py-1
                text-xs text-zinc-200 whitespace-nowrap
                opacity-0 group-hover:opacity-100
                transition-opacity pointer-events-none z-10
              ">
                <span className="font-medium">{formatDate(day.date)}</span>
                <span className="text-zinc-400 ml-1">— {dayLabel[day.status]}</span>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="flex justify-between items-center mt-1.5">
        <span className="text-xs text-zinc-600">90 days ago</span>
        {uptimePercent !== undefined && (
          <span className="text-xs text-zinc-500">
            <span className={uptimePercent === 100 ? 'text-green-400' : 'text-yellow-400'}>
              {uptimePercent.toFixed(2)}%
            </span>
            {' '}uptime
          </span>
        )}
        <span className="text-xs text-zinc-600">Today</span>
      </div>
    </div>
  )
}