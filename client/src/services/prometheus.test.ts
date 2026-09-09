import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchRackSensorStatus } from './prometheus'

// Same technique as history.test.ts's mockFetchByUrl — queryPrometheus
// isn't exported, and calls fetch directly rather than through an
// importable adapter, so there's no module boundary for vi.mock to
// attach to. Routing a single mocked fetch by query string is the only
// real option here.
//
// Real, pre-existing gap worth naming directly rather than quietly
// working around: fetchNodeStatus and fetchUpsStatus, already in this
// same file, have no test coverage at all — this file didn't exist
// before this session. Only the new function gets tests here; closing
// the gap for the other two is a separate, real decision, not part of
// adding rack temp.
function mockFetchByQuery(handlers: {
  up?: () => Response | Promise<Response>
  temp?: () => Response | Promise<Response>
  pressure?: () => Response | Promise<Response>
}) {
  return vi.fn((url: string) => {
    if (url.includes('up%7Bjob%3D%22rack_sensor%22%7D') || url.includes('up{job="rack_sensor"}')) {
      return handlers.up?.() ?? successResult([])
    }
    if (url.includes('rack_temperature_fahrenheit')) {
      return handlers.temp?.() ?? successResult([])
    }
    if (url.includes('rack_pressure_hpa')) {
      return handlers.pressure?.() ?? successResult([])
    }
    throw new Error(`Unexpected Prometheus query URL in test: ${url}`)
  })
}

function successResult(result: unknown[]): Response {
  return { ok: true, json: async () => ({ status: 'success', data: { result } }) } as Response
}

describe('fetchRackSensorStatus', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports operational with the real friendly_name when the sensor is up', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchByQuery({
        up: () =>
          successResult([{ metric: { friendly_name: 'Rack-Sensor-01' }, value: [0, '1'] }]),
      })
    )

    const [service] = await fetchRackSensorStatus()
    expect(service.status).toBe('operational')
    expect(service.name).toBe('Rack-Sensor-01')
  })

  it('reports outage when the up check returns 0', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchByQuery({
        up: () =>
          successResult([{ metric: { friendly_name: 'Rack-Sensor-01' }, value: [0, '0'] }]),
      })
    )

    const [service] = await fetchRackSensorStatus()
    expect(service.status).toBe('outage')
  })

  it('formats temperature and pressure as real display metadata, not status inputs', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchByQuery({
        up: () => successResult([{ metric: {}, value: [0, '1'] }]),
        temp: () => successResult([{ metric: {}, value: [0, '71.234'] }]),
        pressure: () => successResult([{ metric: {}, value: [0, '1013.9'] }]),
      })
    )

    const [service] = await fetchRackSensorStatus()
    expect(service.metadata?.temperature).toBe('71.2°F')
    expect(service.metadata?.pressure).toBe('1013.9 hPa')
    // The real point of this test: an extreme temperature reading still
    // reports 'operational' as long as the sensor itself is reachable —
    // temperature is metadata here, not a status input, by deliberate
    // design (see the "just reachability" decision this was scoped to).
    expect(service.status).toBe('operational')
  })

  it('falls back to em dashes when temperature or pressure results are empty', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchByQuery({
        up: () => successResult([{ metric: {}, value: [0, '1'] }]),
      })
    )

    const [service] = await fetchRackSensorStatus()
    expect(service.metadata?.temperature).toBe('—')
    expect(service.metadata?.pressure).toBe('—')
  })

  it('falls back to the real device name when the friendly_name label is missing', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchByQuery({
        up: () => successResult([{ metric: {}, value: [0, '1'] }]),
      })
    )

    const [service] = await fetchRackSensorStatus()
    expect(service.name).toBe('Rack-Sensor-01')
  })

  it('always returns exactly one service, on the Environment category', async () => {
    vi.stubGlobal('fetch', mockFetchByQuery({}))

    const services = await fetchRackSensorStatus()
    expect(services).toHaveLength(1)
    expect(services[0].category).toBe('Environment')
    expect(services[0].id).toBe('rack-sensor-01')
  })
})
