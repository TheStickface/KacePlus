# KacePlus — Integration Hub Design Spec
**Date:** 2026-03-22
**Scope:** Feature 3 — KACE → Microsoft Teams Notification Integration
**Node.js minimum:** 18+
**Express minimum:** 4.16+

---

## Overview

A single Node.js service that listens for webhook events from a Dell KACE helpdesk appliance and posts formatted notifications to a Microsoft Teams channel via an Incoming Webhook. Targeted at IT admins who need real-time ticket visibility without leaving Teams.

**KACE instance hostname:** `dk1srv`

---

## Scope

**In scope:**
- Receiving and validating KACE webhook payloads (HMAC-SHA256 — Option A confirmed)
- Formatting events as Teams Adaptive Cards
- Delivering notifications to a Teams channel via Incoming Webhook
- Configurable event filtering (admins choose which events trigger notifications)
- Health check endpoint

**Out of scope:**
- Two-way Teams ↔ KACE commands
- Email-to-ticket creation (handled by existing tooling)
- Active Directory user enrichment
- Slack integration
- TLS termination — assumed to be handled by the host environment or a reverse proxy; the Express server listens on plain HTTP
- Process management / deployment (e.g., PM2, Docker) — addressed in a separate deployment runbook

---

## Architecture

Single Node.js (Express) service with the following structure:

```
KacePlus/
├── src/
│   ├── core/
│   │   └── config.js          # Loads, interpolates env vars, and validates config.yaml
│   ├── integrations/
│   │   └── teams/
│   │       ├── notifier.js    # Posts Adaptive Cards to Teams webhook URL
│   │       └── templates.js   # Adaptive Card templates per event type
│   └── server.js              # Express app — KACE webhook receiver + health check
├── .env.example               # Documents all required environment variables
├── config.yaml                # Runtime configuration
└── package.json
```

> `kaceClient.js` (KACE REST API wrapper) is deferred to a future feature and is not part of this implementation.

---

## Data Flow

```
KACE appliance (dk1srv)
    │
    │  HTTP POST /webhook
    ▼
server.js
    │  1. Validate X-KACE-Signature (HMAC-SHA256) → 401 if invalid
    │  2. Check event type against notify_on filter → 200 + drop if not listed
    │  3. Pass event to notifier
    ▼
teams/notifier.js
    │  Selects Adaptive Card template
    │  Populates with event data
    │  POST to Teams Incoming Webhook URL
    │  (retries on failure; absorbs all errors)
    ▼
Microsoft Teams channel
    │
    └──► server.js returns 200 to KACE regardless of Teams delivery outcome
         (prevents KACE from re-sending on downstream failure)
```

---

## Webhook Signature Validation

**Chosen approach: Option A — HMAC-SHA256** (confirmed for `dk1srv`).

`dk1srv` signs outbound webhook payloads using HMAC-SHA256. The signature is sent in the `X-KACE-Signature` header as a hex digest.

Validation in `server.js`:
1. Configure the `/webhook` route with `express.raw({ type: 'application/json' })` to receive the raw body buffer. Do **not** use `express.json()` on this route — it consumes the body stream before the HMAC can be computed.
2. Compute `HMAC-SHA256(rawBodyBuffer, kace.webhook_secret)`
3. Compare using **`crypto.timingSafeEqual`** to prevent timing attacks
4. Return `401` if the header is absent or the digest does not match

---

## KACE Webhook Payload Schema

All events share a common envelope:

```json
{
  "event": "ticket.created",
  "timestamp": "2026-03-22T14:00:00Z",
  "data": { ... }
}
```

Per-event `data` schemas:

**`ticket.created`**
```json
{
  "id": 1234,
  "title": "Printer not working",
  "submitter": "jane.doe",
  "category": "Hardware",
  "priority": "Medium",
  "status": "New"
}
```

**`ticket.assigned`**
```json
{
  "id": 1234,
  "title": "Printer not working",
  "assigned_to": "john.smith",
  "assigned_by": "jane.doe"
}
```

**`ticket.status_changed`**
```json
{
  "id": 1234,
  "title": "Printer not working",
  "old_status": "New",
  "new_status": "In Progress",
  "changed_by": "john.smith"
}
```

**`ticket.sla_breach`**
```json
{
  "id": 1234,
  "title": "Printer not working",
  "sla_type": "resolution",
  "breached_at": "2026-03-22T16:00:00Z"
}
```

> These schemas are representative. Verify field names against `dk1srv` and adjust as needed.

**Intentionally excluded events:** `ticket.closed` and `ticket.comment_added` are not in scope for this version. If KACE emits them, they are silently dropped as unknown event types.

---

## Configuration

`config.yaml` at the project root:

```yaml
kace:
  webhook_secret: "${KACE_WEBHOOK_SECRET}"   # Required

teams:
  webhook_url: "${TEAMS_WEBHOOK_URL}"        # Required
  channel_name: "IT Helpdesk"               # Optional, default: "KacePlus"

server:
  port: "${PORT}"                            # Optional, default: 3000

events:
  notify_on:                                # Optional, defaults to all four if omitted
    - ticket.created
    - ticket.assigned
    - ticket.status_changed
    - ticket.sla_breach
```

**Required vs optional fields:**

| Field | Required | Default |
|---|---|---|
| `kace.webhook_secret` | Yes | — |
| `teams.webhook_url` | Yes | — |
| `teams.channel_name` | No | `"KacePlus"` (cosmetic — rendered in Adaptive Card footer `TextBlock` only; does not affect routing) |
| `server.port` | No | `3000` |
| `events.notify_on` | No | `["ticket.created", "ticket.assigned", "ticket.status_changed", "ticket.sla_breach"]` |

