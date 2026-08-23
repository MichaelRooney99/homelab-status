//normalizes and shapes the data from the status page api (prometheus, grafana, NUT, Proxmox, Zabbix) into a format that is easier to work with in the app.

export type Status = 'operational' | 'degraded' | 'outage' | 'unknown' //up, sub-optimal, maintenance, unknown

export interface ServiceStatus {
  id: string
  name: string
  category: string
  status: Status
  metadata?: Record<string, string>
}

export interface IncidentUpdate {
  timestamp: string
  message: string
}

export type IncidentStatus = 'investigating' | 'identified' | 'monitoring' | 'resolved' 

export interface Incident {
  id: string
  title: string
  status: IncidentStatus
  createdAt: string
  updatedAt: string
  affectedServices: string[]
  updates: IncidentUpdate[]
  // Optional, and absent means 'manual' — every incident in incidents.json
  // predates this field, so treating a missing source as manual (rather
  // than requiring every hand-written entry to be edited) keeps the file
  // backward-compatible. Auto-drafted incidents always set this
  // explicitly.
  source?: 'manual' | 'auto'
}

export interface StatusPage {
  overall: Status
  services: ServiceStatus[]
  incidents: Incident[]
  lastUpdated: string
  // Category names whose adapter promise actually rejected this fetch —
  // not "this category has zero services" (a legitimate, quiet state),
  // but "the source itself couldn't be reached at all." Empty when
  // everything succeeded. Lets the UI show an honest "this data source
  // is currently unavailable" message instead of a category silently
  // vanishing with no explanation.
  unavailableCategories: string[]
}

//need something to hold "history" of the status for each day, so I can show a graph of the uptime over time.
//  This will be used to show the uptime percentage for the last 90 days, and also to show a graph of the uptime over time.
// 'unreachable' is genuinely different from 'unknown' or 'no-data' — it
// means the monitoring source itself couldn't be reached for that day,
// not that a reading came back uninformative (unknown) or that nothing
// was ever recorded (no-data, which also covers a service's history
// before it existed). All three end up looking like "we don't have a
// real status" to a casual glance, but only 'unreachable' means the
// visibility gap itself is the actual, known problem.
export type DayStatus = 'operational' | 'degraded' | 'outage' | 'unknown' | 'no-data' | 'unreachable'

export interface UptimeDay {
  date: string
  status: DayStatus
}
