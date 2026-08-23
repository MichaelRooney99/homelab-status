import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deriveOverallStatus, fetchAllServices } from '.'
import { fetchNodeStatus, fetchUpsStatus } from './prometheus'
import { fetchProxmoxNodeStatus } from './proxmox'
import { fetchZabbixStatus } from './zabbix'
import { fetchIncidents } from './incidents'
import type { ServiceStatus, Status } from './types'

vi.mock('./prometheus', () => ({
  fetchNodeStatus: vi.fn(),
  fetchUpsStatus: vi.fn(),
}))
vi.mock('./proxmox', () => ({ fetchProxmoxNodeStatus: vi.fn() }))
vi.mock('./zabbix', () => ({ fetchZabbixStatus: vi.fn() }))
vi.mock('./incidents', () => ({ fetchIncidents: vi.fn() }))

interface OverallStatusFixture {
  statuses: Status[]
  expected: Status
}

// import.meta.url, not __dirname — this package builds as ESM (Vite),
// which has no CommonJS __dirname global. proxy/'s equivalent test file
// can use __dirname directly since proxy/ builds as CommonJS.
const currentDir = path.dirname(fileURLToPath(import.meta.url))

const fixtures = JSON.parse(
  readFileSync(path.join(currentDir, '../../../fixtures/parity/overall-status.json'), 'utf-8')
) as OverallStatusFixture[]

// deriveOverallStatus only ever reads .status off each service — every
// other ServiceStatus field is irrelevant here, so fixture statuses get
// wrapped in a minimal stand-in rather than a fully realistic object.
function toServices(statuses: Status[]): ServiceStatus[] {
  return statuses.map((status, i) => ({
    id: `fixture-${i}`,
    name: `Fixture ${i}`,
    category: 'Fixture',
    status,
    metadata: {},
  }))
}

describe('deriveOverallStatus', () => {
  // Table-driven testing: rather than hand-writing one it() block per
  // case, loop over the fixture data and generate one test per entry.
  // The test's own name is built from the input/output pair itself
  // (e.g. "[operational, outage] -> outage"), so a failure immediately
  // says which specific case broke without needing to open the fixture
  // file to translate a generic test name back into real inputs. Adding
  // a new case later means adding one line to the shared JSON fixture —
  // no new test code required, and the client and proxy's copies of
  // this logic both automatically pick up the new case since they read
  // the same file.
  for (const { statuses, expected } of fixtures) {
    it(`[${statuses.join(', ') || 'empty'}] -> ${expected}`, () => {
      expect(deriveOverallStatus(toServices(statuses))).toBe(expected)
    })
  }
})

// One minimal, realistic-shaped service per mocked adapter — enough to
// prove which ones actually made it into the merged array, without
// needing every real field a production response would carry.
function service(id: string): ServiceStatus {
  return { id, name: id, category: 'Fixture', status: 'operational', metadata: {} }
}

describe('fetchAllServices', () => {
  it('merges results from all four service adapters when everything succeeds', async () => {
    vi.mocked(fetchNodeStatus).mockResolvedValue([service('node-a')])
    vi.mocked(fetchUpsStatus).mockResolvedValue([service('ups-a')])
    vi.mocked(fetchProxmoxNodeStatus).mockResolvedValue([service('proxmox-a')])
    vi.mocked(fetchZabbixStatus).mockResolvedValue([service('zabbix-a')])
    vi.mocked(fetchIncidents).mockResolvedValue([])

    const result = await fetchAllServices()

    expect(result.services.map(s => s.id)).toEqual(['node-a', 'ups-a', 'proxmox-a', 'zabbix-a'])
  })

  // This documents the exact current behavior, on purpose — a failed
  // source's results just silently disappear from the merged array
  // today, with nothing in the response signaling which category was
  // actually the problem. Worth a real test capturing that as the
  // current, known state rather than leaving it unverified.
  it('silently drops a rejected adapter\'s results rather than failing the whole request', async () => {
    vi.mocked(fetchNodeStatus).mockResolvedValue([service('node-a')])
    vi.mocked(fetchUpsStatus).mockResolvedValue([service('ups-a')])
    vi.mocked(fetchProxmoxNodeStatus).mockRejectedValue(new Error('proxmox API down'))
    vi.mocked(fetchZabbixStatus).mockResolvedValue([service('zabbix-a')])
    vi.mocked(fetchIncidents).mockResolvedValue([])

    const result = await fetchAllServices()

    expect(result.services.map(s => s.id)).toEqual(['node-a', 'ups-a', 'zabbix-a'])
  })

  it('returns an empty services array, not a rejection, when every adapter fails', async () => {
    vi.mocked(fetchNodeStatus).mockRejectedValue(new Error('down'))
    vi.mocked(fetchUpsStatus).mockRejectedValue(new Error('down'))
    vi.mocked(fetchProxmoxNodeStatus).mockRejectedValue(new Error('down'))
    vi.mocked(fetchZabbixStatus).mockRejectedValue(new Error('down'))
    vi.mocked(fetchIncidents).mockResolvedValue([])

    const result = await fetchAllServices()

    expect(result.services).toEqual([])
  })

  // Incidents get their own independent failure isolation, deliberately
  // separate from the services Promise.allSettled — this proves that
  // isolation actually holds rather than just reading the comment
  // describing it.
  it('falls back to an empty incidents array on failure, without affecting services at all', async () => {
    vi.mocked(fetchNodeStatus).mockResolvedValue([service('node-a')])
    vi.mocked(fetchUpsStatus).mockResolvedValue([])
    vi.mocked(fetchProxmoxNodeStatus).mockResolvedValue([])
    vi.mocked(fetchZabbixStatus).mockResolvedValue([])
    vi.mocked(fetchIncidents).mockRejectedValue(new Error('incidents fetch failed'))

    const result = await fetchAllServices()

    expect(result.incidents).toEqual([])
    expect(result.services.map(s => s.id)).toEqual(['node-a'])
  })

  it('returns a real, current ISO timestamp as lastUpdated', async () => {
    vi.mocked(fetchNodeStatus).mockResolvedValue([])
    vi.mocked(fetchUpsStatus).mockResolvedValue([])
    vi.mocked(fetchProxmoxNodeStatus).mockResolvedValue([])
    vi.mocked(fetchZabbixStatus).mockResolvedValue([])
    vi.mocked(fetchIncidents).mockResolvedValue([])

    const before = Date.now()
    const result = await fetchAllServices()
    const after = Date.now()

    const lastUpdatedMs = new Date(result.lastUpdated).getTime()
    expect(lastUpdatedMs).toBeGreaterThanOrEqual(before)
    expect(lastUpdatedMs).toBeLessThanOrEqual(after)
  })
})
