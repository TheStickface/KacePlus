# KacePlus — Integration Hub Design Spec
**Date:** 2026-03-22
**Scope:** Feature 3 — KACE → Microsoft Teams Notification Integration

---

## Overview

A single Node.js service that listens for webhook events from a Dell KACE helpdesk appliance and posts formatted notifications to a Microsoft Teams channel via an Incoming Webhook. Targeted at IT admins who need real-time ticket visibility without leaving Teams.

**KACE instance hostname:** `dk1srv`

---

## Scope

**In scope:**
- Receiving and validating KACE webhook payloads
- Formatting events as Teams Adaptive Cards
- Delivering notifications to a Teams channel via Incoming Webhook
- Configurable event filtering (admins choose which events trigger notifications)
- Health check endpoint

**Out of scope:**
- Two-way Teams ↔ KACE commands
- Email-to-ticket creation (handled by existing tooling)
- Active Directory user enrichment
- Slack integration

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
    │  1. Validate X-KACE-Signature (HMAC-SHA256)
    │  2. Check event type against notify_on filter → drop if not listed
    │  3. Pass event to notifier
    ▼
teams/notifier.js
    │  Selects Adaptive Card template
    │  Populates with event data
    │  POST to Teams Incoming Webhook URL
    ▼
Microsoft Teams channel
```

---

## Webhook Signature Validation

**Before implementation, confirm whether `dk1srv` supports outbound webhook signatures** via the KACE admin console (Service Desk → Configuration → Webhooks). Appliance-class products sometimes do not support payload signing. The approach depends on the outcome:

**Option A — KACE supports HMAC-SHA256 signatures (preferred)**
The signature is sent in the `X-KACE-Signature` header as a hex digest.

Validation in `server.js`:
1. Configure the `/webhook` route with `express.raw({ type: 'application/json' })` to receive the raw body buffer. Do **not** use `express.json()` on this route — it consumes the body stream before the HMAC can be computed. Requires Express 4.16+.
2. Compute `HMAC-SHA256(rawBodyBuffer, kace.webhook_secret)`
3. Compare using **`crypto.timingSafeEqual`** to prevent timing attacks
4. Return `401` if the header is absent or the digest does not match

**Option B — KACE does not support payload signing**
Use an IP allowlist: accept requests only from `dk1srv`'s IP. Add `kace.allowed_ip` to `config.yaml`. Return `403` for all other source IPs. `kace.webhook_secret` is not required in this mode.

**Option C — Explicit unauthenticated POSTs**
Acceptable only if KacePlus and `dk1srv` are on the same isolated VLAN with no external access to the webhook port. Document this decision explicitly in config and deployment notes.

**Update this spec with the chosen option before implementation begins.**

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

> These schemas are representative. Verify against your KACE instance (`dk1srv`) and adjust field names as needed.

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
  port: 3000                                # Optional, default: 3000 (overridden by PORT env var)

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
| `teams.channel_name` | No | `"KacePlus"` (cosmetic — used in Adaptive Card footer text only; does not affect routing) |
| `server.port` | No | `3000` (env var `PORT` takes precedence) |
| `events.notify_on` | No | `["ticket.created", "ticket.assigned", "ticket.status_changed", "ticket.sla_breach"]` |

**Environment variable interpolation:** `config.js` reads `config.yaml` via `js-yaml`, then replaces any `${VAR_NAME}` strings with the corresponding `process.env` values. A missing required env var (after interpolation resulting in an empty string) causes `config.js` to throw at startup.

A `.env` file (loaded via `dotenv` at process start) may be used for local development. It must not be committed to version control — `.gitignore` must include `.env`. A `.env.example` file with placeholder values for all required variables should be committed to document the expected environment.

---

## Components

### `server.js`
- Express HTTP server, listens on `config.server.port` (default `3000`, overridden by `PORT` env var)
- `POST /webhook` — validates HMAC-SHA256 signature, filters by `events.notify_on`, passes matching events to `notifier.js`
- `GET /health` — returns `200 OK` with `{ status: "ok" }` for uptime monitoring
- Returns `401` for invalid signatures
- Returns `200` for valid requests regardless of Teams delivery outcome (prevents KACE from endlessly retrying for a downstream failure)
- Logging via `console.log` / `console.error` (structured logging not required at this scope)

### `core/config.js`
- Loads `config.yaml` at startup using `js-yaml`
- Interpolates `${ENV_VAR}` placeholders with `process.env` values
- Validates that `kace.webhook_secret` and `teams.webhook_url` are non-empty after interpolation
- Throws with a descriptive message on missing required config (fail fast before server starts)
- Applies defaults for all optional fields

### `integrations/teams/templates.js`
- Exports one Adaptive Card template function per supported event type
- Each is a pure function: `(eventPayload) => AdaptiveCard JSON`
- Supported events: `ticket.created`, `ticket.assigned`, `ticket.status_changed`, `ticket.sla_breach`

### `integrations/teams/notifier.js`
- Receives a validated KACE event object
- Looks up the matching template from `templates.js`
- POSTs the Adaptive Card to the configured Teams Incoming Webhook URL via `axios`
- Retries up to 3 times with exponential backoff (delays: 1s, 2s, 4s) on **retryable errors only**: network errors, 5xx responses, and `429 Too Many Requests` (respecting `Retry-After` header if present)
- Does **not** retry on 4xx responses (except 429) — these indicate a malformed card and will never succeed
- Logs success or final failure to console after all retries are exhausted

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Invalid/missing webhook signature | `401` response, log and drop |
| Event type not in `notify_on` filter (known but disabled by admin) | `200` response, silently drop — filtered in `server.js` before calling notifier |
| Completely unknown event type (not one of the four supported types) | `200` response, silently ignore — same filter in `server.js` handles both cases |
| Teams delivery failure after 3 retries | Log error, return `200` to KACE (prevents KACE retry storm) |
| Missing required config at startup | Throw with descriptive message, process exits with code 1 |

---

## Testing

- **Unit tests (`jest`):**
  - `templates.js` — correct Adaptive Card output for each of the four event types
  - `notifier.js` — retry logic with HTTP responses stubbed via `nock`
  - `server.js` — HMAC signature validation (valid, invalid, missing header), event filter logic
  - `config.js` — env var interpolation, required field validation

- **Integration test:** Start the Express server on a random port via `server.listen(0)` using `supertest`. Set up a `nock` intercept for the Teams Incoming Webhook URL before the request is made (strict mode — `nock` must not be in `allowUnmocked` mode to prevent accidental calls to the real Teams endpoint). POST a sample KACE payload with a valid signature; assert the `nock` stub received the expected Adaptive Card JSON.

---

## Dependencies

| Package | Purpose |
|---|---|
| `express` | HTTP server / webhook receiver |
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
- No authentication layer beyond webhook secret validation
- No structured/JSON logging — `console.log` is sufficient at this scope

---

## Future Work

- `kaceClient.js` — KACE REST API wrapper for features that require reading/writing ticket data (e.g., two-way Teams commands, ticket enrichment)
