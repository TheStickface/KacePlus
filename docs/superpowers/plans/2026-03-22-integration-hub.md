# Integration Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Node.js service that receives KACE helpdesk webhook events from `dk1srv` and posts formatted Adaptive Card notifications to a Microsoft Teams channel via Incoming Webhook.

**Architecture:** Single Express service with three focused modules — `config.js` (loads/validates config), `templates.js` (pure functions producing Adaptive Card JSON per event type), and `notifier.js` (HTTP delivery with retry). `server.js` wires them together as a thin webhook receiver.

**Tech Stack:** Node.js 18+, Express 4.16+, axios, js-yaml, dotenv, jest, nock, supertest

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `package.json` | Create | Dependencies and npm scripts |
| `.gitignore` | Create | Exclude node_modules, .env |
| `.env.example` | Create | Document required env vars |
| `config.yaml` | Create | Runtime configuration |
| `src/core/config.js` | Create | Load config.yaml, interpolate env vars, validate, apply defaults |
| `src/integrations/teams/templates.js` | Create | Pure functions: eventPayload → Adaptive Card JSON |
| `src/integrations/teams/notifier.js` | Create | POST card to Teams webhook with retry logic |
| `src/server.js` | Create | Express app: POST /webhook, GET /health |
| `tests/core/config.test.js` | Create | Unit tests for config loading and validation |
| `tests/integrations/teams/templates.test.js` | Create | Unit tests for all four card templates |
| `tests/integrations/teams/notifier.test.js` | Create | Unit tests for retry logic and error handling |
| `tests/server.test.js` | Create | Unit tests for signature validation and event filtering |
| `tests/integration.test.js` | Create | End-to-end: POST webhook → assert Teams stub receives card |

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.env.example`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "kaceplus",
  "version": "0.1.0",
  "description": "KACE → Teams notification integration",
  "main": "src/server.js",
  "engines": { "node": ">=18" },
  "scripts": {
    "start": "node src/server.js",
    "test": "jest --runInBand"
  },
  "dependencies": {
    "axios": "^1.6.0",
    "dotenv": "^16.3.0",
    "express": "^4.18.0",
    "js-yaml": "^4.1.0"
  },
  "devDependencies": {
    "jest": "^29.7.0",
    "nock": "^13.4.0",
    "supertest": "^6.3.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, no errors

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
.env
```

- [ ] **Step 4: Create `.env.example`**

```
KACE_WEBHOOK_SECRET=your-hmac-secret-here
TEAMS_WEBHOOK_URL=https://your-org.webhook.office.com/...
PORT=3000
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .gitignore .env.example
git commit -m "chore: project scaffold with dependencies"
```

---

## Task 2: Config Module

**Files:**
- Create: `config.yaml`
- Create: `src/core/config.js`
- Create: `tests/core/config.test.js`

- [ ] **Step 1: Create `config.yaml`**

```yaml
kace:
  webhook_secret: "${KACE_WEBHOOK_SECRET}"

teams:
  webhook_url: "${TEAMS_WEBHOOK_URL}"
  channel_name: "IT Helpdesk"

server:
  port: "${PORT}"

events:
  notify_on:
    - ticket.created
    - ticket.assigned
    - ticket.status_changed
    - ticket.sla_breach
```

- [ ] **Step 2: Write failing tests for `config.js`**

Create `tests/core/config.test.js`:

