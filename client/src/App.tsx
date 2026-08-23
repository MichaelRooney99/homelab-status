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

// Fixed display order, not alphabetical and not source order — mirrors
// the real order infrastructure gets checked in practice (compute
// first, then the API layer in front of it, then power, then network,
// then everything else). A category not in this list still renders —
// grouped into a trailing "Other" bucket below — rather than silently
// dropped, so a new category showing up in the data can never
// disappear from the page just because nobody remembered to add it here.
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

  // Anything not in CATEGORY_ORDER above lands here instead of being
  // silently excluded from the page.
  const uncategorized = services.filter(
    s => !CATEGORY_ORDER.includes(s.category)
  )
  if (uncategorized.length > 0) {
    map.set('Other', uncategorized)
  }

  return map
}

// Fallback for the two categories (Proxmox API, Zabbix) that have no
// Prometheus-backed 90-day history — their real history comes from the
// proxy's own snapshot poller instead, which only has data going back to
// whenever it first started recording. Rather than showing an empty
// uptime bar for those services until 90 days of real data accumulates,
// this fabricates a 90-day array where every day except today is
// 'no-data' and today reflects whatever the service's live status
// actually is right now. useUptimeHistory returns real data once it
// exists; this only fires as the placeholder before that, via the
// `realHistory ?? generatePlaceholderDays(...)` fallback below.
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
      <div className="max-w-3xl md:max-w-5xl lg:max-w-7xl mx-auto px-4 py-12 space-y-8">
        
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
{/*
  Two-column layout at md (768px) and up:
    - Left: OverallHealth (full-width, above the split) + main content
      column (category filter chip + every category section)
    - Right: one aside column, DaysSinceIncident and IncidentList
      stacked together as a single unit — not split into separate
      sub-columns.

  Below md: single stacked column, with the aside content appearing
  above the category sections. That order comes from md:order-2/
  md:order-1 rather than moving the aside's markup position, so
  CommandPalette's incident scrollIntoView still targets the same DOM
  element regardless of layout — only the final scroll position
  changes.

  Aside width: 280px at md (tablet), widening to 340px at lg (desktop)
  via the second grid-cols/gap override — a tablet gets a tighter
  aside than full desktop rather than one fixed width everywhere.

  items-start (not stretch) keeps the aside from being forced to match
  the main column's height. Sticky positioning intentionally not used
  here — plain two-column layout only.
*/}

        <OverallHealth
          status={statusPage.overall}
          lastUpdated={statusPage.lastUpdated}
          serviceCount={statusPage.services.length}
          outageCount={outageCount}
        />

        <div className="md:grid md:grid-cols-[1fr_280px] lg:grid-cols-[1fr_340px] md:items-start md:gap-6 lg:gap-8 space-y-8 md:space-y-0">

          <aside className="space-y-8 md:order-2" aria-label="Incident history">
            <DaysSinceIncident incidents={statusPage.incidents} />
            <IncidentList incidents={statusPage.incidents} focusId={focusIncidentId} />
          </aside>

          <div className="space-y-8 md:order-1">
            {/*
              Genuinely different from the categoryFilter chip below —
              this isn't a UI state the visitor chose, it's an honest
              report that a real data source failed this cycle. Since
              fetchAllServices always resolves successfully (a rejected
              adapter just means fewer services, not a thrown error),
              the affected category's services simply won't appear
              below at all this refresh — nothing stale is being shown
              in their place, so the copy here says that plainly rather
              than implying otherwise.
            */}
            {statusPage.unavailableCategories.length > 0 && (
              <div
                role="alert"
                className="rounded-lg border border-blue-500/40 bg-blue-500/10 px-4 py-3 text-xs text-capstone-text"
              >
                <span className="font-medium text-blue-400">
                  {statusPage.unavailableCategories.length === 1
                    ? 'Data source unavailable: '
                    : 'Data sources unavailable: '}
                </span>
                {statusPage.unavailableCategories.join(', ')} — services in{' '}
                {statusPage.unavailableCategories.length === 1 ? 'this category' : 'these categories'}{' '}
                aren't shown this cycle, not confirmed down. This should resolve on its own once the connection is restored.
              </div>
            )}

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
                    // realHistory is undefined until useUptimeHistory has
                    // real data for this service (see generatePlaceholderDays
                    // above for why). uptimePercent follows the same split:
                    // with real history, the actual calculated percentage;
                    // without it, 100 if the service is currently operational
                    // (an optimistic default — "no evidence of a problem"
                    // rather than "unknown, so assume nothing"), otherwise
                    // undefined so the UI can show "no data" rather than a
                    // misleading number for a service that isn't currently
                    // healthy and has no history to back up any percentage.
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
          </div>

        </div>

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
