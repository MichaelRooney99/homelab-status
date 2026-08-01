import { describe, it, expect } from 'vitest'
import { calculateUptimePercent } from './uptime'
import type { UptimeDay } from '../services/types'

function day(status: UptimeDay['status']): UptimeDay {
  return { date: '2026-07-16', status }
}

describe('calculateUptimePercent', () => {
  it('returns 100 when every day with data was operational', () => {
    const days = [day('operational'), day('operational'), day('operational')]
    expect(calculateUptimePercent(days)).toBe(100)
  })

  it('excludes no-data days from the denominator entirely', () => {
    // 2 operational, 3 no-data — should read 100%, not 40%. A day with
    // no data means "we don't know," not "this counted against uptime."
    const days = [day('operational'), day('operational'), day('no-data'), day('no-data'), day('no-data')]
    expect(calculateUptimePercent(days)).toBe(100)
  })

  it('returns undefined when every day is no-data — nothing to compute a percent from', () => {
    const days = [day('no-data'), day('no-data')]
    expect(calculateUptimePercent(days)).toBeUndefined()
  })

  it('does not count degraded as operational', () => {
    const days = [day('operational'), day('degraded')]
    expect(calculateUptimePercent(days)).toBe(50)
  })

  it('does not count outage as operational', () => {
    const days = [day('operational'), day('operational'), day('operational'), day('outage')]
    expect(calculateUptimePercent(days)).toBe(75)
  })

  it('returns 0 when every day with data was an outage', () => {
    const days = [day('outage'), day('outage')]
    expect(calculateUptimePercent(days)).toBe(0)
  })
})