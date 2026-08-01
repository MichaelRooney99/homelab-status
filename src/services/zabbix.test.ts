import { describe, it, expect } from 'vitest'
import { deriveAvailability } from './zabbix'

describe('deriveAvailability', () => {
  it('maps available "1" to operational', () => {
    expect(deriveAvailability([{ type: '1', available: '1' }])).toBe('operational')
  })

  it('maps available "2" to outage', () => {
    expect(deriveAvailability([{ type: '1', available: '2' }])).toBe('outage')
  })

  it('maps available "0" (unknown) to unknown', () => {
    expect(deriveAvailability([{ type: '1', available: '0' }])).toBe('unknown')
  })

  it('returns unknown when there is no agent interface (type "1") at all', () => {
    expect(deriveAvailability([{ type: '2', available: '1' }])).toBe('unknown')
  })

  it('returns unknown for an empty interfaces array', () => {
    expect(deriveAvailability([])).toBe('unknown')
  })

  // Guards against exactly the shape of the real 07-24-2026 bug — a
  // second interface present alongside the real agent one shouldn't be
  // able to override the correct reading.
  it('reads the agent interface specifically, not just the first one in the array', () => {
    const result = deriveAvailability([
      { type: '2', available: '2' }, // some other interface, reporting outage
      { type: '1', available: '1' }, // the actual agent interface, reporting operational
    ])
    expect(result).toBe('operational')
  })
})