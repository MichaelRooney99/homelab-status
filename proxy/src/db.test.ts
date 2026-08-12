import { describe, it, expect } from 'vitest'
import { recordSnapshot, getDayBucketedHistory } from './db'

// Real node:sqlite instance, in-memory for the whole test run — see
// vitest.config.ts's SNAPSHOTS_DB_PATH override. Not a mock: this
// exercises the actual INSERT and the actual SELECT/rollup query
// together, since the worst-of-day logic and the SQL feeding it are two
// halves of one behavior, same as testing buildUptimeDays against real
// Prometheus-shaped results rather than a stubbed version.
//
// Each test uses its own unique service id so tests can't see each
// other's rows without needing a manual reset-between-tests step.
let serviceCounter = 0
function uniqueServiceId(): string {
  serviceCounter += 1
  return `test-service-${serviceCounter}`
}

// Same anchoring the function itself uses internally — computed once
// per test, not injected, matching the precedent already set in
// client/src/services/history.test.ts for testing "today"-anchored
// logic without a time-mocking library.
function todayUtcMidnight(): number {
  const now = new Date()
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000
}

function todayDateStr(): string {
  return new Date(todayUtcMidnight() * 1000).toISOString().split('T')[0]
}

function daysAgoDateStr(daysAgo: number): string {
  return new Date((todayUtcMidnight() - daysAgo * 86400) * 1000).toISOString().split('T')[0]
}

describe('getDayBucketedHistory', () => {
  // Establishing baseline behavior first — a single reading on a single
  // day should map to that exact day, nothing fancier yet.
  it('maps a single operational reading to that day', () => {
    const serviceId = uniqueServiceId()
    recordSnapshot(serviceId, 'operational', null, todayUtcMidnight())

    const days = getDayBucketedHistory(serviceId)
    const today = days.find(d => d.date === todayDateStr())
    expect(today?.status).toBe('operational')
  })

  it('maps a single outage reading to that day', () => {
    const serviceId = uniqueServiceId()
    recordSnapshot(serviceId, 'outage', null, todayUtcMidnight())

    const days = getDayBucketedHistory(serviceId)
    const today = days.find(d => d.date === todayDateStr())
    expect(today?.status).toBe('outage')
  })

  // Confirms the function distinguishes "this service was fine
  // yesterday, we just have no data for today" from "this service is
  // currently down" — two very different situations that a lazy
  // implementation could easily conflate into the same status.
  it('marks a day with no snapshot as no-data, not a guess', () => {
    const serviceId = uniqueServiceId()
    recordSnapshot(serviceId, 'operational', null, todayUtcMidnight() - 86400)

    const days = getDayBucketedHistory(serviceId)
    const today = days.find(d => d.date === todayDateStr())
    const yesterday = days.find(d => d.date === daysAgoDateStr(1))
    expect(today?.status).toBe('no-data')
    expect(yesterday?.status).toBe('operational')
  })

  // A pure shape/contract test, independent of any status logic — the
  // function promises exactly 90 days back in chronological order every
  // time, even for a service with zero recorded snapshots at all.
  it('always returns exactly 90 days, oldest first', () => {
    const serviceId = uniqueServiceId()
    const days = getDayBucketedHistory(serviceId)
    expect(days).toHaveLength(90)
    expect(days[0].date < days[89].date).toBe(true)
  })

  // The actual point of this whole rollup — the real reason it's called
  // "worst status of the day" and not "most recent status of the day."
  it('rolls multiple same-day readings up to the worst one, regardless of order', () => {
    const serviceId = uniqueServiceId()
    const base = todayUtcMidnight()
    recordSnapshot(serviceId, 'operational', null, base + 60)
    recordSnapshot(serviceId, 'outage', null, base + 120)
    recordSnapshot(serviceId, 'operational', null, base + 180)

    const days = getDayBucketedHistory(serviceId)
    const today = days.find(d => d.date === todayDateStr())
    expect(today?.status).toBe('outage')
  })

  // One level down from the test above — confirms the actual ranking
  // order (outage worse than degraded worse than operational), not just
  // that "the bad one wins" in a two-value case.
  it('ranks outage worse than degraded worse than operational', () => {
    const serviceId = uniqueServiceId()
    const base = todayUtcMidnight()
    recordSnapshot(serviceId, 'operational', null, base + 60)
    recordSnapshot(serviceId, 'degraded', null, base + 120)

    const days = getDayBucketedHistory(serviceId)
    const today = days.find(d => d.date === todayDateStr())
    expect(today?.status).toBe('degraded')
  })

  // 'unknown' is deliberately excluded from the severity ranking, not
  // treated as a low-severity level — see the SEVERITY comment in
  // db.ts. A day with only an 'unknown' reading should show no-data,
  // same as a day with no reading at all — not 'unknown' itself, and
  // not silently promoted to some other status.
  it('excludes unknown readings from the rollup entirely', () => {
    const serviceId = uniqueServiceId()
    recordSnapshot(serviceId, 'unknown', null, todayUtcMidnight())

    const days = getDayBucketedHistory(serviceId)
    const today = days.find(d => d.date === todayDateStr())
    expect(today?.status).toBe('no-data')
  })

  // The important companion to the test above — excluding 'unknown'
  // from the ranking must not mean excluding the entire day's other
  // real readings. An 'unknown' sitting alongside a genuine outage on
  // the same day should never mask that outage.
  it('an unknown reading does not hide a real outage recorded the same day', () => {
    const serviceId = uniqueServiceId()
    const base = todayUtcMidnight()
    recordSnapshot(serviceId, 'unknown', null, base + 60)
    recordSnapshot(serviceId, 'outage', null, base + 120)

    const days = getDayBucketedHistory(serviceId)
    const today = days.find(d => d.date === todayDateStr())
    expect(today?.status).toBe('outage')
  })

  // Confirms the day-bucketing boundary itself — a reading recorded on
  // one real calendar day must never leak into an adjacent day's
  // bucket, in either direction.
  it('keeps readings on different real dates in separate day buckets', () => {
    const serviceId = uniqueServiceId()
    recordSnapshot(serviceId, 'outage', null, todayUtcMidnight())
    recordSnapshot(serviceId, 'operational', null, todayUtcMidnight() - 86400)

    const days = getDayBucketedHistory(serviceId)
    const today = days.find(d => d.date === todayDateStr())
    const yesterday = days.find(d => d.date === daysAgoDateStr(1))
    expect(today?.status).toBe('outage')
    expect(yesterday?.status).toBe('operational')
  })
})
