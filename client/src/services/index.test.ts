import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deriveOverallStatus } from '.'
import type { ServiceStatus, Status } from './types'

interface OverallStatusFixture {
  statuses: Status[]
  expected: Status
}

// import.meta.url, not __dirname — this package builds as ESM (Vite),
// which has no CommonJS __dirname global. proxy/'s equivalent test file
// can use __dirname directly since proxy/ builds as CommonJS.
const currentDir = path.dirname(fileURLToPath(import.meta.url))

const fixtures = JSON.parse(
  readFileSync(path.join(currentDir, '../../../fixtures/parity/overall-status.json'), 'utf-8')
) as OverallStatusFixture[]

// deriveOverallStatus only ever reads .status off each service — every
// other ServiceStatus field is irrelevant here, so fixture statuses get
// wrapped in a minimal stand-in rather than a fully realistic object.
function toServices(statuses: Status[]): ServiceStatus[] {
  return statuses.map((status, i) => ({
    id: `fixture-${i}`,
    name: `Fixture ${i}`,
    category: 'Fixture',
    status,
    metadata: {},
  }))
}

describe('deriveOverallStatus', () => {
  for (const { statuses, expected } of fixtures) {
    it(`[${statuses.join(', ') || 'empty'}] -> ${expected}`, () => {
      expect(deriveOverallStatus(toServices(statuses))).toBe(expected)
    })
  }
})
