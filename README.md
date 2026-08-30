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
  tunnel            │  reverse-proxies every API,  │
                     │  SSE, and admin route to    │
                     │  the proxy — see Public API  │
                     │  below for the full list     │
                     └──────────────┬──────────────┘
                                    │ Docker Compose network
                     ┌──────────────▼──────────────┐
                     │  Express proxy (proxy       │
                     │  container) — talks to the  │
                     │  real Prometheus/Proxmox/   │
                     │  Zabbix endpoints on the    │
                     │  internal LAN                │
                     └─────────────────────────────┘
```

The browser only ever talks to one origin. The proxy is never exposed publicly — the Cloudflare tunnel routes exactly one hostname to exactly one port (nginx), so a second internal service means nginx reverse-proxying to it, not a second public port.

This README covers what you need to actually run the thing. The deeper reasoning behind these architectural choices — the full request lifecycle, the CI/CD deploy pipeline, and a real decisions index — lives in [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Tech stack

|Layer|Technology|
|---|---|
|Frontend|Vite + React + TypeScript|
|Data fetching|TanStack Query|
|Styling|Tailwind CSS v4|
|Proxy server|Express + TypeScript|
|Testing|Vitest — both packages, including a shared-fixture parity check between duplicated status-derivation logic|
|Containerization|Docker Compose|
|Reverse proxy|nginx|
|CI|GitHub Actions|
|Public access|Cloudflare Zero Trust tunnel|

---

## Project structure

```
homelab-status/
├── .github/
│   └── workflows/
│       └── ci.yml                   ← client tests/lint/build + proxy tests, zero secrets
├── fixtures/
│   └── parity/                      ← shared test data, sibling to client/ and proxy/
│       ├── overall-status.json
│       └── zabbix-availability.json
├── client/
│   ├── public/
│   │   └── admin/
│   │       └── index.html      ← standalone admin UI — plain HTML/JS, no router added to the React app for one page, gated by Cloudflare Access on /admin/*, not application code. Create/update/resolve/delete/promote incidents, collapsible per-incident update-log view
│   ├── src/
│   │   ├── services/       ← one adapter per data source, normalized to ServiceStatus[]
│   │   │   ├── types.ts
│   │   │   ├── prometheus.ts
│   │   │   ├── proxmox.ts
│   │   │   ├── zabbix.ts
│   │   │   ├── zabbix.test.ts
│   │   │   ├── incidents.ts   ← incident history adapter
│   │   │   ├── history.ts     ← 90-day uptime history — Prometheus for Nodes/Power, proxy snapshot poller for Proxmox API/Zabbix
│   │   │   ├── history.test.ts
│   │   │   ├── index.ts       ← facade — Promise.allSettled across service adapters, incidents fetched separately
│   │   │   └── index.test.ts
│   │   ├── lib/
│   │   │   ├── uptime.ts      ← calculateUptimePercent — pure math with no service/component home, kept out of App.tsx to satisfy Vite's Fast Refresh rules
│   │   │   └── uptime.test.ts
│   │   ├── hooks/
│   │   │   ├── useServiceStatus.ts    ← live status, 60s poll — supplemented by a nudge listener (see useLiveNudge.ts)
│   │   │   ├── useUptimeHistory.ts    ← history, hourly poll, takes the live service list as an argument
│   │   │   ├── useTabAlert.ts         ← reflects alert state in the tab title and favicon
│   │   │   ├── useCommandPalette.ts   ← Cmd/Ctrl+K and "/" trigger, guarded against firing while typing
│   │   │   └── useLiveNudge.ts        ← listens on /events, triggers an early refetch on top of (not instead of) the 60s poll
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
│   │   ├── App.tsx             ← two-column layout at tablet/desktop widths: category status on one side, incident history in its own aside
│   │   └── main.tsx
│   ├── vite.config.ts          ← also doubles as the Vitest config
│   ├── tsconfig.app.json
│   ├── Dockerfile
│   ├── nginx.conf
│   └── .env
├── proxy/
│   ├── src/
│   │   ├── index.ts    ← routes: /health, /incidents, /history/:serviceId, /history/:serviceId/recent, /events, /badge.svg, POST+PATCH+DELETE /admin/incidents, POST /admin/incidents/:id/promote (all Cloudflare Access-gated), plus the Proxmox/Zabbix/Prometheus proxy passthroughs
│   │   ├── db.ts        ← node:sqlite storage — snapshot poller history, auto-drafted incidents, and manual incidents (same table, source/title/affected_services columns distinguish them). Also incident retirement (manual delete, 90-day auto-pruning) and incidents.json promotion — see db.test.ts for the full behavior these are tested against
│   │   ├── db.test.ts
│   │   ├── poller.ts    ← independent 15-minute background poll for Proxmox API/Zabbix history, and the auto-drafted-incident threshold check
│   │   ├── poller.test.ts
│   │   ├── nudge.ts     ← a separate 20-second loop broadcasting a bare SSE signal when any service's status changes, and caching an overall status the badge route reads
│   │   └── nudge.test.ts
│   ├── dist/             ← tsc build output — this is what actually runs in the container, not src/*.ts directly
│   ├── vitest.config.ts
│   ├── incidents.json    ← hand-edited, git-tracked incident data, bind-mounted read-only into the container — the original historical seed; every new incident, auto or manual, lives in the database instead
│   ├── Dockerfile
│   └── .env
├── docker-compose.yml    ← includes a named volume (snapshots-data) so poller history survives redeploys
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

Production deployment is fully Ansible-driven, not manual — and now, as of this session, can be triggered automatically as well as run by hand:

```bash
ansible-playbook playbooks/capstone_provision.yml   # Docker + cloudflared, one-time
ansible-playbook playbooks/capstone_deploy.yml       # clone, test-gate, build, deploy, verify, rollback-if-needed
```

**Two ways this actually runs now:** manually, exactly as above, or automatically — a real push to `main` fires a GitHub Actions job that calls a Cloudflare Access–gated webhook, which triggers this exact same playbook on the Ansible control node. Same playbook either way; the webhook only changes *how* it gets invoked, not what it does once running.

`capstone_deploy.yml` does more than a bare `docker compose up` — the deploy is gated end to end, in this order:

1. **Capture the current commit** — this is the actual rollback target if anything below fails after the stack is already live.
2. **Clone or update the repo** on the deploy host.
3. **Build and run both test suites** — each service's own Dockerfile `build` stage (the same stage the real deploy image comes from, dev dependencies included), then `npx vitest run` inside it. A failing test halts the play here, before anything about the running site is touched — no `.env` write, no container restart, no deploy.
4. **Write `proxy/.env`** from Ansible Vault–stored secrets, and **bring up the Docker Compose stack**.
5. **Health check** — waits for a clean `/health` response from the proxy.
6. **Smoke test** — a request to `/incidents` through nginx specifically, not the proxy's own port. This is what actually catches a missing or broken nginx forward rule, the exact bug class that's broken this project's routing in production more than once.
7. **Confirm the Cloudflare tunnel is active.**

**If step 5 or 6 fails** — the stack came up, but something about it is genuinely broken in a way the test suite didn't catch — the deploy automatically rolls back to the commit captured in step 1, rebuilds, and re-verifies health. A notification fires either way (success or rollback) to a dedicated alert channel, separate from routine infrastructure noise. This is the part that specifically matters now that a deploy can be triggered by a push with nobody necessarily watching in real time — a failure that used to just sit broken until someone noticed now fixes itself within about a minute, and still gets reported as a failed run even though service was restored, since the code that was supposed to go live didn't.

Redeploying after a code change is the second command alone — `git pull` happens automatically through Ansible's `git` module, and a commit that fails its own tests never reaches a running container.

The playbooks and full infrastructure context (which host, which VLAN, which firewall rules) live outside this repo, in the homelab's own Ansible project.

---

## Uptime history

The 90-day uptime bars pull from two different sources depending on category. **Proxmox Nodes** and **Power** query Prometheus's `query_range` API directly — Prometheus retention is 30 days, so days 31–90 show as `no-data` (grey) rather than a guessed value, which is accurate reporting, not a bug.

**Proxmox API** and **Zabbix** have no Prometheus backing at all — neither adapter has ever had a queryable history source of its own, since both only ever ask "what's the state right now" through a REST or JSON-RPC call. The proxy runs its own independent background poller (`proxy/src/poller.ts`) every 15 minutes, storing snapshots in a local `node:sqlite` database (`proxy/src/db.ts`) and rolling each day up to its worst observed status. Same honesty principle as the Prometheus side: history for these two categories only exists from whenever the poller started running — there's no way to reconstruct what happened before it existed, so a freshly deployed instance will show mostly `no-data` here too, for a while.

---

## Public API

Every route below is a plain `GET` returning JSON (or, for `/badge.svg`, an SVG image), reachable at `https://status.michaelrooney.dev/<path>` — no authentication, read-only.

|Route|Returns|
|---|---|
|`/health`|`{ "status": "ok" }` — proxy liveness check|
|`/incidents`|Array of `Incident` objects — id, title, status, timestamps, affected services, a timeline of updates, and a `source` field (`"manual"` or `"auto"` — hand-written entries from `incidents.json` and auto-drafted ones from sustained outage detection are merged into one array here). See `types.ts` for the full shape.|
|`/history/:serviceId`|90-day day-bucketed history for one service, `[{ "date": "2026-07-25", "status": "operational" }, ...]`. `status` is one of `operational`, `degraded`, `outage`, `unknown`, `no-data`, or `unreachable` — the last two look similar but mean different things: `no-data` is genuine silence (nothing recorded that day), `unreachable` means the monitoring source itself couldn't be reached that day, a real recorded fact, not an absence of one. Service ids match what `/incidents`' `affectedServices` field and the live status page use — e.g. `proxmox-ankhh`, `ups-cyberpower`, `zabbix-10781`.|
|`/events`|Server-Sent Events stream. Broadcasts a bare `event: nudge` message whenever any monitored service's status actually changes — no data payload, just a signal telling an already-connected client to refetch `/incidents`/live status sooner than its next scheduled poll. Sends a `: keep-alive` comment line every 15 seconds to survive Cloudflare's edge idle-connection timeout; `EventSource` clients ignore comment lines by spec.|
|`/badge.svg`|A small SVG image showing overall status — a colored dot plus a label (`Operational`/`Degraded`/`Outage`/`Unknown`). Embeddable anywhere with a plain `<img>` tag — no CORS restrictions apply the way they do to `fetch`. Not computed live per request; reads a value cached by the proxy's own 20-second status-check loop, so repeated requests never add load to Prometheus/Proxmox/Zabbix. `Cache-Control: public, max-age=60`.|

Example:

```bash
curl https://status.michaelrooney.dev/incidents
curl https://status.michaelrooney.dev/history/proxmox-ankhh
curl https://status.michaelrooney.dev/badge.svg
```

There's no single combined "everything at once" endpoint yet — an external consumer currently needs to hit these separately, the same way the client itself does. That's a deliberate scope call, not an oversight: three separate calls matches what the client itself does internally, and a combined feed wasn't worth building speculatively without real demand for one.

**Not public:** `POST /admin/incidents`, `PATCH /admin/incidents/:id`, `DELETE /admin/incidents/:id`, and `POST /admin/incidents/:id/promote` let an authenticated admin create, update, retire, and promote incidents directly, without a git push. `DELETE` requires an incident to already be resolved — enforced server-side with a real `409`, not just a UI-level guard. All gated by Cloudflare Access on the `/admin/*` path — unauthenticated requests never reach these routes at all.

---

## Resources

Links used while learning the pieces of this stack — kept here rather than lost in a scrollback or a separate personal doc, since the next thing worth learning is usually adjacent to the last thing that was hard.

### Foundational

- [The Twelve-Factor App — Config](https://12factor.net/config)
- [YouTube playlist](https://www.youtube.com/watch?v=k_0ZzvHbNBQ&list=PLillGF-RfqbYRpji8t4SxUkMxfowG4Kqp) — also listed below, it's amazing and would recommend!!

### Documentation & engineering practice

Code that works isn't the same as code someone else — or a future version of the person who wrote it — can actually pick up and reason about. This project's own comments went through a real audit: every reference to a private planning document got rewritten as a self-contained explanation of what the code does and why, on the theory that a comment citing a doc nobody else can see isn't documentation, it's a pointer to documentation. That pass also turned up a genuinely broken feature hiding behind a comment that correctly described behavior the actual code never implemented — a comment can be perfectly accurate about intent and still not be the thing itself. The resources below are the habits worth building on purpose rather than picking up by accident.

- [Diátaxis](https://diataxis.fr/) — the four-part framework (tutorials, how-to guides, reference, explanation) behind why this README, the code's own comments, and a build journal are three different kinds of writing solving three different problems, not one document trying to do everything
- [Keep a Changelog](https://keepachangelog.com/) — the format this project's own changelogs (Summary/Added/Changed/Fixed/Verified) are directly modeled on; the site's own case for *why* a changelog exists is worth reading even for a solo project with no other consumers yet
- [Documenting Architecture Decisions (ADRs)](https://adr.github.io/) — a lightweight pattern for recording *why* a real decision got made, not just what it was; this project keeps its own version of this idea internally, and the practice generalizes to any project where "why didn't we just do the obvious thing" needs a real answer six months later
- [Google Engineering Practices — code review](https://google.github.io/eng-practices/review/) — written for reviewing someone else's code, but just as useful read as a checklist before submitting your own; the sections on comments and complexity apply directly to writing code in the first place, not just reviewing it
- [Site Reliability Engineering — Postmortem Culture](https://sre.google/sre-book/postmortem-culture/) and [Being On-Call](https://sre.google/sre-book/being-on-call/) — the free full book; these two chapters are the closest thing to a formal case for runbooks and incident writeups, and the blameless-postmortem framing is worth internalizing even for a homelab project where the only "on-call engineer" is the person who built it

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

### Testing / Vitest

Two genuinely different testing styles live in this codebase, not one. Pure functions (`decideIncidentAction`, `deriveOverallStatus`, everything in `db.ts`) get tested directly, no mocking at all — real in-memory SQLite for the database layer, real fixture data for the derivation logic shared between client and proxy. Anything that depends on something else doing real work outside the function itself — a network fetch, a database call one layer up — gets that dependency mocked instead, so the test controls every input directly rather than depending on real infrastructure being reachable and behaving a specific way at the exact moment the suite runs.

- [Vitest — Getting Started](https://vitest.dev/guide/) — the framework itself, drop-in Jest-compatible API running on Vite's own transform pipeline rather than a separate bundler
- [Vitest — Mocking](https://vitest.dev/guide/mocking.html) — the general mocking guide `vi.mock`/`vi.fn` come from
- [Vitest API — `vi`](https://vitest.dev/api/vi.html) — full reference for `vi.fn`, `vi.mock`, `vi.mocked`, and the rest of the mocking toolkit
- [Vitest — In-source testing](https://vitest.dev/guide/in-source.html) — not used in this project, but useful context for why test files here sit next to their source files instead of a separate `__tests__/` directory
- [Testing Library — React Testing Library](https://testing-library.com/docs/react-testing-library/intro/) — `render`, `renderHook`, and the "test what a user would see" philosophy behind `CommandPalette.test.tsx` and `ServiceDetailModal.test.tsx`
- [Testing Library — `user-event`](https://testing-library.com/docs/user-event/intro/) — real simulated typing, clicking, and keyboard navigation, not raw synthetic DOM events, used throughout the component-level tests

One real, non-obvious thing worth knowing before writing a `vi.mock` call: it doesn't run in the order it's written on the page. Vitest hoists every `vi.mock()` call to the top of the file, above the real import statements, during a compile step — which is the only reason writing it visually *after* an import can still affect that same import. Full write-up of why that matters and what it looks like in practice, working through the test suite for this project's own main data-merging function: [What vi.mock Actually Does, and Why Order Doesn't Matter the Way It Looks Like It Should](https://michaelrooney.dev/journal/08-22-2026.html).

A third technique shows up in `history.test.ts` specifically, for functions that call `fetch` directly rather than through an importable adapter module — `vi.mock` has nothing to attach to in that case, since there's no module boundary to swap out. The fix is stubbing the global `fetch` itself and routing each call by inspecting the real URL it received, since that's the only information available at the point a single mocked `fetch` gets invoked for several genuinely different real endpoints. Write-up: [When vi.mock Isn't the Right Tool](https://michaelrooney.dev/journal/08-23-2026.html).

### Docker

- [Docker docs — Get started](https://docs.docker.com/get-started/)
- [Dockerfile reference](https://docs.docker.com/reference/dockerfile/)
- [Docker Compose — Compose file reference](https://docs.docker.com/reference/compose-file/)
- [Multi-stage builds](https://docs.docker.com/build/building/multi-stage/) — directly relevant to how both Dockerfiles in this repo are structured

### Ansible

- [Ansible docs — Getting started](https://docs.ansible.com/ansible/latest/getting_started/index.html)
- [Playbooks guide](https://docs.ansible.com/ansible/latest/playbook_guide/index.html)
- [Ansible Vault](https://docs.ansible.com/ansible/latest/vault_guide/index.html) — worth reading in full after a real `--check --diff` plaintext-secret leak this project hit firsthand
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

The tunnel itself has carried the whole project since the first deploy — no inbound ports opened anywhere on the homelab network, `cloudflared` holding an outbound-only connection out to Cloudflare instead. Adding the admin UI's write-capable routes brought the first real access-control layer on top of that: **Cloudflare Access**, gated to the `/admin/*` path specifically, protecting the admin routes with zero application-level auth code — no password, no session store, nothing in `index.ts` checking who's asking. Access validates identity at Cloudflare's own edge, before a request ever reaches this project's containers.

One real, sharp thing worth knowing before relying on this pattern elsewhere: **publishing a tunnel route does not protect it by default.** A published application with no Access application configured in front of it is reachable by anyone who knows the URL. The Access application had to be created as a genuinely separate step — see the journal entry linked below for the full walkthrough of setting this up for real, including two nginx bugs it surfaced along the way.

- [Cloudflare Zero Trust docs](https://developers.cloudflare.com/cloudflare-one/)
- [Tunnels — Get started](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/)
- [Published applications](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/) — how a tunnel route actually gets exposed, and the explicit note that Access is a separate, optional layer on top
- [Publish a self-hosted application to the Internet](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/) — the actual Access-application creation flow this project's `/admin` setup followed
- [Application paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/) — scoping a policy to part of a domain (`/admin/*`) rather than the whole thing, so the public status page stayed untouched
- [Common Access policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/common-policies/) — the email-based Allow policy this project's single-admin setup uses is close to the simplest real-world case documented here

Full write-up of the actual setup — including the "publishing isn't protecting" gotcha and both nginx bugs it exposed — in the journal: [Publishing Isn't the Same as Protecting](https://michaelrooney.dev/journal/08-08-2026.html).

### GitHub Actions / CI-CD

Why CI shipped well before CD, and the real constraint that shaped that sequencing (GitHub's hosted runners can't reach a homelab sitting behind an outbound-only Cloudflare tunnel) — is written up in the journal: [CI and CD Are Not One Thing](https://michaelrooney.dev/journal/08-08-2026b.html). CD has since been built — see the Webhooks section right below for how a hosted runner with no path into the LAN still triggers a real deploy on it.

- [GitHub Actions — Understanding GitHub Actions](https://docs.github.com/en/actions/get-started/understanding-github-actions) — the concepts (workflows, jobs, steps, runners) this repo's `.github/workflows/ci.yml` is built from
- [GitHub Actions — Workflow syntax reference](https://docs.github.com/en/actions/reference/workflow-syntax-for-github-actions) — the actual YAML shape, useful when a workflow file doesn't do what it looks like it should
- [GitHub Actions — Triggering a workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/triggering-a-workflow) — `on: push` / `on: pull_request`, the trigger conditions this repo's workflow actually uses
- [GitHub Actions — About hosted runners](https://docs.github.com/en/actions/how-tos/manage-runners/github-hosted-runners/about-github-hosted-runners) — what a hosted runner actually is, and why it has no path into a private LAN — the real constraint the CD webhook below was built specifically to work around, not ignore
- [GitHub Actions — Using secrets in GitHub Actions](https://docs.github.com/en/actions/security-guides/using-secrets-in-github-actions) — how the Cloudflare Access service token credentials get into the workflow without ever appearing in the repo itself
- [Martin Fowler — Continuous Integration](https://martinfowler.com/articles/continuousIntegration.html) — the classic reference on what CI actually means as a *practice*, not just a tool
- [Atlassian — Continuous Integration vs. Continuous Delivery vs. Continuous Deployment](https://www.atlassian.com/continuous-delivery/principles/continuous-integration-vs-delivery-vs-deployment) — the terminology distinction that shaped scoping this as two separate decisions instead of one
- [`ansible-lint` documentation](https://ansible.readthedocs.io/projects/lint/) — what runs in the companion Ansible repo's own CI workflow

### Webhooks & Automated Deployment

The actual CD mechanism: a real push to `main` fires a GitHub Actions job that calls a small Flask receiver on the Ansible control node, authenticated through Cloudflare Access with a service token rather than a human login, which triggers the same `capstone_deploy.yml` playbook a manual deploy runs. Two things worth knowing going in, both of which shaped real decisions in this build: a webhook is fundamentally a *push*, not a request-response — the receiving server has to already be listening and has to decide for itself what "already handling one of these" means, since nothing stops two deliveries arriving close together. And the automated-rollback pair riding alongside this pipeline leans directly on Ansible's `block`/`rescue`/`always` error-handling structure, which is a genuinely different pattern from `failed_when`/`ignore_errors` used everywhere else in this repo's playbooks.

- [Polling vs. Webhooks (Hookdeck)](https://hookdeck.com/webhooks/guides/when-to-use-webhooks) — the push-vs-pull distinction underneath why this exists at all, instead of GitHub Actions just polling something
- [GitHub Docs — Best practices for using webhooks](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks) — the "respond within 30 seconds" guidance is the exact reason the receiver here kicks the real deploy off in a background thread and returns immediately rather than blocking on it
- [Cloudflare Zero Trust — Service Tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/) — the actual mechanism GitHub Actions uses to authenticate through Access with no human involved; a genuinely different policy type from the identity-based Allow policy `/admin` uses, not just a variation on it
- [Ansible — Blocks (block/rescue/always)](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_blocks.html) — the error-handling structure the rollback logic is built on; worth reading the note on what happens to a play's overall status once `rescue` completes successfully — it's not what a first read assumes, and it's the reason this playbook's rescue block ends with an explicit failure rather than just letting the recovery stand on its own

---

## License

Personal project, built for an internship capstone. No license file yet — reach out before reusing wholesale.
