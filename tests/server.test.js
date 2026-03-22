const crypto = require('crypto');
const request = require('supertest');

// Mock the notifier so server tests don't depend on Teams delivery behavior
jest.mock('../src/integrations/teams/notifier');

process.env.KACE_WEBHOOK_SECRET = 'testsecret';
process.env.TEAMS_WEBHOOK_URL = 'https://teams.example.com/webhook';

function makeApp() {
  let app;
  let notifyMock;
  jest.isolateModules(() => {
    jest.mock('../src/integrations/teams/notifier', () => jest.fn().mockResolvedValue(undefined));
    app = require('../src/server');
    notifyMock = require('../src/integrations/teams/notifier');
  });
  return { app, notifyMock };
}

function sign(body, secret) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

const SECRET = 'testsecret';
const PAYLOAD = JSON.stringify({ event: 'ticket.created', timestamp: '2026-01-01T00:00:00Z', data: { id: 1, title: 'Test' } });

describe('POST /webhook', () => {
  it('returns 401 when signature header is missing', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/webhook').send(PAYLOAD).set('Content-Type', 'application/json');
    expect(res.status).toBe(401);
  });

  it('returns 401 when signature is wrong', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/webhook')
      .send(PAYLOAD)
      .set('Content-Type', 'application/json')
      .set('X-KACE-Signature', 'badhex');
    expect(res.status).toBe(401);
  });

  it('returns 200 for a valid signed payload', async () => {
    const { app } = makeApp();
    const sig = sign(PAYLOAD, SECRET);
    const res = await request(app)
      .post('/webhook')
      .send(PAYLOAD)
      .set('Content-Type', 'application/json')
      .set('X-KACE-Signature', sig);
    expect(res.status).toBe(200);
  });

  it('returns 200 even when notifier is called (fire-and-forget)', async () => {
    const { app, notifyMock } = makeApp();
    const sig = sign(PAYLOAD, SECRET);
    const res = await request(app)
      .post('/webhook')
      .send(PAYLOAD)
      .set('Content-Type', 'application/json')
      .set('X-KACE-Signature', sig);
    expect(res.status).toBe(200);
    expect(notifyMock).toHaveBeenCalled();
  });

  it('returns 200 and drops events not in notify_on', async () => {
    const { app } = makeApp();
    const body = JSON.stringify({ event: 'ticket.deleted', data: {} });
    const sig = sign(body, SECRET);
    const res = await request(app)
      .post('/webhook')
      .send(body)
      .set('Content-Type', 'application/json')
      .set('X-KACE-Signature', sig);
    expect(res.status).toBe(200);
  });

  it('returns 200 when body is not valid JSON', async () => {
    const { app } = makeApp();
    const body = 'not-json';
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
    const { app } = makeApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
