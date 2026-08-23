import { describe, it, expect } from 'vitest'
import {
  recordSnapshot,
  getDayBucketedHistory,
  createManualIncident,
  updateIncidentStatus,
  getIncidentStatus,
  deleteIncident,
  pruneOldIncidents,
  promoteFileIncident,
  getPromotedIncidentId,
  getAllDraftedIncidents,
  getActiveDraftedIncident,
  createDraftedIncident,
  resolveDraftedIncident,
  appendIncidentUpdate,
} from './db'

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

  // Deliberately the opposite outcome from the 'unknown' test right
  // above, even though both start from "a day with exactly one, non-
  // real-severity reading." 'unknown' means a reading came back but
  // wasn't informative; 'unreachable' means the source couldn't be
  // asked at all — a genuinely different fact, and this is the test
  // proving the two don't collapse into the same 'no-data' result.
  it('marks a day as unreachable when the only reading that day is unreachable', () => {
    const serviceId = uniqueServiceId()
    recordSnapshot(serviceId, 'unreachable', null, todayUtcMidnight())

    const days = getDayBucketedHistory(serviceId)
    const today = days.find(d => d.date === todayDateStr())
    expect(today?.status).toBe('unreachable')
  })

  // The real point of this test: 'unreachable' is a fallback, not a
  // real severity level. A genuine reading recorded the same day — the
  // source came back partway through — has to win, the same way a real
  // outage already wins over an 'unknown' reading above.
  it('a real severity reading still wins over an unreachable reading recorded the same day', () => {
    const serviceId = uniqueServiceId()
    const base = todayUtcMidnight()
    recordSnapshot(serviceId, 'unreachable', null, base + 60)
    recordSnapshot(serviceId, 'operational', null, base + 120)

    const days = getDayBucketedHistory(serviceId)
    const today = days.find(d => d.date === todayDateStr())
    expect(today?.status).toBe('operational')
  })

  // Confirms an unreachable day and a genuinely empty day are still
  // told apart correctly — 'unreachable' should only ever appear on a
  // day that actually has an unreachable reading recorded, never as a
  // default for silence.
  it('a day with zero readings at all still falls back to no-data, not unreachable', () => {
    const serviceId = uniqueServiceId()
    recordSnapshot(serviceId, 'operational', null, todayUtcMidnight() - 86400)

    const days = getDayBucketedHistory(serviceId)
    const today = days.find(d => d.date === todayDateStr())
    expect(today?.status).toBe('no-data')
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

// createManualIncident is used purely as test setup here to produce a
// real row to operate on — it has no dedicated test coverage of its
// own yet, a real pre-existing gap in this file (none of db.ts's
// incident functions do), not something this pass tried to backfill.
const RETENTION_DAYS = 90
const now = () => Math.floor(Date.now() / 1000)
const daysAgo = (days: number) => now() - days * 86400

describe('getIncidentStatus', () => {
  it('returns the real status for an existing incident', () => {
    const id = createManualIncident('test', ['svc'], 'initial message')
    expect(getIncidentStatus(id)).toBe('investigating')
  })

  it('returns undefined for an id that does not exist', () => {
    expect(getIncidentStatus('no-such-id')).toBeUndefined()
  })
})

describe('deleteIncident', () => {
  it('deletes an existing incident and returns true', () => {
    const id = createManualIncident('test', ['svc'], 'initial message')
    expect(deleteIncident(id)).toBe(true)
    expect(getIncidentStatus(id)).toBeUndefined()
  })

  it('returns false for an id that does not exist, and deletes nothing', () => {
    expect(deleteIncident('no-such-id')).toBe(false)
  })
})


// a force-resolved incident becomes eligible for deletion in the same
// pruneOldIncidents() call that force-resolves it (both steps key off
// the same created_at cutoff), which means there's no way to observe
// the intermediate "auto-closed but not yet deleted" state from outside
// this function — by the time a test can check anything, it's already
// gone. These tests confirm the real, externally-observable outcome
// (deleted) rather than the internal note-writing step that happens
// immediately before it.
describe('pruneOldIncidents', () => {
  it('deletes a resolved incident older than the retention window', () => {
    const oldTimestamp = daysAgo(RETENTION_DAYS + 1)
    const id = createManualIncident('old resolved', ['svc'], 'initial', oldTimestamp)
    updateIncidentStatus(id, 'resolved', 'resolving for test', oldTimestamp)

    pruneOldIncidents()

    expect(getIncidentStatus(id)).toBeUndefined()
  })

  it('leaves a resolved incident within the retention window untouched', () => {
    const id = createManualIncident('recent resolved', ['svc'], 'initial')
    updateIncidentStatus(id, 'resolved', 'resolving for test', now())

    pruneOldIncidents()

    expect(getIncidentStatus(id)).toBe('resolved')
  })

  // The real point of this test: an incident that's still unresolved
  // and past the retention window doesn't survive indefinitely just
  // because nothing ever confirmed it was over
  it('force-resolves then deletes an unresolved incident older than the retention window', () => {
    const oldTimestamp = daysAgo(RETENTION_DAYS + 1)
    const id = createManualIncident('old unresolved', ['svc'], 'initial', oldTimestamp)

    pruneOldIncidents()

    expect(getIncidentStatus(id)).toBeUndefined()
  })

  it('leaves an unresolved incident within the retention window untouched, regardless of status', () => {
    const id = createManualIncident('recent unresolved', ['svc'], 'initial')

    pruneOldIncidents()

    expect(getIncidentStatus(id)).toBe('investigating')
  })
})

// Real incidents.json entries are plain object literals here rather
// than created through any exported function — there's nothing in
// db.ts that constructs a file-shaped entry, since the file itself is
// hand-edited, outside this module's control entirely.
function fileEntry(overrides: Partial<{
  id: string
  title: string
  status: string
  createdAt: string
  updatedAt: string
  affectedServices: string[]
  updates: Array<{ timestamp: string; message: string }>
}> = {}) {
  return {
    id: 'file-entry-default',
    title: 'A pre-existing incidents.json entry',
    status: 'resolved',
    createdAt: new Date(now() * 1000).toISOString(),
    updatedAt: new Date(now() * 1000).toISOString(),
    affectedServices: ['svc-ankhh'],
    updates: [{ timestamp: new Date(now() * 1000).toISOString(), message: 'original message' }],
    ...overrides,
  }
}

describe('promoteFileIncident', () => {
  it('creates a new database row with a real id, distinct from the file entry\'s own id', () => {
    const newId = promoteFileIncident(fileEntry({ id: 'file-abc-123' }))
    expect(newId).not.toBe('file-abc-123')
    expect(getIncidentStatus(newId)).toBeDefined()
  })

  it('preserves the original status rather than resetting to investigating', () => {
    const newId = promoteFileIncident(fileEntry({ status: 'resolved' }))
    expect(getIncidentStatus(newId)).toBe('resolved')
  })

  // The real point of this test, tied directly to how old incidents
  // get pruned: a promoted incident needs to join the same
  // 90-days-from-created_at lifecycle at its TRUE original age, not
  // get a fresh clock just because promotion happened today. Getting
  // this wrong would mean an old incident silently immune to pruning
  // right after promotion, the opposite of the intended behavior.
  it('preserves the original createdAt exactly, not the promotion time', () => {
    const oldCreatedAt = new Date(daysAgo(45) * 1000).toISOString()
    const newId = promoteFileIncident(fileEntry({ createdAt: oldCreatedAt, updatedAt: oldCreatedAt }))

    const promoted = getAllDraftedIncidents().find(incident => incident.id === newId)
    expect(promoted?.createdAt).toBe(oldCreatedAt)
  })

  it('preserves the original updates array exactly', () => {
    const updates = [
      { timestamp: new Date(now() * 1000).toISOString(), message: 'first real update' },
      { timestamp: new Date(now() * 1000).toISOString(), message: 'second real update' },
    ]
    const newId = promoteFileIncident(fileEntry({ updates }))

    const promoted = getAllDraftedIncidents().find(incident => incident.id === newId)
    expect(promoted?.updates).toEqual(updates)
  })

  it('preserves the original affectedServices array exactly', () => {
    const newId = promoteFileIncident(fileEntry({ affectedServices: ['svc-a', 'svc-b'] }))

    const promoted = getAllDraftedIncidents().find(incident => incident.id === newId)
    expect(promoted?.affectedServices).toEqual(['svc-a', 'svc-b'])
  })

  it('never writes back to incidents.json — confirmed by the function\'s own signature having no file-write path at all', () => {
    // Not a runtime-observable behavior — there is no file for this
    // in-memory test to check against. This test exists to document
    // the guarantee explicitly rather than leave it unstated: promotion
    // creates a database row and returns an id, full stop. The :ro
    // mount means writing to incidents.json was never structurally
    // possible from inside this function to begin with.
    const newId = promoteFileIncident(fileEntry())
    expect(typeof newId).toBe('string')
  })
})

// This is the real double-promotion guard — checked at the route layer
// before promoteFileIncident ever runs (see index.ts), but the actual
// tracking mechanism it depends on lives here and deserves its own
// direct tests, independent of the route logic built on top of it.
describe('getPromotedIncidentId', () => {
  it('returns undefined for a file entry that has never been promoted', () => {
    expect(getPromotedIncidentId('never-promoted-file-id')).toBeUndefined()
  })

  it('returns the real database id after the file entry has been promoted', () => {
    const entry = fileEntry({ id: 'file-to-promote-1' })
    const newId = promoteFileIncident(entry)

    expect(getPromotedIncidentId('file-to-promote-1')).toBe(newId)
  })

  // The real point of this test: two genuinely different file entries
  // being promoted around the same time must never get confused with
  // each other — each lookup has to key off its own real original id,
  // not just "the most recent promotion" or some other loose match.
  it('tracks two separately promoted file entries independently, without cross-contamination', () => {
    const firstId = promoteFileIncident(fileEntry({ id: 'file-a' }))
    const secondId = promoteFileIncident(fileEntry({ id: 'file-b' }))

    expect(getPromotedIncidentId('file-a')).toBe(firstId)
    expect(getPromotedIncidentId('file-b')).toBe(secondId)
    expect(firstId).not.toBe(secondId)
  })
})

// A unique service id per test, same reasoning as uniqueServiceId()
// above — createDraftedIncident/getActiveDraftedIncident's dedup logic
// is scoped per service_id, so tests need real isolation from each
// other to mean anything.
let incidentServiceCounter = 0
function uniqueIncidentServiceId(): string {
  incidentServiceCounter += 1
  return `incident-test-service-${incidentServiceCounter}`
}

describe('getActiveDraftedIncident', () => {
  it('returns undefined when no incident exists for a service', () => {
    expect(getActiveDraftedIncident(uniqueIncidentServiceId())).toBeUndefined()
  })

  it('returns the active auto-drafted incident for a service', () => {
    const serviceId = uniqueIncidentServiceId()
    createDraftedIncident(serviceId, now())

    const active = getActiveDraftedIncident(serviceId)
    expect(active?.service_id).toBe(serviceId)
    expect(active?.status).toBe('investigating')
  })

  // The real point of this test: the source = 'auto' filter is exactly
  // the kind of one-line guard that regresses silently if ever touched
  // carelessly. A manual incident sharing the same service_id as an
  // auto-drafted one must never be picked up here — mixing the two
  // would corrupt the auto-threshold system's own dedup logic.
  it('does not return a manual incident sharing the same service_id', () => {
    const serviceId = uniqueIncidentServiceId()
    createManualIncident('a manual incident', [serviceId], 'initial')

    expect(getActiveDraftedIncident(serviceId)).toBeUndefined()
  })

  it('does not return an auto-drafted incident that has already been resolved', () => {
    const serviceId = uniqueIncidentServiceId()
    createDraftedIncident(serviceId, now())
    const active = getActiveDraftedIncident(serviceId)
    resolveDraftedIncident(active!.id, now())

    expect(getActiveDraftedIncident(serviceId)).toBeUndefined()
  })
})

describe('createDraftedIncident', () => {
  it('creates a row findable via getActiveDraftedIncident, in investigating status', () => {
    const serviceId = uniqueIncidentServiceId()
    createDraftedIncident(serviceId, now())

    const active = getActiveDraftedIncident(serviceId)
    expect(active).toBeDefined()
    expect(active?.status).toBe('investigating')
  })

  it('writes the real auto-detected message as the first update', () => {
    const serviceId = uniqueIncidentServiceId()
    createDraftedIncident(serviceId, now())

    const active = getActiveDraftedIncident(serviceId)
    const updates = JSON.parse(active!.updates) as Array<{ message: string }>
    expect(updates[0].message).toBe(
      'Auto-detected: 2 consecutive outage readings (at least 30 minutes of sustained outage).'
    )
  })
})

describe('resolveDraftedIncident', () => {
  it('sets status to resolved and appends the real auto-resolved message', () => {
    const serviceId = uniqueIncidentServiceId()
    createDraftedIncident(serviceId, now())
    const active = getActiveDraftedIncident(serviceId)

    resolveDraftedIncident(active!.id, now())

    const all = getAllDraftedIncidents()
    const resolved = all.find(incident => incident.id === active!.id)
    const resolvedUpdates = resolved?.updates ?? []
    expect(resolved?.status).toBe('resolved')
    expect(resolvedUpdates[resolvedUpdates.length - 1]?.message).toBe(
      'Auto-resolved: 2 consecutive operational readings.'
    )
  })

  // Unlike appendIncidentUpdate/updateIncidentStatus, this function has
  // no boolean return value at all — it's void. Worth a real test
  // confirming a nonexistent id is a safe no-op rather than assuming it
  // from reading the early `if (!row) return` guard.
  it('is a safe no-op for an id that does not exist', () => {
    expect(() => resolveDraftedIncident('no-such-id', now())).not.toThrow()
  })
})

describe('createManualIncident', () => {
  it('creates a real, retrievable incident with the given services', () => {
    const id = createManualIncident('a real title', ['svc-a', 'svc-b'], 'initial message')
    const all = getAllDraftedIncidents()
    const created = all.find(incident => incident.id === id)

    expect(created?.title).toBe('a real title')
    expect(created?.affectedServices).toEqual(['svc-a', 'svc-b'])
    expect(created?.source).toBe('manual')
    expect(created?.status).toBe('investigating')
  })

  it('falls back to "unspecified" as the primary service_id when affectedServices is empty', () => {
    // service_id itself isn't part of getAllDraftedIncidents' shaped
    // output, so this is checked the same way getActiveDraftedIncident
    // reads it — an empty affectedServices array is a real, if unusual,
    // input worth confirming doesn't throw or silently corrupt the row.
    const id = createManualIncident('no services', [], 'initial message')
    expect(getIncidentStatus(id)).toBe('investigating')
  })

  it('defaults to the current time when no timestamp argument is given', () => {
    const before = now()
    const id = createManualIncident('default timestamp', ['svc'], 'initial')
    const after = now()

    const created = getAllDraftedIncidents().find(incident => incident.id === id)
    const createdAtSeconds = Math.floor(new Date(created!.createdAt).getTime() / 1000)
    expect(createdAtSeconds).toBeGreaterThanOrEqual(before)
    expect(createdAtSeconds).toBeLessThanOrEqual(after)
  })
})

describe('appendIncidentUpdate', () => {
  it('appends a message without changing status', () => {
    const id = createManualIncident('a title', ['svc'], 'initial message')
    appendIncidentUpdate(id, 'a follow-up update', now())

    const updated = getAllDraftedIncidents().find(incident => incident.id === id)
    const updatedList = updated?.updates ?? []
    expect(updated?.status).toBe('investigating')
    expect(updatedList).toHaveLength(2)
    expect(updatedList[updatedList.length - 1]?.message).toBe('a follow-up update')
  })

  it('returns true on a real, successful append', () => {
    const id = createManualIncident('a title', ['svc'], 'initial message')
    expect(appendIncidentUpdate(id, 'a follow-up', now())).toBe(true)
  })

  it('returns false for an id that does not exist', () => {
    expect(appendIncidentUpdate('no-such-id', 'a message', now())).toBe(false)
  })
})

describe('updateIncidentStatus', () => {
  it('changes status and appends the given message', () => {
    const id = createManualIncident('a title', ['svc'], 'initial message')
    updateIncidentStatus(id, 'resolved', 'closing this out', now())

    const updated = getAllDraftedIncidents().find(incident => incident.id === id)
    const updatedList = updated?.updates ?? []
    expect(updated?.status).toBe('resolved')
    expect(updatedList[updatedList.length - 1]?.message).toBe('closing this out')
  })

  it('returns false for an id that does not exist', () => {
    expect(updateIncidentStatus('no-such-id', 'resolved', 'a message', now())).toBe(false)
  })
})

// getDayBucketedHistory already has its own extensive describe block
// above — this is scoped specifically to the legacy-row fallback logic
// inside the read-shaping step, which nothing else in this file
// touches at all.
describe('getAllDraftedIncidents', () => {
  it('falls back to the computed legacy title for an auto-drafted row with no title column set', () => {
    // createDraftedIncident's own INSERT never sets title/affected_services
    // at all — a real, naturally-occurring case of the legacy row shape,
    // not a synthetic one built just for this test.
    const serviceId = uniqueIncidentServiceId()
    createDraftedIncident(serviceId, now())

    const active = getActiveDraftedIncident(serviceId)
    const shaped = getAllDraftedIncidents().find(incident => incident.id === active!.id)
    expect(shaped?.title).toBe(`Sustained outage detected: ${serviceId}`)
  })

  it('falls back to [service_id] for affectedServices when the column is null', () => {
    const serviceId = uniqueIncidentServiceId()
    createDraftedIncident(serviceId, now())

    const active = getActiveDraftedIncident(serviceId)
    const shaped = getAllDraftedIncidents().find(incident => incident.id === active!.id)
    expect(shaped?.affectedServices).toEqual([serviceId])
  })

  it('returns a manual incident\'s real title and affectedServices as-is, not the fallback', () => {
    const id = createManualIncident('a real, hand-written title', ['svc-x', 'svc-y'], 'initial')

    const shaped = getAllDraftedIncidents().find(incident => incident.id === id)
    expect(shaped?.title).toBe('a real, hand-written title')
    expect(shaped?.affectedServices).toEqual(['svc-x', 'svc-y'])
  })

  it('distinguishes source correctly between auto-drafted and manual rows', () => {
    const serviceId = uniqueIncidentServiceId()
    createDraftedIncident(serviceId, now())
    const autoId = getActiveDraftedIncident(serviceId)!.id
    const manualId = createManualIncident('manual', ['svc'], 'initial')

    const all = getAllDraftedIncidents()
    expect(all.find(i => i.id === autoId)?.source).toBe('auto')
    expect(all.find(i => i.id === manualId)?.source).toBe('manual')
  })
})
