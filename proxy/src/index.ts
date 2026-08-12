import express from 'express'
import { createProxyMiddleware } from 'http-proxy-middleware'
import dotenv from 'dotenv'
import { readFile } from 'fs/promises'
import path from 'path'
import { startPoller } from './poller'
import {
  getDayBucketedHistory,
  getRawSnapshots,
  getAllDraftedIncidents,
  createManualIncident,
  appendIncidentUpdate,
  updateIncidentStatus,
} from './db'
import { addNudgeClient, removeNudgeClient, startNudgeChecker, getCachedOverallStatus } from './nudge'

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
// infrequent. Merges two genuinely different storage locations at read
// time: incidents.json (hand-edited, git-tracked, read-only inside this
// container — the original historical seed) and drafted_incidents
// (DB-backed, writable, lives in the same snapshots.db the history
// endpoints already use). drafted_incidents itself holds two kinds of
// rows — auto-detected and admin-authored — both already carry a real
// `source` column, so no extra mapping is needed here beyond the
// file's own default. Every incidents.json entry gets source: 'manual'
// stamped on if it doesn't already have one, since every existing
// entry predates that field and defaulting here means the file itself
// never needed a one-time migration.
app.get('/incidents', async (_req, res) => {
  try {
    const raw = await readFile(INCIDENTS_FILE, 'utf-8')
    const fromFile = (JSON.parse(raw) as Array<Record<string, unknown>>).map(incident => ({
      source: 'manual',
      ...incident,
    }))
    const fromDb = getAllDraftedIncidents()
    res.json([...fromFile, ...fromDb])
  } catch (error) {
    // Every route below used to send String(error) straight back to
    // the client. Not a credential leak on its own, but
    // unnecessary internal detail (stack traces, file paths, upstream
    // error text) handed to any public caller. Logged server-side where
    // it's actually useful; the client only gets a generic message.
    console.error('Request failed:', error)
    res.status(500).json({ error: 'Something went wrong handling this request.' })
  }
})

// ── Admin: manual incident authoring ─────────────────────────────────
// Everything under /admin is expected to sit behind a Cloudflare Access
// policy scoped to this exact path prefix — Access validates the
// visitor's identity at Cloudflare's edge before the request ever
// reaches this container, the same way the rest of this deployment has
// no inbound ports open at all. IMPORTANT, honestly stated: this code
// currently performs zero independent verification of its own — there
// is no server-side check that a request actually came through an
// authenticated Access session. That defense-in-depth layer (validating
// the Cf-Access-Jwt-Assertion header directly) is a deliberately
// deferred follow-up, not an oversight here. Do not point this route at
// the public internet without the Access policy actually configured and
// verified first.
app.post('/admin/incidents', express.json(), (req, res) => {
  const { title, affectedServices, message } = req.body as {
    title?: string
    affectedServices?: string[]
    message?: string
  }

  if (!title || !Array.isArray(affectedServices) || affectedServices.length === 0 || !message) {
    res.status(400).json({ error: 'title, affectedServices (non-empty array), and message are required' })
    return
  }

  try {
    const id = createManualIncident(title, affectedServices, message)
    res.status(201).json({ id })
  } catch (error) {
    // Generic client-facing message, real error logged server-side — see the /incidents route above for the full reasoning.
    console.error('Request failed:', error)
    res.status(500).json({ error: 'Something went wrong handling this request.' })
  }
})

app.patch('/admin/incidents/:id', express.json(), (req, res) => {
  const { message, status } = req.body as { message?: string; status?: string }
  const timestamp = Math.floor(Date.now() / 1000)

  if (!message) {
    res.status(400).json({ error: 'message is required — every status change and update needs an explanation, see db.ts' })
    return
  }

  try {
    const updated = status
      ? updateIncidentStatus(req.params.id, status, message, timestamp)
      : appendIncidentUpdate(req.params.id, message, timestamp)

    if (!updated) {
      res.status(404).json({ error: 'No incident found with that id' })
      return
    }

    res.json({ ok: true })
  } catch (error) {
    // Generic client-facing message, real error logged server-side — see the /incidents route above for the full reasoning.
    console.error('Request failed:', error)
    res.status(500).json({ error: 'Something went wrong handling this request.' })
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
    // Generic client-facing message, real error logged server-side — see the /incidents route above for the full reasoning.
    console.error('Request failed:', error)
    res.status(500).json({ error: 'Something went wrong handling this request.' })
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
    // Generic client-facing message, real error logged server-side — see the /incidents route above for the full reasoning.
    console.error('Request failed:', error)
    res.status(500).json({ error: 'Something went wrong handling this request.' })
  }
})

// ── Live-update nudge channel (SSE) ──────────────────────────────────
// Deliberately NOT the full-SSE version — the client still owns its own
// 60s polling via useServiceStatus (see client/src/hooks/useLiveNudge.ts),
// this route just tells already-connected clients "something changed,
// refetch now" sooner than their next scheduled poll. No state is ever
// pushed through this connection, only a bare signal — the hybrid
// approach was chosen over relocating the whole aggregation facade
// server-side, since a bare signal is enough to get the same effect at
// a fraction of the moving parts.
app.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })
  // Flushes the headers and establishes the stream immediately with a
  // valid SSE comment line, rather than leaving the client's
  // EventSource waiting for the first real nudge (which might be
  // minutes or hours away) before it even knows the connection
  // succeeded. A bare newline isn't valid SSE framing — a comment line
  // must start with ':' — this was silently wrong before, just never
  // surfaced since EventSource tolerates malformed leading whitespace.
  res.write(': connected\n\n')

  addNudgeClient(res)

  req.on('close', () => {
    removeNudgeClient(res)
  })
})

