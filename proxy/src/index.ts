import express from 'express'
import { createProxyMiddleware } from 'http-proxy-middleware'
import dotenv from 'dotenv'
import { readFile } from 'fs/promises'
import path from 'path'
import { startPoller } from './poller'
import { getDayBucketedHistory, getRawSnapshots, getAllDraftedIncidents } from './db'
import { addNudgeClient, removeNudgeClient, startNudgeChecker } from './nudge'

dotenv.config()

const app = express()
const PORT = process.env.PORT ?? 3001

// Overridable via env so the actual on-disk location is a deployment
// concern (docker-compose bind-mounts it), not something this file has
// to guess about the container's working directory. Falls back to a
// path relative to this file for local dev, where there's no mount.
const INCIDENTS_FILE = process.env.INCIDENTS_FILE_PATH
  ?? path.join(__dirname, '..', 'incidents.json')

// ── Environment variables ──────────────────────────────────────────
const PROXMOX_HOST = process.env.PROXMOX_HOST
const PROXMOX_TOKEN = process.env.PROXMOX_TOKEN
const ZABBIX_HOST = process.env.ZABBIX_HOST
const ZABBIX_USER = process.env.ZABBIX_USER
const ZABBIX_PASSWORD = process.env.ZABBIX_PASSWORD
const PROMETHEUS_HOST = process.env.PROMETHEUS_HOST ?? 'http://10.10.10.105:9090'

if (!PROXMOX_HOST || !PROXMOX_TOKEN) {
  console.error('PROXMOX_HOST and PROXMOX_TOKEN are required')
  process.exit(1)
}

if (!ZABBIX_HOST || !ZABBIX_USER || !ZABBIX_PASSWORD) {
  console.error('ZABBIX_HOST, ZABBIX_USER, and ZABBIX_PASSWORD are required')
  process.exit(1)
}

// ── Zabbix token cache ─────────────────────────────────────────────
let zabbixToken: string | null = null
let zabbixTokenExpiry = 0

interface ZabbixLoginResponse {
  jsonrpc: string
  result?: string
  error?: { data: string; message: string }
  id: number
}

async function getZabbixToken(): Promise<string> {
  const now = Date.now()

  if (zabbixToken && now < zabbixTokenExpiry) {
    return zabbixToken
  }

  const response = await fetch(`${ZABBIX_HOST}/api_jsonrpc.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json-rpc' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'user.login',
      params: { username: ZABBIX_USER, password: ZABBIX_PASSWORD },
      id: 1,
    }),
  })

  const json = await response.json() as ZabbixLoginResponse

  if (json.error) {
    throw new Error(`Zabbix login failed: ${json.error.data}`)
  }

  if (!json.result) {
    throw new Error('Zabbix login returned no token')
  }

  zabbixToken = json.result
  zabbixTokenExpiry = now + 14 * 60 * 1000
  return zabbixToken
}

// ── CORS ───────────────────────────────────────────────────────────
// POST added for the Zabbix route
app.use((req, res, next) => {
  res.setHeader(
    'Access-Control-Allow-Origin',
    process.env.CLIENT_ORIGIN ?? 'http://localhost:5173'
  )
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') {
    res.sendStatus(204)
    return
  }
  next()
})

// ── Health check ───────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

// ── Incidents ──────────────────────────────────────────────────────
// Reads the file fresh on every request rather than caching it in memory
// — same reasoning as always, the file is tiny and requests are
// infrequent. Now merges two genuinely different sources at read time:
// incidents.json (hand-edited, git-tracked, read-only inside this
// container) and drafted_incidents (poller-written, lives in the same
// snapshots.db the history endpoints already use). See
// 16-Next-Round Functionality.md for why these can't share one storage
// location. Every manual entry gets source: 'manual' stamped on if it
// doesn't already have one — every existing incidents.json entry
// predates this field, and defaulting here means the file itself never
// needed a one-time migration.
app.get('/incidents', async (_req, res) => {
  try {
    const raw = await readFile(INCIDENTS_FILE, 'utf-8')
    const manual = (JSON.parse(raw) as Array<Record<string, unknown>>).map(incident => ({
      source: 'manual',
      ...incident,
    }))
    const auto = getAllDraftedIncidents()
    res.json([...manual, ...auto])
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

// ── Full-category history (Proxmox API / Zabbix) ────────────────────
// Proxmox Nodes and Power get their 90-day history from Prometheus,
// which scrapes independently of whether anyone's looking at the page.
// Proxmox API and Zabbix have no equivalent — this proxy poller does
// the same job for them (see poller.ts), and this route hands back
// whatever it's recorded so far, day-bucketed and ready for the client
// to drop straight into the same UptimeDay[] shape either source uses.
app.get('/history/:serviceId', (req, res) => {
  try {
    const days = getDayBucketedHistory(req.params.serviceId)
    res.json(days)
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

// ── Recent raw snapshots (per-service detail view) ───────────────────
// Unlike /history/:serviceId, this returns every individual reading
// from the last 24 hours rather than one rolled-up value per day —
// the detail view needs real granularity to draw a response-time chart
// and a status log, not a single worst-of-day verdict. Only meaningful
// for Proxmox API / Zabbix (the two categories this proxy's own poller
// backs) — Proxmox Nodes and Power get their recent detail straight
// from Prometheus client-side, same split as the 90-day history.
app.get('/history/:serviceId/recent', (req, res) => {
  try {
    const rows = getRawSnapshots(req.params.serviceId)
    res.json(rows)
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

// ── Live-update nudge channel (SSE) ──────────────────────────────────
// Deliberately NOT the full-SSE version — the client still owns its own
// 60s polling via useServiceStatus (see client/src/hooks/useLiveNudge.ts),
// this route just tells already-connected clients "something changed,
// refetch now" sooner than their next scheduled poll. No state is ever
// pushed through this connection, only a bare signal — see
// 17-Frontend Polish and Realtime.md for why the hybrid version was
// chosen over relocating the whole aggregation facade server-side.
app.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })
  // Flushes the headers and establishes the stream immediately, rather
  // than leaving the client's EventSource waiting for the first real
  // nudge (which might be minutes or hours away) before it even knows
  // the connection succeeded.
  res.write('\n')

  addNudgeClient(res)

  req.on('close', () => {
    removeNudgeClient(res)
  })
})

// ── Prometheus proxy ──────────────────────────────────────────────
app.use(
  '/prometheus',
  createProxyMiddleware({
    target: PROMETHEUS_HOST,
    changeOrigin: true,
    pathRewrite: { '^/prometheus': '' },
  })
)

// ── Proxmox proxy ──────────────────────────────────────────────────
app.use(
  '/proxmox',
  createProxyMiddleware({
    target: `${PROXMOX_HOST}/api2/json`,
    changeOrigin: true,
    secure: false,
    pathRewrite: { '^/proxmox': '' },
    on: {
      proxyReq: (proxyReq) => {
        proxyReq.setHeader('Authorization', `PVEAPIToken=${PROXMOX_TOKEN}`)
      },
    },
  })
)

// ── Zabbix proxy ───────────────────────────────────────────────────
app.post('/zabbix', express.json(), async (req, res) => {
  try {
    const token = await getZabbixToken()

    const response = await fetch(`${ZABBIX_HOST}/api_jsonrpc.php`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json-rpc',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: req.body.method,
        params: req.body.params,
        id: req.body.id ?? 1,
      }),
    })

    const json = await response.json()
    res.json(json)
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

// ── Start ──────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Proxy running on port ${PORT}`)
  startPoller(PORT)
  startNudgeChecker(PORT)
})