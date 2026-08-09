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
  for (const { interfaces, expected } of fixtures) {
    it(`derives ${expected} from ${JSON.stringify(interfaces)}`, () => {
      expect(deriveAvailability(interfaces)).toBe(expected)
    })
  }

  // Named separately from the fixture loop specifically to call out why
  // it matters — guards against exactly the shape of the real
  // 07-24-2026 bug, a second interface overriding the real agent one.
  it('reads the agent interface specifically, not just the first one in the array', () => {
    const result = deriveAvailability([
      { type: '2', available: '2' },
      { type: '1', available: '1' },
    ])
    expect(result).toBe('operational')
  })
})