// ── Embeddable status badge ──────────────────────────────────────────
// Public, unauthenticated. Deliberately NOT computed live per request —
// reads whatever nudge.ts's 20s loop last cached. Colors match
// StatusBadge.tsx's green/yellow/red/gray mapping exactly. Hand-rolled
// SVG, no image library, same precedent as UptimeBars/MiniLineChart.
const BADGE_COLORS: Record<string, string> = {
  operational: '#22c55e',
  degraded: '#eab308',
  outage: '#ef4444',
  unknown: '#71717a',
}

const BADGE_LABELS: Record<string, string> = {
  operational: 'Operational',
  degraded: 'Degraded',
  outage: 'Outage',
  unknown: 'Unknown',
}

app.get('/badge.svg', (_req, res) => {
  const status = getCachedOverallStatus()
  const color = BADGE_COLORS[status]
  const label = BADGE_LABELS[status]
  const text = `Homelab Status: ${label}`
  const width = 40 + text.length * 6.2

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${text}">
  <rect width="${width}" height="20" rx="3" fill="#18181b"/>
  <circle cx="14" cy="10" r="5" fill="${color}"/>
  <text x="26" y="14" font-family="Verdana, Geneva, sans-serif" font-size="11" fill="#e4e4e7">${text}</text>
</svg>`

  res.setHeader('Content-Type', 'image/svg+xml')
  // Bounded to the nudge loop's own cadence — long enough that an
  // embedding site's CDN isn't refetching every pageview, short enough
  // that staleness never drifts past what the nudge channel already
  // tolerates.
  res.setHeader('Cache-Control', 'public, max-age=60')
  res.send(svg)
})

// ── Prometheus proxy ──────────────────────────────────────────────
// Restricted to the exact two endpoints prometheus.ts ever calls
// (/api/v1/query, /api/v1/query_range). Before this, /prometheus/*
// forwarded ANY path to the real Prometheus instance with no
// restriction at all: a genuinely serious gap, not a theoretical one,
// since this app's actual usage only ever needs two read endpoints but
// nothing enforced that. Blocks admin/config/reload endpoints entirely
// and any other Prometheus API surface this app has no legitimate
// reason to expose to the public internet.
//
// Deliberately NOT validating the *content* of the `query` parameter
// itself yet — an allowed path can still carry an arbitrary PromQL
// query, which could pull metrics this app never displays or run an
// expensive query as a denial-of-service vector. Path-level restriction
// closes the larger hole (arbitrary API surface, not just arbitrary
// queries) cheaply; query-content validation is a real further
// refinement, not done here.
const PROMETHEUS_PATH_ALLOWLIST = [/^\/api\/v1\/query$/, /^\/api\/v1\/query_range$/]

function isAllowedPrometheusRequest(req: express.Request): boolean {
  return req.method === 'GET' && PROMETHEUS_PATH_ALLOWLIST.some(re => re.test(req.path))
}

app.use(
  '/prometheus',
  (req, res, next) => {
    if (!isAllowedPrometheusRequest(req)) {
      res.status(403).json({ error: 'This Prometheus API path is not permitted through this proxy.' })
      return
    }
    next()
  },
  createProxyMiddleware({
    target: PROMETHEUS_HOST,
    changeOrigin: true,
    pathRewrite: { '^/prometheus': '' },
  })
)

// ── Proxmox proxy ──────────────────────────────────────────────────
// Same fix, same reasoning as Prometheus above — restricted to the
// exact two path shapes client/src/services/proxmox.ts actually calls
// (/nodes and /nodes/:node/status). Before this, /proxmox/* forwarded
// any path to the real Proxmox API with the real PROXMOX_TOKEN
// attached — meaning the public internet had full authenticated access
// to whatever that token's actual permissions allow, not just the two
// read-only status endpoints this app was ever meant to expose.
const PROXMOX_PATH_ALLOWLIST = [/^\/nodes$/, /^\/nodes\/[a-zA-Z0-9_-]+\/status$/]

function isAllowedProxmoxRequest(req: express.Request): boolean {
  return req.method === 'GET' && PROXMOX_PATH_ALLOWLIST.some(re => re.test(req.path))
}

app.use(
  '/proxmox',
  (req, res, next) => {
    if (!isAllowedProxmoxRequest(req)) {
      res.status(403).json({ error: 'This Proxmox API path is not permitted through this proxy.' })
      return
    }
    next()
  },
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
// Restricted to method: 'host.get'. Before this, req.body.method was
// forwarded to Zabbix's JSON-RPC API
// completely unchecked: any caller could invoke any Zabbix API method
// with this route's real bearer token attached, not just the read-only
// host status check this app actually needs. host.get is the only
// method client/src/services/zabbix.ts, poller.ts, or nudge.ts ever
// call.
const ZABBIX_ALLOWED_METHODS = new Set(['host.get'])

app.post('/zabbix', express.json(), async (req, res) => {
  const method = req.body?.method

  if (!ZABBIX_ALLOWED_METHODS.has(method)) {
    res.status(403).json({ error: 'This Zabbix API method is not permitted through this proxy.' })
    return
  }

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
    // Generic client-facing message, real error logged server-side — see the /incidents route above for the full reasoning.
    console.error('Request failed:', error)
    res.status(500).json({ error: 'Something went wrong handling this request.' })
  }
})

// ── Start ──────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Proxy running on port ${PORT}`)
  startPoller(PORT)
  startNudgeChecker(PORT)
})
