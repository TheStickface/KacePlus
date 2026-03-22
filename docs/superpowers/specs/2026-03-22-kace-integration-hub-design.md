# KacePlus — Integration Hub Design Spec
**Date:** 2026-03-22
**Scope:** Feature 3 — KACE → Microsoft Teams Notification Integration

---

## Overview

A single Node.js service that listens for webhook events from a Dell KACE helpdesk appliance and posts formatted notifications to a Microsoft Teams channel via an Incoming Webhook. Targeted at IT admins who need real-time ticket visibility without leaving Teams.

---

## Scope

**In scope:**
- Receiving and validating KACE webhook payloads
- Formatting events as Teams Adaptive Cards
- Delivering notifications to a Teams channel via Incoming Webhook
- Configurable event filtering (admins choose which events trigger notifications)

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
│   │   ├── kaceClient.js      # KACE REST API wrapper (future use)
│   │   └── config.js          # Loads and validates config.yaml
│   ├── integrations/
│   │   └── teams/
│   │       ├── notifier.js    # Posts Adaptive Cards to Teams webhook URL
│   │       └── templates.js   # Adaptive Card templates per event type
│   └── server.js              # Express app — KACE webhook receiver
├── config.yaml                # Runtime configuration
└── package.json
```

---

## Data Flow

```
KACE appliance
    │
    │  HTTP POST (webhook event)
    ▼
server.js
    │  Validates webhook secret
    │  Routes by event type
    ▼
teams/notifier.js
    │  Selects Adaptive Card template
    │  Populates with event data
    ▼
Microsoft Teams channel
    (via Incoming Webhook URL)
```

---

## Configuration

`config.yaml` at the project root:

```yaml
kace:
  webhook_secret: "..."          # Validates incoming KACE payloads

teams:
  webhook_url: "..."             # Teams Incoming Webhook URL
  channel_name: "IT Helpdesk"   # For display/logging purposes only

events:
  notify_on:
    - ticket.created
    - ticket.assigned
    - ticket.status_changed
    - ticket.sla_breach
```

All sensitive values should be provided via environment variables in production and referenced in `config.yaml` using `${ENV_VAR}` syntax.

---

## Components

### `server.js`
- Express HTTP server
- Single POST endpoint: `/webhook`
- Validates `X-KACE-Signature` header against `kace.webhook_secret`
- Returns `401` for invalid signatures, `200` on success
- Ignores unrecognized event types (forward compatibility)

### `core/config.js`
- Loads `config.yaml` at startup
- Validates required fields are present
- Throws on missing critical config (fail fast)

### `integrations/teams/templates.js`
- Exports one Adaptive Card template per supported event type
- Templates are pure functions: `(eventPayload) => AdaptiveCard JSON`
- Supported events: `ticket.created`, `ticket.assigned`, `ticket.status_changed`, `ticket.sla_breach`

### `integrations/teams/notifier.js`
- Receives a KACE event object
- Looks up the matching template
- Posts the card to the configured Teams Incoming Webhook URL via HTTP POST
- Retries up to 3 times with exponential backoff on delivery failure
- Logs success/failure to console

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Invalid/missing webhook signature | 401 response, log and drop |
| Unrecognized event type | Silently ignored, 200 response |
| Teams delivery failure | Retry 3x with exponential backoff, then log error |
| Missing required config at startup | Throw immediately, process exits |

---

## Testing

- **Unit tests:** `templates.js` (card output for each event type), `notifier.js` (retry logic with mocked HTTP), `server.js` (signature validation)
- **Integration test:** Fire a sample KACE payload at the local server, assert the Teams webhook stub receives correctly formatted Adaptive Card JSON

---

## Dependencies

| Package | Purpose |
|---|---|
| `express` | HTTP server / webhook receiver |
| `axios` | HTTP client for Teams webhook delivery |
| `js-yaml` | Parse `config.yaml` |
| `jest` | Unit and integration testing |

---

## Non-Goals

- No persistent storage — this service is stateless
- No UI — configuration is file-based
- No authentication layer beyond webhook secret validation
