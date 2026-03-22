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
    const scope = nock('https://teams.example.com')
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

    // Wait for the nock scope to be consumed (notifier delivered the card)
    const deadline = Date.now() + 2000;
    while (!scope.isDone() && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }

    expect(res.status).toBe(200);
    expect(capturedBody).toBeDefined();
    // Confirm it's an Adaptive Card message
    const bodyStr = JSON.stringify(capturedBody);
    expect(bodyStr).toContain('AdaptiveCard');
    expect(bodyStr).toContain('Monitor not working');
  });
});
