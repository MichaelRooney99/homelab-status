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
│   ├── public/
│   │   └── admin/
│   │       └── index.html      ← standalone admin UI (added 08-08-2026) — plain HTML/JS, no router added to the React app for one page, gated by Cloudflare Access on /admin/*, not application code
│   ├── src/
│   │   ├── services/       ← one adapter per data source, normalized to ServiceStatus[]
│   │   │   ├── types.ts
│   │   │   ├── prometheus.ts
│   │   │   ├── proxmox.ts
│   │   │   ├── zabbix.ts
│   │   │   ├── incidents.ts   ← incident history adapter
│   │   │   ├── history.ts     ← 90-day uptime history — Prometheus for Nodes/Power, proxy snapshot poller for Proxmox API/Zabbix
│   │   │   └── index.ts       ← facade — Promise.allSettled across service adapters, incidents fetched separately
│   │   ├── lib/
│   │   │   └── uptime.ts      ← calculateUptimePercent — pure math with no service/component home, kept out of App.tsx to satisfy Vite's Fast Refresh rules
│   │   ├── hooks/
│   │   │   ├── useServiceStatus.ts    ← live status, 60s poll — now supplemented by a nudge listener (see useLiveNudge.ts)
│   │   │   ├── useUptimeHistory.ts    ← history, hourly poll, takes the live service list as an argument
│   │   │   ├── useTabAlert.ts         ← reflects alert state in the tab title and favicon
│   │   │   ├── useCommandPalette.ts   ← Cmd/Ctrl+K and "/" trigger, guarded against firing while typing
│   │   │   └── useLiveNudge.ts        ← added 08-06-2026 — listens on /events, triggers an early refetch on top of (not instead of) the 60s poll
│   │   ├── components/
│   │   │   ├── StatusBadge.tsx
│   │   │   ├── ServiceRow.tsx
│   │   │   ├── OverallHealth.tsx
│   │   │   ├── UptimeBars.tsx
│   │   │   ├── IncidentBadge.tsx
│   │   │   ├── IncidentList.tsx        ← per-card collapsible incident timeline, small "Auto" tag for drafted incidents
│   │   │   ├── DaysSinceIncident.tsx   ← days-since-last-incident counter
│   │   │   ├── SkeletonHealth.tsx      ← loading-state placeholder matching OverallHealth
│   │   │   ├── SkeletonServiceRow.tsx  ← loading-state placeholder matching ServiceRow
│   │   │   ├── ServiceDetailModal.tsx  ← per-service 24h response-time chart + recent readings
│   │   │   ├── MiniLineChart.tsx       ← hand-rolled SVG line chart, no charting library
│   │   │   ├── ThemeToggle.tsx         ← light/dark toggle
│   │   │   └── CommandPalette.tsx      ← Cmd/Ctrl+K search across services, categories, incidents
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── Dockerfile
│   ├── nginx.conf   ← two real routing bugs found here 08-08-2026: a too-broad /admin/ forward rule swallowing the page request, and a missing $uri/ step in try_files that had likely been latent since the first deploy — see the 08-08-2026 changelog
│   └── .env
├── proxy/
│   ├── src/
│   │   ├── index.ts    ← routes: /health, /incidents, /history/:serviceId, /history/:serviceId/recent, /events, POST+PATCH /admin/incidents (added 08-08-2026, Cloudflare Access-gated), plus the Proxmox/Zabbix/Prometheus proxy passthroughs
│   │   ├── db.ts        ← node:sqlite storage — snapshot poller history, auto-drafted incidents (08-05-2026), and manual incidents (08-08-2026, same table, source/title/affected_services columns distinguish the two)
│   │   ├── poller.ts    ← independent 15-minute background poll for Proxmox API/Zabbix history, and the auto-drafted-incident threshold check
│   │   └── nudge.ts     ← added 08-06-2026 — a separate 20-second loop broadcasting a bare SSE signal when any service's status changes
│   ├── incidents.json   ← hand-edited, git-tracked incident data, bind-mounted read-only into the container — the original historical seed; every new incident since 08-05-2026, auto or manual, lives in the database instead
│   ├── Dockerfile
│   └── .env
├── docker-compose.yml   ← includes a named volume (snapshots-data) so poller history survives redeploys
├── README.md
└── .dockerignore
```

**Adding a new data source:** write an adapter in `src/services/` exporting a `fetchXxxStatus(): Promise<ServiceStatus[]>`, import it in `services/index.ts`, add it to the `Promise.allSettled` array. That's the whole integration surface — the rest of the app picks it up automatically once it returns the normalized `ServiceStatus` shape from `types.ts`.

**Adding a new proxy route:** remember the checklist this project learned the hard way — proxy route → client adapter → `nginx.conf` forward rule → verify through the actual public domain, not just the direct proxy port. Skipping the nginx step is what took `/incidents` from "works in dev" to "silently empty in production" the first time.

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

The 90-day uptime bars pull from two different sources depending on category. **Proxmox Nodes** and **Power** query Prometheus's `query_range` API directly — Prometheus retention is 30 days, so days 31–90 show as `no-data` (grey) rather than a guessed value, which is accurate reporting, not a bug.

**Proxmox API** and **Zabbix** have no Prometheus backing at all — neither adapter has ever had a queryable history source of its own, since both only ever ask "what's the state right now" through a REST or JSON-RPC call. The proxy runs its own independent background poller (`proxy/src/poller.ts`) every 15 minutes, storing snapshots in a local `node:sqlite` database (`proxy/src/db.ts`) and rolling each day up to its worst observed status. Same honesty principle as the Prometheus side: history for these two categories only exists from whenever the poller started running — there's no way to reconstruct what happened before it existed, so a freshly deployed instance will show mostly `no-data` here too, for a while.

---

## Public API

Every route below is a plain `GET` returning JSON, reachable at `https://status.michaelrooney.dev/<path>` — no authentication, read-only.

|Route|Returns|
|---|---|
|`/health`|`{ "status": "ok" }` — proxy liveness check|
|`/incidents`|Array of `Incident` objects — id, title, status, timestamps, affected services, a timeline of updates, and a `source` field (`"manual"` or `"auto"`, added 08-05-2026 — hand-written entries from `incidents.json` and auto-drafted ones from sustained outage detection are merged into one array here). See `types.ts` for the full shape.|
|`/history/:serviceId`|90-day day-bucketed history for one service, `[{ "date": "2026-07-25", "status": "operational" }, ...]`. Service ids match what `/incidents`' `affectedServices` field and the live status page use — e.g. `proxmox-ankhh`, `ups-cyberpower`, `zabbix-10781`.|
|`/events`|Server-Sent Events stream, added 08-06-2026. Broadcasts a bare `event: nudge` message whenever any monitored service's status actually changes — no data payload, just a signal telling an already-connected client to refetch `/incidents`/live status sooner than its next scheduled poll. Sends a `: keep-alive` comment line every 15 seconds to survive Cloudflare's edge idle-connection timeout; `EventSource` clients ignore comment lines by spec.|

Example:

```bash
curl https://status.michaelrooney.dev/incidents
curl https://status.michaelrooney.dev/history/proxmox-ankhh
```

There's no single combined "everything at once" endpoint yet — an external consumer currently needs to hit these separately, the same way the client itself does. That's a deliberate scope call, not an oversight: see `16-Next-Round Functionality.md` (in the project's Obsidian vault, if you have access to it) for the reasoning on why a combined feed wasn't built speculatively.

**Not public:** `POST /admin/incidents` and `PATCH /admin/incidents/:id` (added 08-08-2026) let an authenticated admin create and update incidents directly, without a git push. Gated by Cloudflare Access on the `/admin/*` path — unauthenticated requests never reach these routes at all. See `21-Manual Incident Authoring UI.md` for the full design.

---

## Resources

Links used while learning the pieces of this stack — kept here rather than lost in a scrollback or a separate personal doc, since the next thing worth learning is usually adjacent to the last thing that was hard.

### Foundational

- [The Twelve-Factor App — Config](https://12factor.net/config)
- [YouTube playlist](https://www.youtube.com/watch?v=k_0ZzvHbNBQ&list=PLillGF-RfqbYRpji8t4SxUkMxfowG4Kqp) — also listed below, it's amazing and would recommend!!

### Tailwind CSS v4

- [Tailwind CSS — Theme variables](https://tailwindcss.com/docs/theme) — the `@theme` directive, the mechanism this project's light/dark toggle is actually built on
- [Tailwind CSS — Functions and directives](https://tailwindcss.com/docs/functions-and-directives) — `@import`, `@theme`, `@plugin`, and the rest of the CSS-native config surface that replaced `tailwind.config.js` in v4
- [Tailwind CSS — Adding custom styles](https://tailwindcss.com/docs/adding-custom-styles) — how theme values feed into generated utility classes
- [Tailwind CSS — Dark Mode](https://tailwindcss.com/docs/dark-mode) — the `dark:` variant approach this project deliberately did *not* use for its theme toggle, in favor of CSS-variable-backed tokens (see the journal entry below for why)
- [MDN — `prefers-color-scheme`](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-color-scheme) — the media feature behind respecting a visitor's OS-level theme preference
- [MDN — `Window.matchMedia()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/matchMedia) — the JS API used to read that preference synchronously
- [MDN — `Window.localStorage`](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage) — how the theme choice persists across reloads

Full writeup of how these pieces fit together — the anti-flash inline script, the OS-preference fallback, and specifically how Tailwind v4's `@theme` directive makes a CSS-variable-backed theme system possible without a `dark:` variant on every element — in the journal: [The Half-Second Nobody's Supposed to See](https://michaelrooney.dev/journal/07-30-2026.html).

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

### Scraping / Polling

Prometheus is itself a scraper — it's the reason Proxmox Nodes and Power get real 90-day history while Proxmox API and Zabbix originally didn't. `proxy/src/poller.ts` and `proxy/src/db.ts` are this project's own hand-built equivalent for those two categories: an independent background job that checks a source on a timer and records what it found, regardless of whether a browser happens to be open.

- [Prometheus docs — Overview: how scraping actually works](https://prometheus.io/docs/introduction/overview/#what-is-prometheus) — the "pull" model this project's own poller borrows the shape of
- [MDN — Using the Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch) — what `poller.ts` uses to call the proxy's own existing routes rather than duplicating upstream auth logic a second time
- [Node.js — Timers (`setInterval`)](https://nodejs.org/api/timers.html#settimeout) — the actual trigger mechanism behind any polling-style scraper, not just this one
- [Node.js — the built-in `node:sqlite` module](https://nodejs.org/api/sqlite.html) — what this project stores scraped snapshots in
- [Cheerio documentation](https://cheerio.js.org/) — for scrapers that parse HTML rather than JSON (not what this project does — Proxmox and Zabbix both return structured JSON — but the standard tool once a source doesn't expose a clean API)
- [Playwright documentation](https://playwright.dev/docs/intro) — for sources that only render content via client-side JavaScript, where a plain HTTP request returns nothing useful to parse
- [`robots.txt` and crawling etiquette (MDN)](https://developer.mozilla.org/en-US/docs/Glossary/Robots.txt) — relevant the moment a scraper's target is a public website rather than an internal API you already control

### Proxmox VE API

- [Proxmox VE API documentation](https://pve.proxmox.com/pve-docs/api-viewer/) — the interactive API viewer, more useful in practice than the static reference for finding the right endpoint
- [Proxmox VE Administration Guide — API Tokens](https://pve.proxmox.com/pve-docs/pve-admin-guide.html#pveum_tokens)

### Zabbix

- [Zabbix documentation](https://www.zabbix.com/documentation/current/en/manual) — current version manual, check the version selector matches the deployed server version before trusting endpoint-specific details
- [Zabbix API reference](https://www.zabbix.com/documentation/current/en/manual/api) — JSON-RPC, used directly by this project's proxy adapter
- [Zabbix Agent 2](https://www.zabbix.com/documentation/current/en/manual/concepts/agent2)

### Cloudflare Zero Trust / Tunnels

The tunnel itself has carried the whole project since the first deploy — no inbound ports opened anywhere on the homelab network, `cloudflared` holding an outbound-only connection out to Cloudflare instead. `21-Manual Incident Authoring UI` (08-08-2026) added the first real access-control layer on top of that: **Cloudflare Access**, gated to the `/admin/*` path specifically, protecting the new admin routes with zero application-level auth code — no password, no session store, nothing in `index.ts` checking who's asking. Access validates identity at Cloudflare's own edge, before a request ever reaches this project's containers.

One real, sharp thing worth knowing before relying on this pattern elsewhere: **publishing a tunnel route does not protect it by default.** A published application with no Access application configured in front of it is reachable by anyone who knows the URL. The Access application had to be created as a genuinely separate step — see the journal entry linked below for the full walkthrough of setting this up for real, including two nginx bugs it surfaced along the way.

- [Cloudflare Zero Trust docs](https://developers.cloudflare.com/cloudflare-one/)
- [Tunnels — Get started](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/)
- [Published applications](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/) — how a tunnel route actually gets exposed, and the explicit note that Access is a separate, optional layer on top
- [Publish a self-hosted application to the Internet](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/) — the actual Access-application creation flow this project's `/admin` setup followed
- [Application paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/) — scoping a policy to part of a domain (`/admin/*`) rather than the whole thing, so the public status page stayed untouched
- [Common Access policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/common-policies/) — the email-based Allow policy this project's single-admin setup uses is close to the simplest real-world case documented here

Full write-up of the actual setup — including the "publishing isn't protecting" gotcha and both nginx bugs it exposed — in the journal: [Publishing Isn't the Same as Protecting](https://michaelrooney.dev/journal/08-08-2026.html).

---

## License

Personal project, built for an internship capstone. No license file yet — reach out before reusing wholesale.