import { describe, it, expect } from 'vitest'
import { decideIncidentAction, THRESHOLD_READINGS } from './poller'

describe('decideIncidentAction', () => {
  it('does nothing when there is not enough history yet', () => {
    const tooFew = Array(THRESHOLD_READINGS - 1).fill('outage')
    expect(decideIncidentAction(tooFew, false)).toBe('none')
  })

  it('drafts an incident on a sustained outage with none already active', () => {
    const readings = Array(THRESHOLD_READINGS).fill('outage')
    expect(decideIncidentAction(readings, false)).toBe('draft')
  })

  it('does not draft a second incident when one is already active', () => {
    const readings = Array(THRESHOLD_READINGS).fill('outage')
    expect(decideIncidentAction(readings, true)).toBe('none')
  })

  it('resolves an active incident on sustained recovery', () => {
    const readings = Array(THRESHOLD_READINGS).fill('operational')
    expect(decideIncidentAction(readings, true)).toBe('resolve')
  })

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

  it('drafts on more than the threshold count of sustained outage readings too', () => {
    const readings = Array(THRESHOLD_READINGS + 3).fill('outage')
    expect(decideIncidentAction(readings, false)).toBe('draft')
  })
})
