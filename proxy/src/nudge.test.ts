import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { deriveOverallStatus, deriveZabbixStatus } from './nudge'

interface OverallStatusFixture {
  statuses: Array<'operational' | 'degraded' | 'outage' | 'unknown'>
  expected: 'operational' | 'degraded' | 'outage' | 'unknown'
}

interface ZabbixFixture {
  interfaces: Array<{ type: string; available: string }>
  expected: 'operational' | 'degraded' | 'outage' | 'unknown'
}

// Fixtures live at the repo root, shared with the client's own parity
// tests — see 04-Services Index's "On duplicating this file's logic
// into the proxy" and 18-Automated Test Coverage's Phase 2 plan. Same
// input/output pairs, read independently by both suites; if either
// copy of the logic ever drifts, this test (or the client's) fails
// immediately instead of shipping a silent disagreement — the direct
// fix for how the real 07-24-2026 nut_exporter/nut bug went unnoticed.
const overallStatusFixtures = JSON.parse(
  readFileSync(path.join(__dirname, '../../fixtures/parity/overall-status.json'), 'utf-8')
) as OverallStatusFixture[]

const zabbixFixtures = JSON.parse(
  readFileSync(path.join(__dirname, '../../fixtures/parity/zabbix-availability.json'), 'utf-8')
) as ZabbixFixture[]

describe('deriveOverallStatus (proxy copy)', () => {
  for (const { statuses, expected } of overallStatusFixtures) {
    it(`[${statuses.join(', ') || 'empty'}] -> ${expected}`, () => {
      expect(deriveOverallStatus(statuses)).toBe(expected)
    })
  }
})

describe('deriveZabbixStatus (proxy copy)', () => {
  for (const { interfaces, expected } of zabbixFixtures) {
    it(`-> ${expected}`, () => {
      expect(deriveZabbixStatus(interfaces)).toBe(expected)
    })
  }
})
