import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ServiceDetailModal from './ServiceDetailModal'
import type { ServiceStatus, Incident } from '../services/types'
import type { ServiceDetail } from '../services/detail'

// Mocking at the service-adapter boundary (fetchServiceDetail itself)
// rather than global fetch — this app's whole architecture already
// treats services/ as the swappable boundary between "real data" and
// "the rest of the app," so testing against that same boundary is more
// resilient than mocking fetch: if detail.ts's own internal Prometheus
// query shape ever changes, this test doesn't need to change with it,
// only detail.ts's own tests would.
vi.mock('../services/detail', () => ({
  fetchServiceDetail: vi.fn(),
}))

import { fetchServiceDetail } from '../services/detail'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const service: ServiceStatus = {
  id: 'svc-ankhh',
  name: 'Ankhh',
  category: 'Proxmox Nodes',
  status: 'operational',
} as ServiceStatus

const unrelatedIncident: Incident = {
  id: 'inc-unrelated',
  title: 'Something else entirely',
  status: 'resolved',
  affectedServices: ['svc-murloc'],
} as Incident

const relatedIncident: Incident = {
  id: 'inc-related',
  title: 'Ankhh went briefly degraded',
  status: 'resolved',
  affectedServices: ['svc-ankhh'],
} as Incident

// Fresh QueryClient per render — a shared one would leak cached
// "serviceDetail" data between tests and defeat the whole point of
// controlling what fetchServiceDetail resolves to in each one.
// retry: false matters specifically for the error-state test: without
// it, TanStack Query retries a few times with backoff before settling
// into isError, which would make that one test slow and flaky for no
// real benefit.
function renderModal(incidents: Incident[] = []) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const onClose = vi.fn()

  render(
    <QueryClientProvider client={queryClient}>
      <ServiceDetailModal service={service} incidents={incidents} onClose={onClose} />
    </QueryClientProvider>
  )

  return { onClose }
}

function neverResolves() {
  return new Promise<ServiceDetail>(() => {})
}

describe('ServiceDetailModal', () => {
  it('shows a loading message while the query is in flight', () => {
    vi.mocked(fetchServiceDetail).mockReturnValue(neverResolves())
    renderModal()

    expect(screen.getByText(/Loading last 24 hours/)).toBeInTheDocument()
  })

  it('shows the response-time chart and recent readings once data loads', async () => {
    const detail: ServiceDetail = {
      responseTime: [{ timestamp: 1000, value: 12 }],
      statusLog: [
        { timestamp: 2000, status: 'operational' },
        { timestamp: 1000, status: 'operational' },
      ],
    }
    vi.mocked(fetchServiceDetail).mockResolvedValue(detail)
    renderModal()

    await waitFor(() => {
      expect(screen.queryByText(/Loading last 24 hours/)).not.toBeInTheDocument()
    })

    expect(screen.getByText(/Response time — last 24h/)).toBeInTheDocument()
    expect(screen.getAllByText('operational')).toHaveLength(2)
  })

  it('shows an error message when the query fails, not a blank or stuck loading state', async () => {
    vi.mocked(fetchServiceDetail).mockRejectedValue(new Error('network down'))
    renderModal()

    await waitFor(() => {
      expect(screen.getByText(/Couldn't load recent history/)).toBeInTheDocument()
    })
    expect(screen.queryByText(/Loading last 24 hours/)).not.toBeInTheDocument()
  })

  // recentLog sorts newest-first and slices to 20 — this fixture sends
  // 25 entries specifically out of order, so a test that happened to
  // pass on already-sorted input wouldn't actually prove the sort runs.
  it('sorts recent readings newest-first and caps the list at 20', async () => {
    const statusLog = Array.from({ length: 25 }, (_, i) => ({
      timestamp: i, // ascending — deliberately the opposite of the expected display order
      status: 'operational',
    })).sort(() => Math.random() - 0.5) // shuffle, so display order can't accidentally match input order

    vi.mocked(fetchServiceDetail).mockResolvedValue({
      responseTime: [{ timestamp: 1000, value: 12 }],
      statusLog,
    })
    renderModal()

    await waitFor(() => {
      expect(screen.queryByText(/Loading last 24 hours/)).not.toBeInTheDocument()
    })

    const readings = screen.getAllByText('operational')
    expect(readings).toHaveLength(20)
  })

  it('only shows incidents whose affectedServices includes this service', async () => {
    vi.mocked(fetchServiceDetail).mockResolvedValue({ responseTime: [], statusLog: [] })
    renderModal([unrelatedIncident, relatedIncident])

    expect(await screen.findByText('Ankhh went briefly degraded')).toBeInTheDocument()
    expect(screen.queryByText('Something else entirely')).not.toBeInTheDocument()
  })

  it('does not render a "related incidents" section at all when none match', async () => {
    vi.mocked(fetchServiceDetail).mockResolvedValue({ responseTime: [], statusLog: [] })
    renderModal([unrelatedIncident])

    await waitFor(() => expect(fetchServiceDetail).toHaveBeenCalled())
    expect(screen.queryByText('Related incidents')).not.toBeInTheDocument()
  })

  it('focuses the dialog itself on mount', () => {
    vi.mocked(fetchServiceDetail).mockReturnValue(neverResolves())
    renderModal()

    expect(screen.getByRole('dialog')).toHaveFocus()
  })

  it('Escape calls onClose', async () => {
    vi.mocked(fetchServiceDetail).mockReturnValue(neverResolves())
    const user = userEvent.setup()
    const { onClose } = renderModal()

    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalled()
  })

  it('the close button calls onClose', async () => {
    vi.mocked(fetchServiceDetail).mockReturnValue(neverResolves())
    const user = userEvent.setup()
    const { onClose } = renderModal()

    await user.click(screen.getByRole('button', { name: /Close detail view/ }))

    expect(onClose).toHaveBeenCalled()
  })

  it('clicking the backdrop calls onClose, clicking inside the dialog does not', async () => {
    vi.mocked(fetchServiceDetail).mockReturnValue(neverResolves())
    const user = userEvent.setup()
    const { onClose } = renderModal()

    await user.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()

    await user.click(screen.getByRole('dialog').parentElement as HTMLElement)
    expect(onClose).toHaveBeenCalled()
  })
})
