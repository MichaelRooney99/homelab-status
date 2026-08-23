import { describe, it, expect, vi, afterEach } from 'vitest'
import { utcMidnightSeconds, buildUptimeDays, buildUpsUptimeDays, fetchUptimeHistory } from './history'
import type { ServiceStatus } from './types'

describe('utcMidnightSeconds', () => {
  // This is the direct regression test for a real past bug: a query
  // window built from "now" instead of a fixed UTC midnight shifted
  // depending on what time of day the code happened to run, so the same
  // nominal day could land on a different real instant run to run. Two
  // different times on the same UTC calendar day must produce the exact
  // same anchor, or this bug is back.
  it('returns the same value regardless of time-of-day on the same UTC date', () => {
    const earlyMorning = new Date('2026-07-16T00:05:00Z')
    const lateNight = new Date('2026-07-16T23:55:00Z')

    expect(utcMidnightSeconds(earlyMorning)).toBe(utcMidnightSeconds(lateNight))
  })

  // Confirms the anchor is actually a real midnight, not just "close
  // enough" — a whole-day boundary in Unix seconds is always evenly
  // divisible by the number of seconds in a day. If this ever fails,
  // the function isn't anchoring correctly even if the test above
  // still happens to pass.
  it('lands exactly on a whole-day boundary in seconds', () => {
    const result = utcMidnightSeconds(new Date('2026-07-16T14:30:00Z'))
    expect(result % 86400).toBe(0)
  })

  // The other direction from the first test — two dates that ARE
  // genuinely different days should never collapse to the same anchor.
  // Between them, these three tests cover "same day stays same," "the
  // anchor is a real midnight," and "different days stay different" —
  // the three properties this function actually needs to hold.
  it('produces different values for genuinely different UTC dates', () => {
    const day1 = utcMidnightSeconds(new Date('2026-07-16T12:00:00Z'))
    const day2 = utcMidnightSeconds(new Date('2026-07-17T00:01:00Z'))
    expect(day2 - day1).toBe(86400)
  })
})

describe('buildUptimeDays', () => {
  // Computed once per describe block rather than hardcoded, so these
  // tests keep passing regardless of what today's real date happens to
  // be when the suite runs — the function being tested is inherently
  // "today"-relative, so the test data has to be too.
  const today = new Date()
  const todayMidnight = utcMidnightSeconds(today)
  const todayDateStr = new Date(todayMidnight * 1000).toISOString().split('T')[0]
  const yesterdayDateStr = new Date((todayMidnight - 86400) * 1000).toISOString().split('T')[0]

  it('maps a "1" sample to operational', () => {
    const days = buildUptimeDays([
      { metric: {}, values: [[todayMidnight, '1']] },
    ])
    const today_ = days.find(d => d.date === todayDateStr)
    expect(today_?.status).toBe('operational')
  })

  it('maps a "0" sample to outage', () => {
    const days = buildUptimeDays([
      { metric: {}, values: [[todayMidnight, '0']] },
    ])
    const today_ = days.find(d => d.date === todayDateStr)
    expect(today_?.status).toBe('outage')
  })

  // Confirms a day with genuinely nothing recorded is distinguishable
  // from a day that recorded a bad reading — 'no-data' and 'outage' mean
  // very different things and a bug that conflated them would be a real
  // regression, not a cosmetic one.
  it('marks a day with no matching sample as no-data, not a guess', () => {
    const days = buildUptimeDays([
      { metric: {}, values: [[todayMidnight - 86400, '1']] }, // only yesterday has data
    ])
    const yesterday = days.find(d => d.date === yesterdayDateStr)
    const today_ = days.find(d => d.date === todayDateStr)
    expect(yesterday?.status).toBe('operational')
    expect(today_?.status).toBe('no-data')
  })

  // Structural test, not a status-derivation one — even with zero real
  // samples, the function's contract is "always 90 days, oldest first,"
  // and that contract has to hold regardless of what data comes in.
  it('always returns exactly 90 days, oldest first', () => {
    const days = buildUptimeDays([])
    expect(days).toHaveLength(90)
    expect(days[0].date < days[89].date).toBe(true)
  })
})

