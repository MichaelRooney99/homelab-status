import { DatabaseSync } from 'node:sqlite'
import path from 'path'

// Same override pattern as INCIDENTS_FILE_PATH in index.ts — the actual
// on-disk location is a deployment concern (docker-compose mounts a
// persistent named volume here), not something this file should guess
// about the container's working directory. Falls back to a path
// relative to this file for local dev, where there's no volume.
const DB_PATH = process.env.SNAPSHOTS_DB_PATH
  ?? path.join(__dirname, '..', 'snapshots.db')

const db = new DatabaseSync(DB_PATH)

db.exec(`
  CREATE TABLE IF NOT EXISTS snapshots (
    service_id TEXT NOT NULL,
    timestamp  INTEGER NOT NULL,
    status     TEXT NOT NULL,
    PRIMARY KEY (service_id, timestamp)
  )
`)

// CREATE TABLE IF NOT EXISTS only helps for a brand-new database — this
// table already has real accumulated production history, so adding a
// column needs an explicit ALTER TABLE. SQLite has no "ADD COLUMN IF
// NOT EXISTS", so this is guarded with a try/catch instead: the first
// time this runs against an already-migrated database, ALTER TABLE
// throws "duplicate column name," which is expected and safe to ignore.
try {
  db.exec(`ALTER TABLE snapshots ADD COLUMN response_time_ms INTEGER`)
} catch {
  // Already migrated — nothing to do.
}

const RETENTION_DAYS = 90
const HISTORY_DAYS = 90

const insertStmt = db.prepare(
  'INSERT OR REPLACE INTO snapshots (service_id, timestamp, status, response_time_ms) VALUES (?, ?, ?, ?)'
)

export function recordSnapshot(
  serviceId: string,
  status: string,
  responseTimeMs: number | null = null,
  timestamp: number = Math.floor(Date.now() / 1000)
): void {
  insertStmt.run(serviceId, timestamp, status, responseTimeMs)
}

export function pruneOldSnapshots(): void {
  const cutoff = Math.floor(Date.now() / 1000) - RETENTION_DAYS * 86400
  db.prepare('DELETE FROM snapshots WHERE timestamp < ?').run(cutoff)
}

interface SnapshotRow {
  timestamp: number
  status: string
}

// Severity ranking for the "worst status of the day" rollup, decided in
// 14-Full-Category History.md — outage is worst, operational is best.
// 'unknown' readings are deliberately excluded from this ranking rather
// than treated as a severity level: an unknown reading doesn't tell us
// the service was degraded, it tells us we don't know, which isn't the
// same thing as a bad reading and shouldn't count as one.
const SEVERITY: Record<string, number> = {
  outage: 3,
  degraded: 2,
  operational: 1,
}

export function getDayBucketedHistory(
  serviceId: string
): Array<{ date: string; status: string }> {
  const end = Math.floor(Date.now() / 1000)
  const start = end - HISTORY_DAYS * 86400

  const rows = db
    .prepare(
      'SELECT timestamp, status FROM snapshots WHERE service_id = ? AND timestamp >= ? ORDER BY timestamp ASC'
    )
    .all(serviceId, start) as unknown as SnapshotRow[]

  const worstByDate = new Map<string, string>()

  for (const row of rows) {
    const dateStr = new Date(row.timestamp * 1000).toISOString().split('T')[0]
    const severity = SEVERITY[row.status]
    if (severity === undefined) continue // 'unknown' readings excluded, see above

    const currentWorst = worstByDate.get(dateStr)
    const currentSeverity = currentWorst ? SEVERITY[currentWorst] : 0

    if (severity > currentSeverity) {
      worstByDate.set(dateStr, row.status)
    }
  }

  // Same UTC-midnight anchoring as the client's history.ts uses for its
  // Prometheus-backed days — this exact class of mistake (anchoring to
  // "now" instead of a fixed calendar boundary) already caused a real
  // bug once in this project; not repeating it here.
  const today = new Date()
  const todayUtcMidnight =
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) / 1000

  const result: Array<{ date: string; status: string }> = []

  for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
    const dateStr = new Date((todayUtcMidnight - i * 86400) * 1000)
      .toISOString()
      .split('T')[0]
    result.push({
      date: dateStr,
      status: worstByDate.get(dateStr) ?? 'no-data',
    })
  }

  return result
}

interface RawSnapshotRow {
  timestamp: number
  status: string
  response_time_ms: number | null
}

const RECENT_HOURS = 24

// Unlike getDayBucketedHistory, this returns every individual reading
// from the last 24 hours rather than one rolled-up value per day — the
// per-service detail view needs the real granularity to draw a
// response-time chart and a status log, not a single worst-of-day
// verdict. Same data source (this table), different shape of question.
export function getRawSnapshots(serviceId: string): RawSnapshotRow[] {
  const cutoff = Math.floor(Date.now() / 1000) - RECENT_HOURS * 3600

  return db
    .prepare(
      'SELECT timestamp, status, response_time_ms FROM snapshots WHERE service_id = ? AND timestamp >= ? ORDER BY timestamp ASC'
    )
    .all(serviceId, cutoff) as unknown as RawSnapshotRow[]
}