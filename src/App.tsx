import { useServiceStatus } from './hooks/useServiceStatus'
import OverallHealth from './components/OverallHealth'
import ServiceRow from './components/ServiceRow'
import type { ServiceStatus, Status, UptimeDay } from './services/types'

const CATEGORY_ORDER = [
  'Proxmox Nodes',
  'Proxmox API',
  'Power',
  'Network',
  'Services',
  'Zabbix',
]

function groupByCategory(services: ServiceStatus[]): Map<string, ServiceStatus[]> {
  const map = new Map<string, ServiceStatus[]>()

  for (const category of CATEGORY_ORDER) {
    const matches = services.filter(s => s.category === category)
    if (matches.length > 0) {
      map.set(category, matches)
    }
  }

  const uncategorized = services.filter(
    s => !CATEGORY_ORDER.includes(s.category)
  )
  if (uncategorized.length > 0) {
    map.set('Other', uncategorized)
  }

  return map
}

function generatePlaceholderDays(currentStatus: Status): UptimeDay[] {
  const days: UptimeDay[] = []
  const today = new Date()

  for (let i = 89; i >= 0; i--) {
    const date = new Date(today)
    date.setDate(today.getDate() - i)
    days.push({
      date: date.toISOString().split('T')[0],
      status: i === 0 ? currentStatus : 'no-data',
    })
  }

  return days
}

export default function App() {
  const { statusPage, isLoading, isError } = useServiceStatus()

  if (isLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <p className="text-zinc-500 text-sm">Loading status...</p>
      </div>
    )
  }

  if (isError || !statusPage) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <p className="text-red-400 text-sm">Unable to reach monitoring infrastructure.</p>
      </div>
    )
  }

  const grouped = groupByCategory(statusPage.services)
  const outageCount = statusPage.services.filter(s => s.status === 'outage').length

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-3xl mx-auto px-4 py-12 space-y-8">

        <header>
          <p className="text-xs uppercase tracking-widest text-zinc-500 mb-1">
            status.michaelrooney.dev
          </p>
          <h1 className="text-2xl font-semibold text-zinc-100">
            Homelab Status
          </h1>
        </header>

        <OverallHealth
          status={statusPage.overall}
          lastUpdated={statusPage.lastUpdated}
          serviceCount={statusPage.services.length}
          outageCount={outageCount}
        />

        {Array.from(grouped.entries()).map(([category, services]) => (
          <section key={category}>
            <h2 className="text-xs uppercase tracking-widest text-zinc-500 mb-3">
              {category}
            </h2>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-6">
              {services.map(service => (
                <ServiceRow
                  key={service.id}
                  service={service}
                  days={generatePlaceholderDays(service.status)}
                  uptimePercent={service.status === 'operational' ? 100 : undefined}
                />
              ))}
            </div>
          </section>
        ))}

        <footer className="text-xs text-zinc-600 text-center pt-4">
          Polling every 60 seconds · Built with React + TanStack Query
        </footer>

      </div>
    </div>
  )
}