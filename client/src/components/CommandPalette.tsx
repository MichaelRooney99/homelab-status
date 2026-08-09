import { useEffect, useMemo, useRef, useState } from 'react'
import type { ServiceStatus, Incident } from '../services/types'

interface CategoryCount {
  name: string
  count: number
}

interface CommandPaletteProps {
  services: ServiceStatus[]
  categories: CategoryCount[]
  incidents: Incident[]
  onClose: () => void
  onSelectService: (service: ServiceStatus) => void
  onSelectCategory: (category: string) => void
  onSelectIncident: (incidentId: string) => void
}

type PaletteItem =
  | { type: 'service'; key: string; label: string; sublabel: string; service: ServiceStatus }
  | { type: 'category'; key: string; label: string; sublabel: string; category: string }
  | { type: 'incident'; key: string; label: string; sublabel: string; incidentId: string }

const TYPE_TAG: Record<PaletteItem['type'], string> = {
  service: 'Svc',
  category: 'Cat',
  incident: 'Inc',
}

// Hand-rolled rather than a library (cmdk, etc.) — consistent with how
// this project has handled every other small UI primitive so far
// (IncidentList's collapse, UptimeBars' tooltips). Focus management and
// arrow-key nav are the fussy parts of this pattern specifically; if
// this turns out fiddlier in practice than expected, cmdk is the one
// documented exception worth reaching for.
export default function CommandPalette({
  services,
  categories,
  incidents,
  onClose,
  onSelectService,
  onSelectCategory,
  onSelectIncident,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [prevQuery, setPrevQuery] = useState(query)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  // Land focus in the search field immediately — same reasoning as
  // ServiceDetailModal focusing the dialog itself on open.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const items: PaletteItem[] = useMemo(() => {
    const serviceItems: PaletteItem[] = services.map(service => ({
      type: 'service',
      key: `service-${service.id}`,
      label: service.name,
      sublabel: service.category,
      service,
    }))

    const categoryItems: PaletteItem[] = categories.map(({ name, count }) => ({
      type: 'category',
      key: `category-${name}`,
      label: name,
      sublabel: `${count} service${count === 1 ? '' : 's'}`,
      category: name,
    }))

    const incidentItems: PaletteItem[] = incidents.map(incident => ({
      type: 'incident',
      key: `incident-${incident.id}`,
      label: incident.title,
      sublabel: incident.status,
      incidentId: incident.id,
    }))

    return [...serviceItems, ...categoryItems, ...incidentItems]
  }, [services, categories, incidents])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      item =>
        item.label.toLowerCase().includes(q) || item.sublabel.toLowerCase().includes(q)
    )
  }, [items, query])

  // A new query invalidates whatever row was highlighted under the old
  // one — always re-anchor to the top match instead of an index that
  // might now point at something unrelated (or nothing at all). Adjusted
  // during render rather than in an effect — same reasoning as
  // IncidentList's forceOpen sync: this is a state-to-state sync, not an
  // external-system interaction, so the effect version trips
  // react-hooks/set-state-in-effect and causes a needless extra render.
  if (query !== prevQuery) {
    setPrevQuery(query)
    setActiveIndex(0)
  }

  function runItem(item: PaletteItem) {
    if (item.type === 'service') onSelectService(item.service)
    if (item.type === 'category') onSelectCategory(item.category)
    if (item.type === 'incident') onSelectIncident(item.incidentId)
    onClose()
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      onClose()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex(index => Math.min(index + 1, filtered.length - 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex(index => Math.max(index - 1, 0))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const item = filtered[activeIndex]
      if (item) runItem(item)
    }
  }

  // Keeps the highlighted row in view as arrow keys move past whatever's
  // currently visible in the scroll container.
  useEffect(() => {
    const active = listRef.current?.children[activeIndex] as HTMLElement | undefined
    active?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[15vh]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={event => event.stopPropagation()}
        onKeyDown={handleKeyDown}
        className="w-full max-w-lg rounded-lg border border-capstone-border bg-capstone-bg-raised shadow-xl overflow-hidden"
      >
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Jump to a service, category, or incident…"
          aria-label="Search services, categories, and incidents"
          role="combobox"
          aria-expanded="true"
          aria-controls="command-palette-results"
          aria-activedescendant={filtered[activeIndex]?.key}
          className="w-full bg-transparent px-4 py-3 text-sm text-capstone-text placeholder-capstone-muted border-b border-capstone-border outline-none"
        />

        {filtered.length === 0 ? (
          <p className="px-4 py-6 text-sm text-capstone-muted text-center">
            Nothing matches "{query}".
          </p>
        ) : (
          <ul
            ref={listRef}
            id="command-palette-results"
            role="listbox"
            aria-label="Results"
            className="max-h-80 overflow-y-auto py-1"
          >
            {filtered.map((item, index) => (
              <li key={item.key} id={item.key} role="option" aria-selected={index === activeIndex}>
                <button
                  type="button"
                  onClick={() => runItem(item)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`flex w-full items-center justify-between gap-4 px-4 py-2 text-left text-sm transition-colors ${
                    index === activeIndex ? 'bg-capstone-subtle text-capstone-text' : 'text-capstone-text/80'
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="shrink-0 rounded border border-capstone-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-capstone-muted">
                      {TYPE_TAG[item.type]}
                    </span>
                    <span className="truncate">{item.label}</span>
                  </span>
                  <span className="shrink-0 text-xs text-capstone-muted truncate max-w-[40%]">
                    {item.sublabel}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center justify-between border-t border-capstone-border px-4 py-2 text-[11px] text-capstone-muted">
          <span>↑↓ navigate · Enter select · Esc close</span>
          <span>⌘K · Ctrl+K · /</span>
        </div>
      </div>
    </div>
  )
}