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
    const scope = nock(WEBHOOK_HOST).post(WEBHOOK_PATH).reply(400);
    await notify({ type: 'ticket.created', data: { id: 1 } }, WEBHOOK_URL, 'CH');
    // Only one call should have been made (no retries)
    expect(scope.isDone()).toBe(true);
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
