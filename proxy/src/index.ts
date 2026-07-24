import express from 'express'
import { createProxyMiddleware } from 'http-proxy-middleware'
import dotenv from 'dotenv'
import { readFile } from 'fs/promises'
import path from 'path'

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
// Reads the file fresh on every request rather than caching it in memory.
// The file is tiny and requests are infrequent, so there's no real cost
// to this — and it means an edit to incidents.json takes effect on the
// very next request, whether that edit came from a direct SSH edit on
// Dega or from a normal git pull via capstone_deploy.yml. No restart,
// no rebuild, either way.
app.get('/incidents', async (_req, res) => {
  try {
    const raw = await readFile(INCIDENTS_FILE, 'utf-8')
    res.json(JSON.parse(raw))
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
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
})