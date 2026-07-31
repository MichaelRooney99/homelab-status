import type { DetailPoint } from '../services/detail'

interface MiniLineChartProps {
  data: DetailPoint[]
}

const WIDTH = 600
const HEIGHT = 96
const PADDING = 8

// Hand-rolled, matching UptimeBars' precedent of avoiding a charting
// library for a visualization this simple — a 24h line doesn't need
// axis auto-scaling, zoom, or any of what a real charting library gives
// you, just a polyline against two normalized axes.
export default function MiniLineChart({ data }: MiniLineChartProps) {
  if (data.length === 0) {
    return (
      <div className="h-24 flex items-center justify-center text-xs text-zinc-500">
        No response-time data yet
      </div>
    )
  }

  const values = data.map(d => d.value)
  const minValue = Math.min(...values)
  const maxValue = Math.max(...values)
  const valueRange = maxValue - minValue || 1

  const timestamps = data.map(d => d.timestamp)
  const minTime = Math.min(...timestamps)
  const maxTime = Math.max(...timestamps)
  const timeRange = maxTime - minTime || 1

  const points = data
    .map(d => {
      const x = PADDING + ((d.timestamp - minTime) / timeRange) * (WIDTH - PADDING * 2)
      const y =
        HEIGHT - PADDING - ((d.value - minValue) / valueRange) * (HEIGHT - PADDING * 2)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  const latest = data[data.length - 1]

  return (
    <div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-24"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Response time over the last 24 hours, currently ${latest.value.toFixed(0)} milliseconds`}
      >
        <polyline
          points={points}
          fill="none"
          stroke="#c8622a"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <div className="flex justify-between text-xs text-zinc-500 mt-1">
        <span>{minValue.toFixed(0)}ms</span>
        <span className="text-zinc-300">Latest: {latest.value.toFixed(0)}ms</span>
        <span>{maxValue.toFixed(0)}ms</span>
      </div>
    </div>
  )
}