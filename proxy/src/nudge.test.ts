import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { deriveOverallStatus, deriveZabbixStatus, compareSignature } from './nudge'

interface OverallStatusFixture {
  statuses: Array<'operational' | 'degraded' | 'outage' | 'unknown'>
  expected: 'operational' | 'degraded' | 'outage' | 'unknown'
}

interface ZabbixFixture {
  interfaces: Array<{ type: string; available: string }>
  expected: 'operational' | 'degraded' | 'outage' | 'unknown'
}

// Fixtures live at the repo root, shared with the client's own parity
// tests. Same input/output pairs, read independently by both suites;
// if either copy of the logic ever drifts, this test (or the client's)
// fails immediately instead of shipping a silent disagreement — the
// direct fix for how a real past bug involving mismatched metric job
// names went unnoticed for a while.
const overallStatusFixtures = JSON.parse(
  readFileSync(path.join(__dirname, '../../fixtures/parity/overall-status.json'), 'utf-8')
) as OverallStatusFixture[]

const zabbixFixtures = JSON.parse(
  readFileSync(path.join(__dirname, '../../fixtures/parity/zabbix-availability.json'), 'utf-8')
) as ZabbixFixture[]

describe('deriveOverallStatus (proxy copy)', () => {
  // Same table-driven pattern as the client's own copy of this test —
  // one generated case per fixture entry, read from the exact same
  // JSON file the client reads. This is the half of the parity check
  // that lives on the proxy side; a matching describe block in the
  // client's own test suite reads the identical fixtures against its
  // own copy of the same logic.
  for (const { statuses, expected } of overallStatusFixtures) {
    it(`[${statuses.join(', ') || 'empty'}] -> ${expected}`, () => {
      expect(deriveOverallStatus(statuses)).toBe(expected)
    })
  }
})

describe('deriveZabbixStatus (proxy copy)', () => {
  // Same idea as above, for the proxy's copy of the Zabbix
  // availability-derivation logic.
  for (const { interfaces, expected } of zabbixFixtures) {
    it(`-> ${expected}`, () => {
      expect(deriveZabbixStatus(interfaces)).toBe(expected)
    })
  }
})

describe('compareSignature', () => {
  // The one case that actually matters most in production: a proxy
  // restart wipes any in-memory "previous signature" it was tracking.
  // Without this special case, the very next tick after a restart would
  // compare a real signature against null and read as "changed,"
  // firing a spurious nudge to every connected client for a status that
  // hasn't actually changed at all — just been observed for the first
  // time since the proxy came back up.
  it('treats a null previous signature as initial, not changed', () => {
    expect(compareSignature(null, 'anything')).toBe('initial')
  })

  // The genuinely-changed case — two different real signatures should
  // read as 'changed', not accidentally fall into the 'initial' bucket
  // just because the comparison logic is checking the wrong condition.
  it('reports changed when the signature differs from the previous one', () => {
    expect(compareSignature('sig-a', 'sig-b')).toBe('changed')
  })

  // The steady-state case — most ticks in production will land here,
  // since most 20-second intervals won't see any real status change.
  // This is the case that has to be cheap and correct far more often
  // than the other two combined.
  it('reports unchanged when the signature matches the previous one', () => {
    expect(compareSignature('sig-a', 'sig-a')).toBe('unchanged')
  })
})
