import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deriveAvailability } from './zabbix'

interface ZabbixFixture {
  interfaces: Array<{ type: string; available: string }>
  expected: 'operational' | 'degraded' | 'outage' | 'unknown'
}

const currentDir = path.dirname(fileURLToPath(import.meta.url))

const fixtures = JSON.parse(
  readFileSync(path.join(currentDir, '../../../fixtures/parity/zabbix-availability.json'), 'utf-8')
) as ZabbixFixture[]

describe('deriveAvailability', () => {
  // Same table-driven pattern as index.test.ts — one generated test per
  // fixture entry, test name built from the actual input/output pair.
  for (const { interfaces, expected } of fixtures) {
    it(`derives ${expected} from ${JSON.stringify(interfaces)}`, () => {
      expect(deriveAvailability(interfaces)).toBe(expected)
    })
  }

  // Named separately from the fixture loop above specifically to call
  // out why it matters, rather than letting it blend into a generic
  // fixture case: guards against exactly the shape of a real past bug,
  // where a second interface in the array silently overrode the real
  // agent one. A generic "does the function work" test wouldn't
  // necessarily catch a regression here — this one deliberately puts a
  // decoy interface first in the array to prove the lookup is by type,
  // not by array position.
  it('reads the agent interface specifically, not just the first one in the array', () => {
    const result = deriveAvailability([
      { type: '2', available: '2' },
      { type: '1', available: '1' },
    ])
    expect(result).toBe('operational')
  })
})