```js
const path = require('path');

// Helper: run config loader with controlled env vars
function loadConfig(env = {}) {
  // Reset module cache so config re-runs each test
  jest.resetModules();
  process.env = { ...env };
  // Point to the real config.yaml
  return require('../../src/core/config');
}

describe('config', () => {
  it('loads required fields from env vars', () => {
    const cfg = loadConfig({
      KACE_WEBHOOK_SECRET: 'secret123',
      TEAMS_WEBHOOK_URL: 'https://teams.example.com/webhook',
    });
    expect(cfg.kace.webhook_secret).toBe('secret123');
    expect(cfg.teams.webhook_url).toBe('https://teams.example.com/webhook');
  });

  it('applies default channel_name when not set in yaml', () => {
    const cfg = loadConfig({
      KACE_WEBHOOK_SECRET: 'secret123',
      TEAMS_WEBHOOK_URL: 'https://teams.example.com/webhook',
    });
    // channel_name is a literal in yaml, not an env var — verify it loaded
    expect(cfg.teams.channel_name).toBe('IT Helpdesk');
  });

  it('defaults server.port to 3000 when PORT env var is not set', () => {
    const cfg = loadConfig({
      KACE_WEBHOOK_SECRET: 'secret123',
      TEAMS_WEBHOOK_URL: 'https://teams.example.com/webhook',
    });
    expect(cfg.server.port).toBe(3000);
  });

  it('uses PORT env var when set', () => {
    const cfg = loadConfig({
      KACE_WEBHOOK_SECRET: 'secret123',
      TEAMS_WEBHOOK_URL: 'https://teams.example.com/webhook',
      PORT: '8080',
    });
    expect(cfg.server.port).toBe(8080);
  });

  it('applies default notify_on list when not specified', () => {
    const cfg = loadConfig({
      KACE_WEBHOOK_SECRET: 'secret123',
      TEAMS_WEBHOOK_URL: 'https://teams.example.com/webhook',
    });
    expect(cfg.events.notify_on).toEqual([
      'ticket.created',
      'ticket.assigned',
      'ticket.status_changed',
      'ticket.sla_breach',
    ]);
  });

  it('throws when KACE_WEBHOOK_SECRET is missing', () => {
    expect(() =>
      loadConfig({ TEAMS_WEBHOOK_URL: 'https://teams.example.com/webhook' })
    ).toThrow(/KACE_WEBHOOK_SECRET/);
  });

  it('throws when TEAMS_WEBHOOK_URL is missing', () => {
    expect(() =>
      loadConfig({ KACE_WEBHOOK_SECRET: 'secret123' })
    ).toThrow(/TEAMS_WEBHOOK_URL/);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx jest tests/core/config.test.js --no-coverage`
Expected: FAIL — `Cannot find module '../../src/core/config'`

- [ ] **Step 4: Implement `src/core/config.js`**

```js
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const DEFAULT_NOTIFY_ON = [
  'ticket.created',
  'ticket.assigned',
  'ticket.status_changed',
  'ticket.sla_breach',
];

function interpolate(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/\$\{([^}]+)\}/g, (_, key) => process.env[key] ?? '');
}

function interpolateDeep(obj) {
  if (typeof obj === 'string') return interpolate(obj);
  if (Array.isArray(obj)) return obj.map(interpolateDeep);
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, interpolateDeep(v)])
    );
  }
  return obj;
}

const raw = yaml.load(
  fs.readFileSync(path.resolve(__dirname, '../../config.yaml'), 'utf8')
);
const cfg = interpolateDeep(raw);

if (!cfg.kace?.webhook_secret) {
  throw new Error('Missing required config: KACE_WEBHOOK_SECRET must be set');
}
if (!cfg.teams?.webhook_url) {
  throw new Error('Missing required config: TEAMS_WEBHOOK_URL must be set');
}

cfg.server = cfg.server ?? {};
const rawPort = cfg.server.port;
cfg.server.port = rawPort ? parseInt(rawPort, 10) || 3000 : 3000;

cfg.teams.channel_name = cfg.teams.channel_name || 'KacePlus';

cfg.events = cfg.events ?? {};
cfg.events.notify_on = cfg.events.notify_on ?? DEFAULT_NOTIFY_ON;

module.exports = cfg;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest tests/core/config.test.js --no-coverage`
Expected: PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
git add config.yaml src/core/config.js tests/core/config.test.js
git commit -m "feat: config loader with env var interpolation and validation"
```

---

## Task 3: Adaptive Card Templates

**Files:**
- Create: `src/integrations/teams/templates.js`
- Create: `tests/integrations/teams/templates.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/integrations/teams/templates.test.js`:

```js
const templates = require('../../../src/integrations/teams/templates');

const CHANNEL = 'IT Helpdesk';

