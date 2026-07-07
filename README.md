# lm-mcp-server

The LiquidMind MCP server. It exposes a small set of **READ** and **PROPOSE**
tools to Claude (Cowork) and translates each tool call into an HTTP call against
the existing **Liquid-Mind-CRM** API. It holds no business logic and no platform
credentials — it is a thin, authenticated router that sits in front of tools that
already exist.

```
Claude Cowork ──HTTPS (bearer)──▶ lm-mcp ──HTTP (service token)──▶ Liquid-Mind-CRM API
   (connector)                    (this)                            (truth ledger + AI_Action_Queue)
```

## Scope (v1)

- **READ tools** — pull from the truth ledger via the CRM API. No side effects.
  - `list_clients`, `resolve_client`, `get_series_performance`,
    `get_campaign_performance`, `list_tasks`, `run_ad_review`
- **PROPOSE tools** — write a row to the CRM `AI_Action_Queue` (`status = 'proposed'`).
  They never touch a campaign.
  - `propose_bid_change`, `propose_budget_shift`, `propose_audience_rebuild`,
    `propose_campaign_state`, `propose_new_campaign`

There is **no EXECUTE** in v1. Nothing this server does moves money — the worst a
compromised token can do is read data and insert proposal rows a human must still
approve. EXECUTE (`apply_approved_action`) is deliberately deferred (see Roadmap).

## Layout

```
src/
  index.ts              Express + streamable-HTTP transport + incoming bearer auth
  server.ts             Builds the McpServer and registers tools
  config.ts             Env loading/validation (all endpoints are config vars)
  auth.ts               Bearer check for the /mcp endpoints
  clients/
    crmClient.ts        Thin HTTP client for the CRM API
    webToolsClient.ts   Thin client for the WebPages PHP tools (reserved for EXECUTE)
  tools/
    read.ts             READ tools
    propose.ts          PROPOSE tools
    index.ts, util.ts
Dockerfile, docker-compose.yml, cloudflared/config.example.yml, .env.example
```

## Run locally

```bash
cp .env.example .env      # set MCP_AUTH_TOKEN and CRM_BASE_URL / CRM_SERVICE_TOKEN
npm install
npm run build
npm start                 # listens on :8930
curl localhost:8930/health
```

## Run with Docker

```bash
cp .env.example .env      # fill in values
docker compose up -d --build
```

Bind stays on `127.0.0.1:8930`; put Cloudflare in front for the public hostname.

## Cloudflare

Give it its own subdomain — `lm-mcp.website.com` — not a path under the website.

- Preferred: a **Cloudflare Tunnel** so the droplet needs no open inbound port.
  Either run the token-based sidecar (uncomment `cloudflared` in
  `docker-compose.yml`, set `TUNNEL_TOKEN`) or a locally-installed `cloudflared`
  with `cloudflared/config.example.yml`.
- Do **not** put interactive Cloudflare Access / SSO in front of `/mcp` — the
  client is Anthropic-hosted, not a browser; an interactive login breaks the
  connector. Use the app's bearer token for identity and Cloudflare for the
  non-interactive layers (WAF, rate limiting, optional IP allowlist).
- Disable caching for `lm-mcp.*` and confirm streaming works end-to-end through
  the proxy.

The connector URL Claude uses is `https://lm-mcp.website.com/mcp`, with
`Authorization: Bearer <MCP_AUTH_TOKEN>`.

## Configuration

| Var | Required | Purpose |
|-----|----------|---------|
| `MCP_AUTH_TOKEN` | yes | Bearer token the MCP client must present. `openssl rand -hex 32`. |
| `CRM_BASE_URL` | yes | Base URL of the CRM API (localhost when co-located; private VPC IP when split out). |
| `CRM_SERVICE_TOKEN` | yes* | Service credential sent to the CRM as `Authorization: Bearer`. |
| `WEBTOOLS_BASE_URL` | no | Reserved for EXECUTE. |
| `WEBTOOLS_SERVICE_TOKEN` | no | Reserved for EXECUTE. |
| `PORT` | no | Default `8930`. |

\* Required in practice because the CRM API is behind `requireAuth`. See below.

## CRM-side contract (what this server depends on)

This repo assumes two things on the CRM. They are **not** in this repo — they live
in `Liquid-Mind-CRM`:

1. **A service credential.** The CRM routes are gated by `requireAuth(...)`. The
   MCP server sends `CRM_SERVICE_TOKEN` as a bearer token; the CRM must accept a
   non-interactive service identity (a long-lived service JWT, or a dedicated
   middleware branch) with a role that permits the READ routes and the actions route.

2. **The AI_Action_Queue endpoint + table.** The PROPOSE tools `POST /api/actions`
   with this envelope:

   ```json
   {
     "actionType": "bid_change",
     "clientId": 42,
     "seriesASIN": "B0...",
     "platform": "AMG",
     "rationale": "…",
     "expectedImpactUsd": 430,
     "modelBasis": "…",
     "currentValue": { "…": "…" },
     "proposedValue": { "…": "…" },
     "proposedBy": "claude"
   }
   ```

   The endpoint should insert a row in `status = 'proposed'` and return the created
   row (including its `actionId`). The approve/deny UI and the atomic
   approved-only execution gate live on the CRM side. (Ask Claude for the
   `AI_Action_Queue` migration + routes — designed but not yet added.)

Until #2 exists, the READ tools work fully and the PROPOSE tools will return a
clear error from the CRM (404) — which is the expected state before the queue is
built.

## Adding a tool

1. Add a `server.registerTool(name, { title, description, inputSchema }, handler)`
   in `tools/read.ts` or `tools/propose.ts`.
2. The handler should be thin: call `crm.get/post/...` and return `ok(data)` /
   `fail(msg)`. No business logic here — extend the CRM instead.
3. Keep the tool list small and parameterized; prefer one flexible tool over many
   near-duplicates.

## Roadmap

- **EXECUTE phase:** add `apply_approved_action(actionId)` — looks up an APPROVED
  `AI_Action_Queue` row, routes to the matching WebPages tool via `webToolsClient`
  (or enqueues the existing Redis worker job), writes back the result. Refuses
  anything not in `approved` state.
- **Surface C:** wrap the AMS_Automation scripts (e.g. `pnl_sheet_filler.py`)
  behind a job-runner or the existing Redis queue so they become EXECUTE targets.
- **Per-manager identity:** swap the shared bearer token for OAuth if you want
  per-account-manager attribution on proposals.
