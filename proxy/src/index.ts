import express from 'express'
import { createProxyMiddleware } from 'http-proxy-middleware'
import dotenv from 'dotenv'

dotenv.config()

const app = express()
const PORT = process.env.PORT ?? 3001

const PROXMOX_HOST = process.env.PROXMOX_HOST
const PROXMOX_TOKEN = process.env.PROXMOX_TOKEN

if (!PROXMOX_HOST || !PROXMOX_TOKEN) {
  console.error('PROXMOX_HOST and PROXMOX_TOKEN are required')
  process.exit(1)
}

// CORS — allow requests from the Vite dev server and the built client
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CLIENT_ORIGIN ?? 'http://localhost:5173')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') {
    res.sendStatus(204)
    return
  }
  next()
})

// Health check — lets the client verify the proxy is reachable
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

// Proxmox API proxy — forwards /proxmox/* to the Proxmox host
// attaches the API token as an Authorization header
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

app.listen(PORT, () => {
  console.log(`Proxy running on port ${PORT}`)
})