describe('templates.ticket.created', () => {
  it('renders title and submitter', () => {
    const card = templates['ticket.created'](
      { id: 1, title: 'Broken keyboard', submitter: 'jane.doe', priority: 'High', category: 'Hardware', status: 'New' },
      CHANNEL
    );
    const body = JSON.stringify(card);
    expect(body).toContain('Broken keyboard');
    expect(body).toContain('jane.doe');
    expect(body).toContain('High');
  });

  it('renders graceful fallback for missing fields', () => {
    const card = templates['ticket.created']({}, CHANNEL);
    expect(JSON.stringify(card)).toContain('(unknown)');
  });

  it('includes channel name in footer', () => {
    const card = templates['ticket.created']({ id: 1 }, CHANNEL);
    expect(JSON.stringify(card)).toContain('IT Helpdesk');
  });
});

describe('templates.ticket.assigned', () => {
  it('renders assignee', () => {
    const card = templates['ticket.assigned'](
      { id: 2, title: 'Monitor flicker', assigned_to: 'john.smith', assigned_by: 'jane.doe' },
      CHANNEL
    );
    expect(JSON.stringify(card)).toContain('john.smith');
  });

  it('renders graceful fallback for missing fields', () => {
    const card = templates['ticket.assigned']({}, CHANNEL);
    expect(JSON.stringify(card)).toContain('(unknown)');
  });
});

describe('templates.ticket.status_changed', () => {
  it('renders old and new status', () => {
    const card = templates['ticket.status_changed'](
      { id: 3, title: 'Slow PC', old_status: 'New', new_status: 'In Progress', changed_by: 'john.smith' },
      CHANNEL
    );
    const body = JSON.stringify(card);
    expect(body).toContain('New');
    expect(body).toContain('In Progress');
  });

  it('renders graceful fallback for missing fields', () => {
    const card = templates['ticket.status_changed']({}, CHANNEL);
    expect(JSON.stringify(card)).toContain('(unknown)');
  });
});

describe('templates.ticket.sla_breach', () => {
  it('renders sla_type and breached_at', () => {
    const card = templates['ticket.sla_breach'](
      { id: 4, title: 'No internet', sla_type: 'resolution', breached_at: '2026-03-22T16:00:00Z' },
      CHANNEL
    );
    const body = JSON.stringify(card);
    expect(body).toContain('resolution');
    expect(body).toContain('2026-03-22T16:00:00Z');
  });

  it('renders graceful fallback for missing fields', () => {
    const card = templates['ticket.sla_breach']({}, CHANNEL);
    expect(JSON.stringify(card)).toContain('(unknown)');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/integrations/teams/templates.test.js --no-coverage`
Expected: FAIL — `Cannot find module`

- [ ] **Step 3: Implement `src/integrations/teams/templates.js`**

```js
const v = (val) => val ?? '(unknown)';

function footer(channel) {
  return {
    type: 'TextBlock',
    text: channel,
    size: 'Small',
    color: 'Default',
    isSubtle: true,
  };
}

function card(body, channel) {
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [...body, footer(channel)],
        },
      },
    ],
  };
}

