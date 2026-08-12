import { describe, it, expect } from 'vitest'
import { decideIncidentAction, THRESHOLD_READINGS } from './poller'

describe('decideIncidentAction', () => {
  // decideIncidentAction has exactly three possible outputs (draft,
  // resolve, none) driven by two inputs (the recent readings, and
  // whether an incident is already active). The tests below
  // deliberately cover every real combination of "sustained outage /
  // sustained recovery / mixed readings" against "incident already
  // active / not active" — a decision matrix, not just a handful of
  // spot checks — so a change to the underlying logic can't
  // accidentally break one combination while every other test still
  // passes.

  // Guards the threshold itself, not just the eventual decision — one
  // reading short of THRESHOLD_READINGS must still be "not enough
  // evidence yet," regardless of what those readings actually say.
  it('does nothing when there is not enough history yet', () => {
    const tooFew = Array(THRESHOLD_READINGS - 1).fill('outage')
    expect(decideIncidentAction(tooFew, false)).toBe('none')
  })

  it('drafts an incident on a sustained outage with none already active', () => {
    const readings = Array(THRESHOLD_READINGS).fill('outage')
    expect(decideIncidentAction(readings, false)).toBe('draft')
  })

  // The dedup case — a second sustained-outage streak while one
  // incident is already open should extend it, not spawn a duplicate.
  // decideIncidentAction itself doesn't do the extending (that's the
  // caller's job once it gets 'none' back here); this test just
  // confirms it correctly declines to draft a second one.
  it('does not draft a second incident when one is already active', () => {
    const readings = Array(THRESHOLD_READINGS).fill('outage')
    expect(decideIncidentAction(readings, true)).toBe('none')
  })

  it('resolves an active incident on sustained recovery', () => {
    const readings = Array(THRESHOLD_READINGS).fill('operational')
    expect(decideIncidentAction(readings, true)).toBe('resolve')
  })

  // The other half of "recovery" only matters if there's something to
  // recover from — sustained good readings with nothing active should
  // just be silence, not an attempt to resolve an incident that was
  // never opened.
  it('does nothing on sustained recovery when nothing is active to resolve', () => {
    const readings = Array(THRESHOLD_READINGS).fill('operational')
    expect(decideIncidentAction(readings, false)).toBe('none')
  })

  // The actual reason this is 2 consecutive readings and not 1 — a
  // single-tick blip that recovers immediately shouldn't draft anything.
  it('does nothing on mixed readings with no active incident', () => {
    expect(decideIncidentAction(['outage', 'operational'], false)).toBe('none')
  })

  // Equally important in the other direction — a service that's still
  // flapping shouldn't get auto-resolved just because its most recent
  // reading happened to be good.
  it('leaves an active incident open on mixed readings, does not resolve early', () => {
    expect(decideIncidentAction(['outage', 'operational'], true)).toBe('none')
  })

  // Confirms the threshold is a minimum, not an exact match — the real
  // poller will often have accumulated more than THRESHOLD_READINGS
  // outage readings by the time this function runs, and it should still
  // draft correctly rather than only firing on the exact count.
  it('drafts on more than the threshold count of sustained outage readings too', () => {
    const readings = Array(THRESHOLD_READINGS + 3).fill('outage')
    expect(decideIncidentAction(readings, false)).toBe('draft')
  })
})