**Environment variable interpolation:** `config.js` reads `config.yaml` via `js-yaml`, then replaces any `${VAR_NAME}` strings with the corresponding `process.env` values. For `server.port`, if the interpolated value is empty or missing, `config.js` falls back to `3000`. A missing required env var (resulting in an empty string after interpolation) causes `config.js` to throw at startup.

**dotenv load order:** `require('dotenv').config()` must be called at the very top of `server.js`, before importing `config.js`, to ensure env vars are available when `config.js` runs. A `.env` file must not be committed — `.gitignore` must include `.env`. A `.env.example` file documents all required variables and is committed to version control.

---

## Components

### `server.js`
- Calls `require('dotenv').config()` before any other imports
- Express HTTP server (Express 4.16+), listens on `config.server.port` (default `3000`)
- `POST /webhook` — configured with `express.raw({ type: 'application/json' })`; validates HMAC-SHA256 signature; filters by `events.notify_on`; passes matching events to `notifier.js`; always returns `200` for valid (signed) payloads regardless of downstream outcome
- `GET /health` — returns `200 OK` with `{ status: "ok" }` for uptime monitoring
- Returns `401` for invalid or missing signatures
- Logging via `console.log` / `console.error` (structured logging not required at this scope)
- Note: signature validation and event filtering are co-located in `server.js` as a deliberate trade-off for simplicity at this scope; if `server.js` grows, extracting a `validateSignature` middleware is the natural first refactor

### `core/config.js`
- Loads `config.yaml` at startup using `js-yaml`
- Interpolates `${ENV_VAR}` placeholders with `process.env` values; falls back to `3000` for `server.port` if unset
- Validates that `kace.webhook_secret` and `teams.webhook_url` are non-empty after interpolation
- Throws with a descriptive message on missing required config (fail fast before server starts)
- Applies defaults for all optional fields

### `integrations/teams/templates.js`
- Exports one Adaptive Card template function per supported event type
- Each is a pure function: `(eventPayload) => AdaptiveCard JSON`
- Templates are **defensive**: if expected fields are absent, render a graceful fallback (e.g., `"(unknown)"`) rather than throwing
- Each template includes a footer `TextBlock` displaying `config.teams.channel_name`
- Supported events: `ticket.created`, `ticket.assigned`, `ticket.status_changed`, `ticket.sla_breach`

### `integrations/teams/notifier.js`
- Receives a validated KACE event object
- Looks up the matching template from `templates.js`
- POSTs the Adaptive Card to the configured Teams Incoming Webhook URL via `axios`
- Retries up to 3 times with exponential backoff (delays: 1s, 2s, 4s) on **retryable errors only**: network errors, 5xx responses, and `429 Too Many Requests` (respecting `Retry-After` header if present)
- Does **not** retry on 4xx responses (except 429) — these indicate a malformed card and will never succeed
- Catches all errors (including template rendering errors) and logs without re-throwing — caller (`server.js`) always returns `200`

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Invalid/missing webhook signature | `401` response, log and drop |
| Event type not in `notify_on` filter (known but disabled) | `200` response, silently drop — filtered in `server.js` |
| Completely unknown event type | `200` response, silently ignore — same filter handles both cases |
| Payload missing expected fields (valid signature, bad body) | Template renders graceful fallback; `notifier.js` posts the fallback card; `server.js` returns `200` |
| Teams delivery failure after 3 retries | Log error, `server.js` returns `200` to KACE (prevents retry storm) |
| Missing required config at startup | Throw with descriptive message, process exits with code 1 |

---

## Testing

- **Unit tests (`jest`):**
  - `templates.js` — correct Adaptive Card output for each of the four event types; graceful fallback for missing fields
  - `notifier.js` — retry logic (retryable vs non-retryable errors) with HTTP responses stubbed via `nock`; `Retry-After` header respected on 429 responses
  - `server.js` — HMAC signature validation (valid, invalid, missing header); event filter logic; always returns `200` for valid payloads
  - `config.js` — env var interpolation; `server.port` fallback to `3000`; required field validation

- **Integration test:** Start the Express server on a random port via `server.listen(0)` using `supertest`. Set up a `nock` intercept for the Teams Incoming Webhook URL before the request is made (`nock.disableNetConnect()` to prevent accidental calls to real endpoints). POST a sample KACE payload with a valid HMAC-SHA256 signature; assert the `nock` stub received the expected Adaptive Card JSON.

---

## Dependencies

| Package | Purpose |
|---|---|
| `express` | HTTP server / webhook receiver (4.16+) |
| `axios` | HTTP client for Teams webhook delivery |
| `js-yaml` | Parse `config.yaml` |
| `dotenv` | Load `.env` for local development |
| `jest` | Unit and integration testing |
| `nock` | HTTP stub for testing Teams webhook calls |
| `supertest` | HTTP assertions against the Express server in integration tests |

---

## Non-Goals

- No persistent storage — this service is stateless
- No UI — configuration is file-based
- No authentication layer beyond HMAC-SHA256 webhook secret validation
- No structured/JSON logging — `console.log` is sufficient at this scope
- No TLS termination — handled by host environment or reverse proxy
- No deployment/process management — addressed in a separate deployment runbook

---

## Future Work

- `kaceClient.js` — KACE REST API wrapper for features that require reading/writing ticket data (e.g., two-way Teams commands, ticket enrichment)
- `ticket.closed` and `ticket.comment_added` event support