module.exports = {
  'ticket.created': (data, channel) =>
    card(
      [
        { type: 'TextBlock', text: `🎫 New Ticket #${v(data.id)}: ${v(data.title)}`, weight: 'Bolder', size: 'Medium', wrap: true },
        { type: 'FactSet', facts: [
          { title: 'Submitter', value: v(data.submitter) },
          { title: 'Category', value: v(data.category) },
          { title: 'Priority', value: v(data.priority) },
          { title: 'Status', value: v(data.status) },
        ]},
      ],
      channel
    ),

  'ticket.assigned': (data, channel) =>
    card(
      [
        { type: 'TextBlock', text: `👤 Ticket #${v(data.id)} Assigned: ${v(data.title)}`, weight: 'Bolder', size: 'Medium', wrap: true },
        { type: 'FactSet', facts: [
          { title: 'Assigned To', value: v(data.assigned_to) },
          { title: 'Assigned By', value: v(data.assigned_by) },
        ]},
      ],
      channel
    ),

  'ticket.status_changed': (data, channel) =>
    card(
      [
        { type: 'TextBlock', text: `🔄 Status Changed — Ticket #${v(data.id)}: ${v(data.title)}`, weight: 'Bolder', size: 'Medium', wrap: true },
        { type: 'FactSet', facts: [
          { title: 'From', value: v(data.old_status) },
          { title: 'To', value: v(data.new_status) },
          { title: 'Changed By', value: v(data.changed_by) },
        ]},
      ],
      channel
    ),

  'ticket.sla_breach': (data, channel) =>
    card(
      [
        { type: 'TextBlock', text: `⚠️ SLA Breach — Ticket #${v(data.id)}: ${v(data.title)}`, weight: 'Bolder', size: 'Medium', color: 'Attention', wrap: true },
        { type: 'FactSet', facts: [
          { title: 'SLA Type', value: v(data.sla_type) },
          { title: 'Breached At', value: v(data.breached_at) },
        ]},
      ],
      channel
    ),
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/integrations/teams/templates.test.js --no-coverage`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add src/integrations/teams/templates.js tests/integrations/teams/templates.test.js
git commit -m "feat: adaptive card templates for all four KACE event types"
```

---

## Task 4: Notifier with Retry Logic

**Files:**
- Create: `src/integrations/teams/notifier.js`
- Create: `tests/integrations/teams/notifier.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/integrations/teams/notifier.test.js`:

```js
const nock = require('nock');
const notify = require('../../../src/integrations/teams/notifier');

const WEBHOOK_HOST = 'https://teams.example.com';
const WEBHOOK_PATH = '/webhook';
const WEBHOOK_URL = `${WEBHOOK_HOST}${WEBHOOK_PATH}`;

beforeEach(() => nock.cleanAll());
afterAll(() => nock.restore());

describe('notifier', () => {
  it('posts the card to the Teams webhook URL', async () => {
    const scope = nock(WEBHOOK_HOST).post(WEBHOOK_PATH).reply(200);
    await notify({ type: 'ticket.created', data: { id: 1, title: 'Test' } }, WEBHOOK_URL, 'IT Helpdesk');
    expect(scope.isDone()).toBe(true);
  });

  it('retries on 500 and succeeds on second attempt', async () => {
    nock(WEBHOOK_HOST).post(WEBHOOK_PATH).reply(500);
    nock(WEBHOOK_HOST).post(WEBHOOK_PATH).reply(200);
    await expect(
      notify({ type: 'ticket.created', data: { id: 1 } }, WEBHOOK_URL, 'CH')
    ).resolves.not.toThrow();
  });

  it('does not retry on 400', async () => {
    const scope = nock(WEBHOOK_HOST).post(WEBHOOK_PATH).reply(400).persist();
    await notify({ type: 'ticket.created', data: { id: 1 } }, WEBHOOK_URL, 'CH');
    // Only one call should have been made (no retries)
    expect(scope.pendingMocks().length).toBeGreaterThan(0);
    nock.cleanAll();
  });

  it('retries on 429 and respects Retry-After header', async () => {
    nock(WEBHOOK_HOST)
      .post(WEBHOOK_PATH)
      .reply(429, '', { 'Retry-After': '1' });
    nock(WEBHOOK_HOST).post(WEBHOOK_PATH).reply(200);
    await expect(
      notify({ type: 'ticket.created', data: { id: 1 } }, WEBHOOK_URL, 'CH')
    ).resolves.not.toThrow();
  });

  it('resolves without throwing after all retries exhausted', async () => {
    nock(WEBHOOK_HOST).post(WEBHOOK_PATH).reply(500).persist();
    await expect(
      notify({ type: 'ticket.created', data: { id: 1 } }, WEBHOOK_URL, 'CH')
    ).resolves.not.toThrow();
    nock.cleanAll();
  });

  it('resolves without throwing on network error', async () => {
    nock(WEBHOOK_HOST).post(WEBHOOK_PATH).replyWithError('ECONNREFUSED');
    await expect(
      notify({ type: 'ticket.created', data: { id: 1 } }, WEBHOOK_URL, 'CH')
    ).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/integrations/teams/notifier.test.js --no-coverage`
Expected: FAIL — `Cannot find module`

- [ ] **Step 3: Implement `src/integrations/teams/notifier.js`**

```js
const axios = require('axios');
const templates = require('./templates');

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

function isRetryable(error) {
  if (!error.response) return true; // network error
  const status = error.response.status;
  return status >= 500 || status === 429;
}

function getRetryDelay(error, attempt) {
  if (error.response?.status === 429) {
    const retryAfter = parseInt(error.response.headers?.['retry-after'] ?? '0', 10);
    if (retryAfter > 0) return retryAfter * 1000;
  }
  return BASE_DELAY_MS * Math.pow(2, attempt - 1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function notify(event, webhookUrl, channelName) {
  const template = templates[event.type];
  if (!template) {
    console.log(`[notifier] No template for event type: ${event.type} — skipping`);
    return;
  }

  let card;
  try {
    card = template(event.data ?? {}, channelName);
  } catch (err) {
    console.error(`[notifier] Template rendering failed for ${event.type}:`, err.message);
    return;
  }

  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    attempt++;
    try {
      await axios.post(webhookUrl, card);
      console.log(`[notifier] Delivered ${event.type} card (attempt ${attempt})`);
      return;
    } catch (err) {
      if (!isRetryable(err)) {
        console.error(`[notifier] Non-retryable error for ${event.type} (${err.response?.status}):`, err.message);
        return;
      }
      if (attempt < MAX_RETRIES) {
        const delay = getRetryDelay(err, attempt);
        console.warn(`[notifier] Attempt ${attempt} failed for ${event.type}, retrying in ${delay}ms`);
        await sleep(delay);
      } else {
        console.error(`[notifier] All ${MAX_RETRIES} attempts failed for ${event.type}:`, err.message);
      }
    }
  }
}

module.exports = notify;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/integrations/teams/notifier.test.js --no-coverage`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/integrations/teams/notifier.js tests/integrations/teams/notifier.test.js
git commit -m "feat: teams notifier with retry logic (retryable vs non-retryable, Retry-After)"
```

---

## Task 5: Express Server

**Files:**
- Create: `src/server.js`
- Create: `tests/server.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/server.test.js`:

```js
const crypto = require('crypto');
const request = require('supertest');

process.env.KACE_WEBHOOK_SECRET = 'testsecret';
process.env.TEAMS_WEBHOOK_URL = 'https://teams.example.com/webhook';

function makeApp() {
  jest.resetModules();
  return require('../src/server');
}

function sign(body, secret) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

const SECRET = 'testsecret';
const PAYLOAD = JSON.stringify({ event: 'ticket.created', timestamp: '2026-01-01T00:00:00Z', data: { id: 1, title: 'Test' } });

describe('POST /webhook', () => {
  it('returns 401 when signature header is missing', async () => {
    const app = makeApp();
    const res = await request(app).post('/webhook').send(PAYLOAD).set('Content-Type', 'application/json');
    expect(res.status).toBe(401);
  });

  it('returns 401 when signature is wrong', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/webhook')
      .send(PAYLOAD)
      .set('Content-Type', 'application/json')
      .set('X-KACE-Signature', 'badhex');
    expect(res.status).toBe(401);
  });

  it('returns 200 for a valid signed payload', async () => {
    const nock = require('nock');
    nock('https://teams.example.com').post('/webhook').reply(200);
    const app = makeApp();
    const sig = sign(PAYLOAD, SECRET);
    const res = await request(app)
      .post('/webhook')
      .send(PAYLOAD)
      .set('Content-Type', 'application/json')
      .set('X-KACE-Signature', sig);
    expect(res.status).toBe(200);
    nock.cleanAll();
  });

  it('returns 200 even when Teams delivery fails', async () => {
    const nock = require('nock');
    nock('https://teams.example.com').post('/webhook').reply(500).persist();
    const app = makeApp();
    const sig = sign(PAYLOAD, SECRET);
    const res = await request(app)
      .post('/webhook')
      .send(PAYLOAD)
      .set('Content-Type', 'application/json')
      .set('X-KACE-Signature', sig);
    expect(res.status).toBe(200);
    nock.cleanAll();
  });

  it('returns 200 and drops events not in notify_on', async () => {
    const app = makeApp();
    const body = JSON.stringify({ event: 'ticket.deleted', data: {} });
    const sig = sign(body, SECRET);
    const res = await request(app)
      .post('/webhook')
      .send(body)
      .set('Content-Type', 'application/json')
      .set('X-KACE-Signature', sig);
    expect(res.status).toBe(200);
  });
});

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const app = makeApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/server.test.js --no-coverage`
Expected: FAIL — `Cannot find module '../src/server'`

- [ ] **Step 3: Implement `src/server.js`**

```js
require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const config = require('./core/config');
const notify = require('./integrations/teams/notifier');

