import { useState } from 'react'
import { useServiceStatus } from './hooks/useServiceStatus'
import { useUptimeHistory } from './hooks/useUptimeHistory'
import { useTabAlert } from './hooks/useTabAlert'
import { useCommandPalette } from './hooks/useCommandPalette'
import { useLiveNudge } from './hooks/useLiveNudge'
import { calculateUptimePercent } from './lib/uptime'
import OverallHealth from './components/OverallHealth'
import ServiceRow from './components/ServiceRow'
import IncidentList from './components/IncidentList'
import DaysSinceIncident from './components/DaysSinceIncident'
import SkeletonHealth from './components/SkeletonHealth'
import SkeletonServiceRow from './components/SkeletonServiceRow'
import ThemeToggle from './components/ThemeToggle'
import ServiceDetailModal from './components/ServiceDetailModal'
import CommandPalette from './components/CommandPalette'
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
  const { history } = useUptimeHistory(statusPage?.services ?? [])
  useTabAlert(statusPage)
  useLiveNudge()
  const [selectedService, setSelectedService] = useState<ServiceStatus | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
  const [focusIncidentId, setFocusIncidentId] = useState<string | null>(null)

  // Disabled while the detail modal is already open — avoids stacking
  // two modals on top of each other from a single keypress.
  const commandPalette = useCommandPalette(Boolean(selectedService))

  if (isLoading) {
    return (
      <div className="min-h-screen bg-capstone-bg text-capstone-text">
        <div
          className="max-w-3xl mx-auto px-4 py-12 space-y-8"
          role="status"
          aria-live="polite"
        >
          <span className="sr-only">Loading status...</span>

          <header>
            <div className="h-3 w-40 bg-capstone-subtle rounded mb-2 animate-pulse" />
            <div className="h-7 w-56 bg-capstone-subtle rounded animate-pulse" />
          </header>

          <SkeletonHealth />

          <div className="rounded-lg border border-capstone-border bg-capstone-bg-raised px-6">
            <SkeletonServiceRow />
            <SkeletonServiceRow />
            <SkeletonServiceRow />
          </div>
        </div>
      </div>
    )
  }

  if (isError || !statusPage) {
    return (
      <div className="min-h-screen bg-capstone-bg flex items-center justify-center">
        <p className="text-red-400 text-sm" role="alert">
          Unable to reach monitoring infrastructure.
        </p>
      </div>
    )
  }

  const grouped = groupByCategory(statusPage.services)
  const outageCount = statusPage.services.filter(s => s.status === 'outage').length

  const visibleGroups =
    categoryFilter && grouped.has(categoryFilter)
      ? new Map([[categoryFilter, grouped.get(categoryFilter)!]])
      : grouped

  const categoryCounts = Array.from(grouped.entries()).map(([name, services]) => ({
    name,
    count: services.length,
  }))

  return (
    <div className="min-h-screen bg-capstone-bg text-capstone-text">
      <div className="max-w-3xl mx-auto px-4 py-12 space-y-8">

        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-capstone-muted mb-1">
              status.michaelrooney.dev
            </p>
            <h1 className="text-2xl font-serif text-capstone-text">
              Homelab Status
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={commandPalette.open}
              aria-label="Open command palette"
              className="flex items-center gap-1.5 text-xs text-capstone-muted border border-capstone-border rounded px-2 py-1.5 hover:text-capstone-text hover:border-capstone-muted transition-colors"
            >
              <span className="hidden sm:inline">Jump to…</span>
              <kbd className="font-sans">⌘K</kbd>
            </button>
            <ThemeToggle />
          </div>
        </header>

        <OverallHealth
          status={statusPage.overall}
          lastUpdated={statusPage.lastUpdated}
          serviceCount={statusPage.services.length}
          outageCount={outageCount}
        />

        <DaysSinceIncident incidents={statusPage.incidents} />

        <IncidentList incidents={statusPage.incidents} focusId={focusIncidentId} />

        {categoryFilter && (
          <div className="flex items-center justify-between rounded-lg border border-capstone-border bg-capstone-bg-raised px-4 py-2 text-xs text-capstone-muted">
            <span>
              Filtered to <span className="text-capstone-text">{categoryFilter}</span>
            </span>
            <button
              type="button"
              onClick={() => setCategoryFilter(null)}
              className="text-capstone-muted hover:text-capstone-text underline underline-offset-2"
            >
              Clear
            </button>
          </div>
        )}

        {Array.from(visibleGroups.entries()).map(([category, services]) => (
          <section key={category}>
            <h2 className="font-serif text-sm uppercase tracking-widest text-capstone-accent mb-3">
              {category}
            </h2>
            <div className="rounded-lg border border-capstone-border bg-capstone-bg-raised px-6">
              {services.map(service => {
                const realHistory = history[service.id]
                const days = realHistory ?? generatePlaceholderDays(service.status)
                const uptimePercent = realHistory
                  ? calculateUptimePercent(realHistory)
                  : service.status === 'operational' ? 100 : undefined

                return (
                  <ServiceRow
                    key={service.id}
                    service={service}
                    days={days}
                    uptimePercent={uptimePercent}
                    onSelect={setSelectedService}
                  />
                )
              })}
            </div>
          </section>
        ))}

        <footer className="text-xs text-capstone-muted text-center pt-4">
          Polling every 60 seconds · Built with React + TanStack Query
        </footer>

      </div>

      {selectedService && (
        <ServiceDetailModal
          service={selectedService}
          incidents={statusPage.incidents}
          onClose={() => setSelectedService(null)}
        />
      )}

      {commandPalette.isOpen && (
        <CommandPalette
          services={statusPage.services}
          categories={categoryCounts}
          incidents={statusPage.incidents}
          onClose={commandPalette.close}
          onSelectService={setSelectedService}
          onSelectCategory={setCategoryFilter}
          onSelectIncident={setFocusIncidentId}
        />
      )}
    </div>
  )
}