describe('buildUpsUptimeDays', () => {
  const today = new Date()
  const todayMidnight = utcMidnightSeconds(today)
  const todayDateStr = new Date(todayMidnight * 1000).toISOString().split('T')[0]

  // LB (low battery) must win even if OL and OB also fired that same
  // day — flattening a real low-battery event down to a lesser status
  // would hide the most severe thing that actually happened.
  it('prioritizes LB over OB and OL when multiple flags fired the same day', () => {
    const days = buildUpsUptimeDays([
      { metric: { status: 'OL' }, values: [[todayMidnight, '1']] },
      { metric: { status: 'OB' }, values: [[todayMidnight, '1']] },
      { metric: { status: 'LB' }, values: [[todayMidnight, '1']] },
    ])
    const today_ = days.find(d => d.date === todayDateStr)
    expect(today_?.status).toBe('outage')
  })

  // Same severity-ranking idea, one level down — confirms the priority
  // order is genuinely LB > OB > OL and not just "LB wins, everything
  // else is a tie."
  it('prioritizes OB over OL when both fired without LB', () => {
    const days = buildUpsUptimeDays([
      { metric: { status: 'OL' }, values: [[todayMidnight, '1']] },
      { metric: { status: 'OB' }, values: [[todayMidnight, '1']] },
    ])
    const today_ = days.find(d => d.date === todayDateStr)
    expect(today_?.status).toBe('degraded')
  })

  it('reports operational when only OL fired', () => {
    const days = buildUpsUptimeDays([
      { metric: { status: 'OL' }, values: [[todayMidnight, '1']] },
    ])
    const today_ = days.find(d => d.date === todayDateStr)
    expect(today_?.status).toBe('operational')
  })

  // The no-samples-at-all case — mirrors buildUptimeDays' own
  // no-data test above, confirming both functions agree on what
  // "nothing happened" looks like.
  it('reports no-data when no flag was active that day', () => {
    const days = buildUpsUptimeDays([])
    const today_ = days.find(d => d.date === todayDateStr)
    expect(today_?.status).toBe('no-data')
  })
})

// Routes a mocked global fetch by URL shape, since the functions under
// test call fetch directly rather than through an importable adapter —
// unlike fetchAllServices' four dependencies, there's nothing here to
// vi.mock() at the module level.
function mockFetchByUrl(handlers: {
  nodeDiscovery?: () => Response | Promise<Response>
  nodeRange?: () => Response | Promise<Response>
  upsRange?: () => Response | Promise<Response>
  snapshot?: () => Response | Promise<Response>
}) {
  return vi.fn((url: string) => {
    if (url.includes('query_range') && url.includes('node_exporter')) {
      return handlers.nodeRange?.() ?? okJson({ status: 'success', data: { result: [] } })
    }
    if (url.includes('query_range') && url.includes('nut_ups_status')) {
      return handlers.upsRange?.() ?? okJson({ status: 'success', data: { result: [] } })
    }
    if (url.includes('/api/v1/query?') && url.includes('node_exporter')) {
      return handlers.nodeDiscovery?.() ?? okJson({ status: 'success', data: { result: [] } })
    }
    if (url.includes('/history/')) {
      return handlers.snapshot?.() ?? okJson([])
    }
    throw new Error(`Unexpected URL in test: ${url}`)
  })
}

function okJson(body: unknown): Response {
  return { ok: true, json: async () => body } as Response
}

function failedFetch(): Promise<Response> {
  return Promise.reject(new Error('network down'))
}

function service(id: string, category: string): ServiceStatus {
  return { id, name: id, category, status: 'operational', metadata: {} }
}

describe('fetchUptimeHistory', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // The real point of this test: before this session, a failed node-
  // discovery query threw uncounted out of the whole function, silently
  // skipping the unrelated snapshot-backed (Proxmox API/Zabbix) history
  // fetches further down — a Prometheus outage taking down history that
  // never depended on Prometheus at all. This proves that's fixed.
  it('still returns snapshot-backed history when the node-discovery query fails, marking Proxmox Nodes unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchByUrl({
        nodeDiscovery: failedFetch,
        snapshot: () => okJson([{ date: '2026-08-22', status: 'operational' }]),
      })
    )

    const services = [service('proxmox-murloc', 'Proxmox API')]
    const result = await fetchUptimeHistory(services)

    expect(result.unavailableCategories).toContain('Proxmox Nodes')
    expect(result.history['proxmox-murloc']).toBeDefined()
  })

  it('marks Power unavailable when the UPS range query fails, without affecting node or snapshot history', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchByUrl({
        upsRange: failedFetch,
        snapshot: () => okJson([{ date: '2026-08-22', status: 'operational' }]),
      })
    )

    const services = [service('zabbix-1', 'Zabbix')]
    const result = await fetchUptimeHistory(services)

    expect(result.unavailableCategories).toEqual(['Power'])
    expect(result.history['zabbix-1']).toBeDefined()
  })

  it('returns an empty unavailableCategories list when everything succeeds', async () => {
    vi.stubGlobal('fetch', mockFetchByUrl({}))

    const result = await fetchUptimeHistory([])

    expect(result.unavailableCategories).toEqual([])
  })
})