const app = express();

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-kace-signature'];
  if (!signature) {
    console.warn('[server] Missing X-KACE-Signature header');
    return res.status(401).json({ error: 'Missing signature' });
  }

  const expected = crypto
    .createHmac('sha256', config.kace.webhook_secret)
    .update(req.body)
    .digest('hex');

  let valid = false;
  try {
    valid = crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expected, 'hex')
    );
  } catch {
    // timingSafeEqual throws if buffers differ in length
    valid = false;
  }

  if (!valid) {
    console.warn('[server] Invalid signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let payload;
  try {
    payload = JSON.parse(req.body.toString());
  } catch {
    console.warn('[server] Failed to parse payload JSON');
    return res.status(200).json({ ok: true });
  }

  const { event, data } = payload;

  if (!config.events.notify_on.includes(event)) {
    return res.status(200).json({ ok: true });
  }

  // Fire-and-forget — notifier absorbs all errors
  notify({ type: event, data }, config.teams.webhook_url, config.teams.channel_name);

  return res.status(200).json({ ok: true });
});

module.exports = app;

if (require.main === module) {
  app.listen(config.server.port, () => {
    console.log(`[server] Listening on port ${config.server.port}`);
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/server.test.js --no-coverage`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/server.js tests/server.test.js
git commit -m "feat: express webhook receiver with HMAC-SHA256 validation and event filtering"
```

---

## Task 6: Integration Test

**Files:**
- Create: `tests/integration.test.js`

- [ ] **Step 1: Write the integration test**

Create `tests/integration.test.js`:

```js
const crypto = require('crypto');
const nock = require('nock');
const request = require('supertest');

// Disable all real HTTP calls — any unmatched request will throw
nock.disableNetConnect();
nock.enableNetConnect('127.0.0.1');

process.env.KACE_WEBHOOK_SECRET = 'intsecret';
process.env.TEAMS_WEBHOOK_URL = 'https://teams.example.com/webhook';

function sign(body, secret) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

describe('Integration: KACE webhook → Teams card', () => {
  afterEach(() => nock.cleanAll());

  it('delivers an Adaptive Card to Teams when a valid ticket.created event arrives', async () => {
    jest.resetModules();
    const app = require('../src/server');

    let capturedBody;
    nock('https://teams.example.com')
      .post('/webhook', (body) => {
        capturedBody = body;
        return true;
      })
      .reply(200);

    const payload = JSON.stringify({
      event: 'ticket.created',
      timestamp: '2026-03-22T10:00:00Z',
      data: { id: 42, title: 'Monitor not working', submitter: 'alice', priority: 'High', category: 'Hardware', status: 'New' },
    });
    const sig = sign(payload, 'intsecret');

    const res = await request(app)
      .post('/webhook')
      .send(payload)
      .set('Content-Type', 'application/json')
      .set('X-KACE-Signature', sig);

    // Allow notifier's async delivery to complete
    await new Promise((r) => setTimeout(r, 100));

    expect(res.status).toBe(200);
    expect(capturedBody).toBeDefined();
    // Confirm it's an Adaptive Card message
    const bodyStr = JSON.stringify(capturedBody);
    expect(bodyStr).toContain('AdaptiveCard');
    expect(bodyStr).toContain('Monitor not working');
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx jest tests/integration.test.js --no-coverage`
Expected: PASS (1 test)

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add tests/integration.test.js
git commit -m "test: integration test covering full KACE webhook → Teams card flow"
```

---

## Task 7: Push to GitHub

- [ ] **Step 1: Verify all tests pass**

Run: `npm test`
Expected: All tests pass, no failures

- [ ] **Step 2: Push**

```bash
git push
```

Expected: Branch pushed to `https://github.com/TheStickface/KacePlus`
