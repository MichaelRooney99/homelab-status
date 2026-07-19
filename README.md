# Homelab Status Page

A public-facing infrastructure status page for a self-hosted homelab, built from scratch as a Madison College internship capstone project. Modeled loosely after Atlassian Statuspage, but self-hosted end to end — no third-party status service, no vendor lock-in.

**Live:** [status.michaelrooney.dev](https://status.michaelrooney.dev)
**Author:** Michael Rooney ([michaelrooney.dev](https://michaelrooney.dev))

---

## What this is

A React dashboard that pulls live data from four different monitoring sources running on a Proxmox homelab — Prometheus, the Proxmox API, Zabbix, and NUT (via `nut_exporter`) — and normalizes all of it into one consistent status view. Publicly reachable through a Cloudflare Zero Trust tunnel, with no inbound ports opened on the homelab network.

|Category|Source|What it shows|
|---|---|---|
|Proxmox Nodes|Prometheus (`node_exporter`)|Per-node up/down, CPU, memory|
|Proxmox API|Proxmox REST API|Cluster-reported node status, uptime|
|Power|Prometheus (`nut_exporter`)|UPS status, battery runtime, load|
|Zabbix|Zabbix JSON-RPC|Agent-reported host availability|

Each service also shows a 90-day uptime history where a real data source exists for it — see [Uptime history](#uptime-history) below for what "where a real data source exists" actually means.

---

## Architecture

```
                    ┌─────────────────────────────┐
  Cloudflare  ───▶  │  nginx (client container)   │
  Zero Trust        │  serves static React build  │
  tunnel            │  reverse-proxies /proxmox,   │
                     │  /zabbix, /prometheus,      │
                     │  /health to the proxy       │
                     └──────────────┬──────────────┘
                                    │ Docker Compose network
                     ┌──────────────▼──────────────┐
                     │  Express proxy (proxy       │
                     │  container) — talks to the  │
                     │  real Prometheus/Proxmox/   │
                     │  Zabbix endpoints on the    │
                     │  internal LAN               │
                     └─────────────────────────────┘
```

The browser only ever talks to one origin. The proxy is never exposed publicly — the Cloudflare tunnel routes exactly one hostname to exactly one port (nginx), so a second internal service means nginx reverse-proxying to it, not a second public port.

Full write-up of every architectural decision (why single-origin, why two-stage Docker builds, why build-time env baking instead of runtime config) is in the project's Obsidian vault — `12-Deployment Architecture.md` and the rest of the numbered doc series (`00` through `11`) if you have access to it. This README covers what you need to actually run the thing.

---

## Tech stack

|Layer|Technology|
|---|---|
|Frontend|Vite + React + TypeScript|
|Data fetching|TanStack Query|
|Styling|Tailwind CSS v4|
|Proxy server|Express + TypeScript|
|Containerization|Docker Compose|
|Reverse proxy|nginx|
|Public access|Cloudflare Zero Trust tunnel|

---

## Project structure

```
homelab-status/
├── client/
│   ├── src/
│   │   ├── services/       ← one adapter per data source, normalized to ServiceStatus[]
│   │   │   ├── types.ts
│   │   │   ├── prometheus.ts
│   │   │   ├── proxmox.ts
│   │   │   ├── zabbix.ts
│   │   │   ├── history.ts  ← 90-day uptime history (Prometheus range queries)
│   │   │   └── index.ts    ← facade — Promise.allSettled across all adapters
│   │   ├── hooks/
│   │   │   ├── useServiceStatus.ts    ← live status, 60s poll
│   │   │   └── useUptimeHistory.ts    ← history, hourly poll
│   │   ├── components/
│   │   │   ├── StatusBadge.tsx
│   │   │   ├── ServiceRow.tsx
│   │   │   ├── OverallHealth.tsx
│   │   │   └── UptimeBars.tsx
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── Dockerfile
│   ├── nginx.conf
│   └── .env
├── proxy/
│   ├── src/
│   │   └── index.ts
│   ├── Dockerfile
│   └── .env
├── docker-compose.yml
└── .dockerignore
```

**Adding a new data source:** write an adapter in `src/services/` exporting a `fetchXxxStatus(): Promise<ServiceStatus[]>`, import it in `services/index.ts`, add it to the `Promise.allSettled` array. That's the whole integration surface — the rest of the app picks it up automatically once it returns the normalized `ServiceStatus` shape from `types.ts`.

---

## Running locally

```bash
# Client
cd client
npm install
npm run dev

# Proxy (separate terminal)
cd proxy
npm install
npm run dev
```

The client's dev-mode fallback points at `http://localhost:3001` for the proxy and `http://10.10.10.105:9090` for Prometheus directly — both are LAN-only addresses from the original deployment and won't resolve outside that network. Point `VITE_PROXY_URL` and `VITE_PROMETHEUS_URL` in `client/.env` at your own monitoring stack, or expect the adapters to fail (which they will — cleanly, since every adapter fetch is wrapped in `Promise.allSettled`).

---

## Deployment

Production deployment is fully Ansible-driven, not manual:

```bash
ansible-playbook playbooks/capstone_provision.yml   # Docker + cloudflared, one-time
ansible-playbook playbooks/capstone_deploy.yml       # clone, configure, docker compose up
```

`capstone_deploy.yml` clones this repo, writes `proxy/.env` from Ansible Vault–stored secrets, runs `docker compose up -d --build`, and waits for a clean `/health` response before considering the deploy successful. Redeploying after a code change is the second command alone — `git pull` happens automatically through Ansible's `git` module.

The playbooks and full infrastructure context (which host, which VLAN, which firewall rules) live outside this repo, in the homelab's own Ansible project.

---

## Uptime history

The 90-day uptime bars pull real data from Prometheus `query_range` calls for the two categories Prometheus actually has time-series history for — **Proxmox Nodes** and **Power**. Prometheus retention is 30 days, so days 31–90 show as `no-data` (grey) rather than a guessed value — that's accurate reporting, not a bug.

**Proxmox API** and **Zabbix** categories intentionally show placeholder-only history (today's reading, everything else grey). Neither of those adapters has a queryable history source — they only ever see current state through a REST call or a JSON-RPC call, not a stored time series. There's no honest data available for those two yet; the placeholder is the correct answer for what those sources can currently tell you, not a gap that got missed.

---

## Resources

Links used while learning the pieces of this stack — kept here rather than lost in a scrollback or a separate personal doc, since the next thing worth learning is usually adjacent to the last thing that was hard.

### Foundational

- [The Twelve-Factor App — Config](https://12factor.net/config)
- [YouTube playlist](https://www.youtube.com/watch?v=k_0ZzvHbNBQ&list=PLillGF-RfqbYRpji8t4SxUkMxfowG4Kqp) — also listed below, it's amazing and would recommend!!

### TanStack Query

- [Installation](https://tanstack.com/query/latest/docs/framework/react/installation)
- [YouTube walkthrough](https://www.youtube.com/watch?v=mPaCnwpFvZY)
- [Quick start](https://tanstack.com/query/latest/docs/framework/react/quick-start)
- [`useQuery` reference](https://tanstack.com/query/latest/docs/framework/react/reference/useQuery)
- [LinkedIn Learning — Efficient Data Fetching and State Management](https://www.linkedin.com/learning/tanstack-query-efficient-data-fetching-and-state-management/optimizing-with-usequeries?u=74652290)

### Express.js, Node.js, BFF/Proxies

- [Express — Hello World](https://expressjs.com/en/starter/hello-world/)
- [Express — Routing guide](https://expressjs.com/en/guide/routing.html)
- [Node.js — Introduction](https://nodejs.org/en/learn/getting-started/introduction-to-nodejs)
- [MDN — Express/Node introduction](https://developer.mozilla.org/en-US/docs/Learn/Server-side/Express_Nodejs/Introduction)
- [The Odin Project — Node.js introduction to Express](https://theodinproject.com/lessons/nodejs-introduction-to-express)
- [MDN — Proxy servers and tunneling](https://developer.mozilla.org/en-US/docs/Web/HTTP/Proxy_servers_and_tunneling)
- [nginx — Reverse proxy glossary](https://nginx.com/resources/glossary/reverse-proxy-server)
- [`http-proxy-middleware`](https://github.com/chimurai/http-proxy-middleware)
- [web.dev — Cross-Origin Resource Sharing](https://web.dev/cross-origin-resource-sharing)
- [YouTube playlist](https://www.youtube.com/watch?v=k_0ZzvHbNBQ&list=PLillGF-RfqbYRpji8t4SxUkMxfowG4Kqp)
- [MDN — CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS) — long, just put on a screen reader and do the dishes because every section has relevance

### Docker

- [Docker docs — Get started](https://docs.docker.com/get-started/)
- [Dockerfile reference](https://docs.docker.com/reference/dockerfile/)
- [Docker Compose — Compose file reference](https://docs.docker.com/reference/compose-file/)
- [Multi-stage builds](https://docs.docker.com/build/building/multi-stage/) — directly relevant to how both Dockerfiles in this repo are structured

### Ansible

- [Ansible docs — Getting started](https://docs.ansible.com/ansible/latest/getting_started/index.html)
- [Playbooks guide](https://docs.ansible.com/ansible/latest/playbook_guide/index.html)
- [Ansible Vault](https://docs.ansible.com/ansible/latest/vault_guide/index.html) — worth reading in full after the `--check --diff` plaintext leak this project hit firsthand
- [Jinja2 templating in Ansible](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_templating.html)

### Prometheus

- [Prometheus docs — Overview](https://prometheus.io/docs/introduction/overview/)
- [Querying — PromQL basics](https://prometheus.io/docs/prometheus/latest/querying/basics/)
- [Querying — the HTTP API](https://prometheus.io/docs/prometheus/latest/querying/api/) — specifically `/api/v1/query` and `/api/v1/query_range`, the two endpoints this project's adapters and history module actually call

### Proxmox VE API

- [Proxmox VE API documentation](https://pve.proxmox.com/pve-docs/api-viewer/) — the interactive API viewer, more useful in practice than the static reference for finding the right endpoint
- [Proxmox VE Administration Guide — API Tokens](https://pve.proxmox.com/pve-docs/pve-admin-guide.html#pveum_tokens)

### Zabbix

- [Zabbix documentation](https://www.zabbix.com/documentation/current/en/manual) — current version manual, check the version selector matches the deployed server version before trusting endpoint-specific details
- [Zabbix API reference](https://www.zabbix.com/documentation/current/en/manual/api) — JSON-RPC, used directly by this project's proxy adapter
- [Zabbix Agent 2](https://www.zabbix.com/documentation/current/en/manual/concepts/agent2)

### Cloudflare Zero Trust / Tunnels

- [Cloudflare Zero Trust docs](https://developers.cloudflare.com/cloudflare-one/)
- [Tunnels — Get started](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/)

---

## License

Personal project, built for an internship capstone. No license file yet — reach out before reusing wholesale.