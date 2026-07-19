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

// 100% is the only case that reads as fully healthy. Below that, the
// severity should match what the bars themselves are showing — a real
// outage day should read red here too, not the same yellow as a minor
// blip. >=99% covers a single bad day out of ~90 without over-alarming;
// anything worse than that is a red uptime percent, matching the red
// bars a viewer would see if they scanned the row itself.
function uptimeColor(percent: number): string {
  if (percent === 100) return 'text-green-400'
  if (percent >= 99) return 'text-yellow-400'
  return 'text-red-400'
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
        aria-label={
          uptimePercent !== undefined
            ? `90-day uptime history: ${uptimePercent.toFixed(2)}% uptime`
            : '90-day uptime history'
        }
      >
        {paddedDays.map((day, index) => {
          // Bars near either edge get their tooltip anchored to that edge
          // instead of centered — a centered tooltip on the first or last
          // bar overflows off-screen on narrow viewports, since the bar
          // itself is only a few pixels wide with 90 packed into one row.
          const isNearStart = index < 5
          const isNearEnd = index > paddedDays.length - 6
          const tooltipPosition = isNearStart
            ? 'left-0 translate-x-0'
            : isNearEnd
            ? 'right-0 left-auto translate-x-0'
            : 'left-1/2 -translate-x-1/2'

          return (
            <div
              key={index}
              className="group relative flex-1"
              tabIndex={day.date ? 0 : -1}
            >
              <div
                className={`h-8 rounded-sm ${dayColor[day.status]} opacity-90 hover:opacity-100 group-focus:opacity-100 group-focus:ring-2 group-focus:ring-zinc-400 transition-opacity outline-none`}
                title={day.date ? `${formatDate(day.date)} — ${dayLabel[day.status]}` : undefined}
              />
              {day.date && (
                <div className={`
                  absolute bottom-full mb-2 ${tooltipPosition}
                  bg-zinc-800 border border-zinc-700 rounded px-2 py-1
                  text-xs text-zinc-200 whitespace-nowrap
                  opacity-0 group-hover:opacity-100 group-focus:opacity-100
                  transition-opacity pointer-events-none z-10
                `}>
                  <span className="font-medium">{formatDate(day.date)}</span>
                  <span className="text-zinc-400 ml-1">— {dayLabel[day.status]}</span>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="flex justify-between items-center mt-1.5">
        <span className="text-xs text-zinc-600">90 days ago</span>
        {uptimePercent !== undefined && (
          <span className="text-xs text-zinc-500">
            <span className={uptimeColor(uptimePercent)}>
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