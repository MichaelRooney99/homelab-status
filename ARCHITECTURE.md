# Architecture

This is the one-page version of how this project actually works — every real component, the full request lifecycle, and the reasoning behind the decisions that shaped it. The [README](./README.md) covers what you need to run the thing; this covers *why it's built the way it is*.

## System diagram


[System architecture diagram — live application data flow and the independent CI/CD deploy pipeline](./architecture-diagram.pdf)



Two independent Cloudflare tunnels are worth noticing immediately: one serves the public application (read-only from the internet's perspective), the other exists solely to trigger a deploy, gated by a machine-credential Access policy rather than a human login. They share nothing at the edge on purpose.

## What actually happens between loading the page and seeing a status


**The read path.** The browser's `useServiceStatus` hook polls every 60 seconds via TanStack Query, chosen specifically for `refetchIntervalInBackground` — a plain `setInterval` stops firing the moment a browser throttles a backgrounded tab, which is exactly when someone would still want to know their homelab went down. That hook calls a single aggregation facade, which fans out to four adapters — Prometheus (nodes + UPS), Proxmox API, and Zabbix — through `Promise.allSettled`, not `Promise.all`, so one dead source degrades gracefully instead of blanking the whole page. Every adapter reaches its real data source through the proxy, never directly: in production, even the Prometheus adapter's URL is baked to a same-origin path at build time and forwarded by nginx into the same proxy every other adapter uses.

**The trust boundary.** The proxy is the only thing holding real credentials — a Proxmox API token, Zabbix login credentials. Every passthrough route is restricted to the exact path and method shape the app actually calls, not just forwarded wholesale; without that restriction, a public request could reach any endpoint those credentials are allowed to touch, not just the read-only status checks this app was ever meant to expose.

**Two independent background loops.** A poller runs every 15 minutes, recording a snapshot for the two categories with no other history source (Proxmox API, Zabbix) and re-deriving a 2-reading streak from that same snapshots table — not an in-memory counter — so a proxy restart never silently loses where a service was mid-streak. A separate nudge checker runs every 20 seconds, comparing a signature across all three live sources and pushing a Server-Sent Events nudge only when something actually changed. The two run on deliberately different clocks: reusing the 15-minute poll for live nudges would make Proxmox/Zabbix updates *slower* than the 60-second polling the nudge channel exists to beat.

**Incidents, two ways.** An incident can be auto-drafted by the poller (two consecutive bad readings, ~30 minutes sustained) or created manually through the admin page. Both land in the same table but through genuinely separate code paths — the auto path's canned message text would be actively misleading attached to something a person typed. A dedup filter scoped specifically to auto-drafted incidents keeps the two systems from interfering with each other. A separate, older mechanism — a hand-edited, git-tracked `incidents.json` file — predates the database-backed table entirely and is kept deliberately as a legacy input to a one-way "promote to database" action, not as an active authoring path.

**The admin surface.** A standalone static HTML page, not a React route — no client-side router exists for one screen. It carries no login form of its own; it assumes Cloudflare Access is already gating the path at the edge, and states that assumption directly rather than pretending to check it independently. It's also the one place in the entire codebase where a person's free-typed text becomes part of a rendered HTML string rather than a JSX-escaped value — handled with a pair of explicit escaping functions rather than assumed safe.

**The deploy path, entirely separate from all of the above.** A push to `main` runs CI, then posts to a second Cloudflare tunnel gated by a service-token Access policy — the right trust model for a CI job, which can't do an interactive edge login the way a human hitting `/admin` does. That tunnel routes to a webhook receiver on the Ansible control node, deliberately not the capstone host itself, since redeploying the host that would be running the redeploy is circular. The triggered playbook captures the current commit before touching anything, brings the stack up, and smoke-tests the real request path — not just a health check — before declaring success. Any failure at any point rolls back to the captured commit, rebuilds from it, re-verifies health on the reverted stack, and still fails the run — a rollback that recovers the service is not the same thing as the deploy that was actually requested succeeding.

## Decisions worth explaining, and why

| Decision | Reasoning |
|---|---|
| Single origin, one exposed port | The Cloudflare tunnel routes exactly one hostname to one port. A second internal service means nginx reverse-proxying to it internally, never a second public port — the smallest public surface the app's actual shape allows. |
| `Promise.allSettled`, not `Promise.all`, in the aggregation facade | One dead monitoring source should degrade the page, not blank it entirely. A parallel array tracks which named category a rejected promise came from, since a rejection alone carries no such information. |
| Small status-derivation logic duplicated across files, not shared | The same tri-state severity mapping appears in three places. Building cross-package shared tooling for a function this small isn't worth it; a fixture-parity test suite confirms all three copies agree instead. |
| A hybrid SSE nudge, not full state-push SSE | The live-update channel sends a bare "something changed, refetch now" signal, not real data. The client still owns its 60-second poll. A full state-push design would mean relocating the entire aggregation facade server-side for a responsiveness gain the hybrid approach gets almost for free. |
| Manual deploys for most of this project's life, CD built deliberately later | A single maintainer with a one-command deploy doesn't need continuous deployment by default. CD was scoped and built once the automation benefit clearly outweighed the new attack surface it introduces — not assumed as a default from day one. |
| CD as a tunneled webhook, not a self-hosted GitHub Actions runner | A standing runner's blast radius grows with every future workflow file. A webhook that triggers one specific script has the narrowest possible blast radius, and reuses the same Cloudflare Access pattern already proven on the admin routes. |
| Two separate Cloudflare tunnels, not one shared between the app and CD | A service-token Access policy for a CI job and an identity-based policy for a human admin are fundamentally different trust models. Kept as two independent tunnels and Access applications rather than mixing policy types on one. |
| `node:sqlite`, not a new database dependency | Confirmed available directly against the deployed Node runtime before committing to it — zero new dependencies, zero new attack surface, for the two monitoring categories that need their own recorded history. |
| Incident retirement keyed on one clock, not two | Both the force-resolve and delete steps use the same timestamp field. Introducing a second clock (a separate "resolved at" time) risked the two disagreeing with each other for no real benefit. |

## Current status

The application, its full test suite, the CI/CD pipeline, and every planned feature are complete and confirmed live in production. The one remaining deliverable is a portfolio case study — a narrative write-up for a general audience, external to this repository.
