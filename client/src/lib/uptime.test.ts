import { describe, it, expect } from 'vitest'
import { calculateUptimePercent } from './uptime'
import type { UptimeDay } from '../services/types'

// Small factory so every test below only has to name the one thing that
// actually varies (status) — the date is irrelevant to this function's
// logic, so hardcoding one avoids 30 lines of tests all constructing a
// near-identical object by hand.
function day(status: UptimeDay['status']): UptimeDay {
  return { date: '2026-07-16', status }
}

describe('calculateUptimePercent', () => {
  // The straightforward case first — establishes the baseline before
  // the more interesting edge cases below start bending it.
  it('returns 100 when every day with data was operational', () => {
    const days = [day('operational'), day('operational'), day('operational')]
    expect(calculateUptimePercent(days)).toBe(100)
  })

  // The actual point of this function's existence, not just another
  // case — a naive percentage (operational days ÷ total days) would
  // read 40% here, which is wrong. 'no-data' isn't a failed day, it's
  // an absence of information, and this function is specifically the
  // one place that distinction gets enforced.
  it('excludes no-data days from the denominator entirely', () => {
    // 2 operational, 3 no-data — should read 100%, not 40%. A day with
    // no data means "we don't know," not "this counted against uptime."
    const days = [day('operational'), day('operational'), day('no-data'), day('no-data'), day('no-data')]
    expect(calculateUptimePercent(days)).toBe(100)
  })

  // Boundary case: what happens when literally every day is excluded
  // from the denominator? There's no meaningful percentage to compute,
  // so the function has to signal "no answer" rather than dividing by
  // zero or silently returning 0 (which would look like "0% uptime,"
  // a very different and misleading claim from "we simply don't know").
  it('returns undefined when every day is no-data — nothing to compute a percent from', () => {
    const days = [day('no-data'), day('no-data')]
    expect(calculateUptimePercent(days)).toBeUndefined()
  })

  // Guards against a lazy implementation that treats "not outage" as
  // "operational" — degraded is its own real status and has to count
  // against the percentage, not get silently folded into either side.
  it('does not count degraded as operational', () => {
    const days = [day('operational'), day('degraded')]
    expect(calculateUptimePercent(days)).toBe(50)
  })

  it('does not count outage as operational', () => {
    const days = [day('operational'), day('operational'), day('operational'), day('outage')]
    expect(calculateUptimePercent(days)).toBe(75)
  })

  // The mirror image of the very first test — every day counts, but
  // every one of them is bad. Confirms the math doesn't secretly assume
  // "at least one good day" anywhere.
  it('returns 0 when every day with data was an outage', () => {
    const days = [day('outage'), day('outage')]
    expect(calculateUptimePercent(days)).toBe(0)
  })
})