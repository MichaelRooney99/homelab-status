import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CommandPalette from './CommandPalette'
import type { ServiceStatus, Incident } from '../services/types'

afterEach(() => {
  cleanup()
})

// Small, deliberately minimal fixtures — just enough of a real
// ServiceStatus/Incident shape to exercise the palette's own logic,
// not a realistic full dataset. Anything the palette doesn't actually
// read (most of ServiceStatus's other fields) is left out on purpose,
// so a failing test points at the palette's behavior, not a fixture
// typo somewhere unrelated.
const services = [
  { id: 'svc-ankhh', name: 'Ankhh', category: 'Proxmox Nodes', status: 'operational' },
  { id: 'svc-murloc', name: 'Murloc', category: 'Proxmox Nodes', status: 'operational' },
] as ServiceStatus[]

const categories = [{ name: 'Proxmox Nodes', count: 2 }]

const incidents = [
  { id: 'inc-1', title: 'UPS on battery', status: 'resolved' },
] as Incident[]

function renderPalette(overrides: Partial<Parameters<typeof CommandPalette>[0]> = {}) {
  const onClose = vi.fn()
  const onSelectService = vi.fn()
  const onSelectCategory = vi.fn()
  const onSelectIncident = vi.fn()

  render(
    <CommandPalette
      services={services}
      categories={categories}
      incidents={incidents}
      onClose={onClose}
      onSelectService={onSelectService}
      onSelectCategory={onSelectCategory}
      onSelectIncident={onSelectIncident}
      {...overrides}
    />
  )

  return { onClose, onSelectService, onSelectCategory, onSelectIncident }
}

describe('CommandPalette', () => {
  it('lists every service, category, and incident with no query typed', () => {
    renderPalette()
    expect(screen.getByRole('option', { name: /Ankhh/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Murloc/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /^Cat/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /UPS on battery/ })).toBeInTheDocument()
  })

  it('auto-focuses the search input on mount', () => {
    renderPalette()
    expect(screen.getByRole('combobox')).toHaveFocus()
  })

  it('filters by label as the query changes', async () => {
    const user = userEvent.setup()
    renderPalette()

    await user.type(screen.getByRole('combobox'), 'ankhh')

    expect(screen.getByRole('option', { name: /Ankhh/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Murloc/ })).not.toBeInTheDocument()
  })

  // The filter checks sublabel too, not just label — this is a
  // genuinely different code path (item.sublabel.toLowerCase().includes)
  // from the test above, and worth its own case: searching "resolved"
  // matches the incident by its status, which only appears as the
  // sublabel, never the label.
  it('filters by sublabel too, not just label', async () => {
    const user = userEvent.setup()
    renderPalette()

    await user.type(screen.getByRole('combobox'), 'resolved')

    expect(screen.getByRole('option', { name: /UPS on battery/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Ankhh/ })).not.toBeInTheDocument()
  })

  it('shows a "nothing matches" message when the filter has zero results', async () => {
    const user = userEvent.setup()
    renderPalette()

    await user.type(screen.getByRole('combobox'), 'nothing will ever match this')

    expect(screen.getByText(/Nothing matches/)).toBeInTheDocument()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('selecting a service via click calls onSelectService and onClose, not the other handlers', async () => {
    const user = userEvent.setup()
    const { onSelectService, onSelectCategory, onSelectIncident, onClose } = renderPalette()

    // getByRole('option') returns the <li> — the actual click handler
    // lives on the nested <button>, which visually fills the whole row,
    // so this matches what a real click on the row does. Clicking the
    // <li> directly wouldn't reach the button's handler at all: click
    // events bubble from the target UP to ancestors, never down into a
    // descendant that wasn't the real click target.
    const option = screen.getByRole('option', { name: /Ankhh/ })
    await user.click(within(option).getByRole('button'))

    expect(onSelectService).toHaveBeenCalledWith(services[0])
    expect(onSelectCategory).not.toHaveBeenCalled()
    expect(onSelectIncident).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('selecting a category via click calls onSelectCategory with the category name', async () => {
    const user = userEvent.setup()
    const { onSelectCategory } = renderPalette()

    const option = screen.getByRole('option', { name: /^Cat/ })
    await user.click(within(option).getByRole('button'))

    expect(onSelectCategory).toHaveBeenCalledWith('Proxmox Nodes')
  })

  it('selecting an incident via click calls onSelectIncident with the incident id', async () => {
    const user = userEvent.setup()
    const { onSelectIncident } = renderPalette()

    const option = screen.getByRole('option', { name: /UPS on battery/ })
    await user.click(within(option).getByRole('button'))

    expect(onSelectIncident).toHaveBeenCalledWith('inc-1')
  })

  // ArrowDown/ArrowUp move an internal activeIndex — aria-selected on
  // the highlighted <li> is the one externally-observable signal that
  // index actually moved, since the index itself isn't exposed as a
  // prop or return value anywhere.
  it('ArrowDown moves the highlighted option, Enter selects whatever is currently highlighted', async () => {
    const user = userEvent.setup()
    const { onSelectService } = renderPalette()

    const combobox = screen.getByRole('combobox')
    await user.click(combobox)
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')

    // First item is Ankhh (index 0); one ArrowDown moves to Murloc (index 1).
    expect(onSelectService).toHaveBeenCalledWith(services[1])
  })

  it('ArrowUp does not move the index below 0', async () => {
    const user = userEvent.setup()
    const { onSelectService } = renderPalette()

    const combobox = screen.getByRole('combobox')
    await user.click(combobox)
    // Already at index 0 — ArrowUp should clamp, not go negative or wrap.
    await user.keyboard('{ArrowUp}')
    await user.keyboard('{Enter}')

    expect(onSelectService).toHaveBeenCalledWith(services[0])
  })

  it('a new query resets the highlighted index back to the top match', async () => {
    const user = userEvent.setup()
    const { onSelectService } = renderPalette()

    const combobox = screen.getByRole('combobox')
    await user.click(combobox)
    await user.keyboard('{ArrowDown}') // now on Murloc (index 1)
    await user.type(combobox, 'ankhh') // query changes — should re-anchor to index 0
    await user.keyboard('{Enter}')

    expect(onSelectService).toHaveBeenCalledWith(services[0])
  })

  it('Escape calls onClose', async () => {
    const user = userEvent.setup()
    const { onClose } = renderPalette()

    await user.click(screen.getByRole('combobox'))
    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalled()
  })

  it('clicking the backdrop calls onClose', async () => {
    const user = userEvent.setup()
    const { onClose } = renderPalette()

    // The dialog itself stops propagation on click — only the
    // surrounding backdrop div should ever trigger onClose via click.
    await user.click(screen.getByRole('dialog').parentElement as HTMLElement)

    expect(onClose).toHaveBeenCalled()
  })

  it('clicking inside the dialog does not call onClose', async () => {
    const user = userEvent.setup()
    const { onClose } = renderPalette()

    await user.click(screen.getByRole('dialog'))

    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows the correct type tag for each item kind', () => {
    renderPalette()
    const serviceOption = screen.getByRole('option', { name: /Ankhh/ })
    const categoryOption = screen.getByRole('option', { name: /^Cat/ })
    const incidentOption = screen.getByRole('option', { name: /UPS on battery/ })

    expect(within(serviceOption).getByText('Svc')).toBeInTheDocument()
    expect(within(categoryOption).getByText('Cat')).toBeInTheDocument()
    expect(within(incidentOption).getByText('Inc')).toBeInTheDocument()
  })
})
