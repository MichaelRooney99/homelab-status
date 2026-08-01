import { describe, it, expect } from 'vitest'
import { utcMidnightSeconds, buildUptimeDays, buildUpsUptimeDays } from './history'

describe('utcMidnightSeconds', () => {
  // This is the direct regression test for the real 07-24-2026 bug: a
  // query window built from "now" instead of a fixed UTC midnight
  // shifted depending on what time of day the code happened to run.
  // Two different times on the same UTC calendar day must produce the
  // exact same anchor, or this bug is back.
  it('returns the same value regardless of time-of-day on the same UTC date', () => {
    const earlyMorning = new Date('2026-07-16T00:05:00Z')
    const lateNight = new Date('2026-07-16T23:55:00Z')

    expect(utcMidnightSeconds(earlyMorning)).toBe(utcMidnightSeconds(lateNight))
  })

  it('lands exactly on a whole-day boundary in seconds', () => {
    const result = utcMidnightSeconds(new Date('2026-07-16T14:30:00Z'))
    expect(result % 86400).toBe(0)
  })

  it('produces different values for genuinely different UTC dates', () => {
    const day1 = utcMidnightSeconds(new Date('2026-07-16T12:00:00Z'))
    const day2 = utcMidnightSeconds(new Date('2026-07-17T00:01:00Z'))
    expect(day2 - day1).toBe(86400)
  })
})

describe('buildUptimeDays', () => {
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

  it('marks a day with no matching sample as no-data, not a guess', () => {
    const days = buildUptimeDays([
      { metric: {}, values: [[todayMidnight - 86400, '1']] }, // only yesterday has data
    ])
    const yesterday = days.find(d => d.date === yesterdayDateStr)
    const today_ = days.find(d => d.date === todayDateStr)
    expect(yesterday?.status).toBe('operational')
    expect(today_?.status).toBe('no-data')
  })

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

  it('reports no-data when no flag was active that day', () => {
    const days = buildUpsUptimeDays([])
    const today_ = days.find(d => d.date === todayDateStr)
    expect(today_?.status).toBe('no-data')
  })
})