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
  // backward-compatible. Auto-drafted incidents (see 16-Next-Round
  // Functionality.md) always set this explicitly.
  source?: 'manual' | 'auto'
}

export interface StatusPage {
  overall: Status
  services: ServiceStatus[]
  incidents: Incident[]
  lastUpdated: string
}

//need something to hold "history" of the status for each day, so we can show a graph of the uptime over time.
//  This will be used to show the uptime percentage for the last 90 days, and also to show a graph of the uptime over time.
export type DayStatus = 'operational' | 'degraded' | 'outage' | 'unknown' | 'no-data'

export interface UptimeDay {
  date: string
  status: DayStatus
}