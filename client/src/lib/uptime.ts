import type { UptimeDay } from '../services/types'

// Percent of days WITH data that were operational — 'no-data' days are
// excluded from the denominator rather than counted against the service,
// since they mean "Prometheus retention doesn't reach that far," not
// "this service was down." Returns undefined if every day is no-data
// (e.g. brand new service, nothing to compute a percent from yet).
//
// Lives in its own file rather than inside App.tsx — a file that
// exports both a React component and a plain function breaks Vite's
// Fast Refresh (react-refresh/only-export-components), since Fast
// Refresh can only safely hot-reload a module that exports components
// alone. This also makes the function testable without importing
// App.tsx's component tree at all.
export function calculateUptimePercent(days: UptimeDay[]): number | undefined {
  const withData = days.filter(d => d.status !== 'no-data')
  if (withData.length === 0) return undefined

  const operational = withData.filter(d => d.status === 'operational').length
  return (operational / withData.length) * 100
}