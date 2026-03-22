const nock = require('nock');

const WEBHOOK_HOST = 'https://teams.example.com';
const WEBHOOK_PATH = '/webhook';
const WEBHOOK_URL = `${WEBHOOK_HOST}${WEBHOOK_PATH}`;

beforeEach(() => {
  jest.useFakeTimers();
  nock.cleanAll();
});

afterEach(() => {
  jest.useRealTimers();
});

afterAll(() => nock.restore());

describe('notifier', () => {
  it('posts the card to the Teams webhook URL', async () => {
    const notify = require('../../../src/integrations/teams/notifier');
    const scope = nock(WEBHOOK_HOST).post(WEBHOOK_PATH).reply(200);
    const promise = notify({ type: 'ticket.created', data: { id: 1, title: 'Test' } }, WEBHOOK_URL, 'IT Helpdesk');
    await jest.runAllTimersAsync();
    await promise;
    expect(scope.isDone()).toBe(true);
  });

  it('retries on 500 and succeeds on second attempt', async () => {
    const notify = require('../../../src/integrations/teams/notifier');
    nock(WEBHOOK_HOST).post(WEBHOOK_PATH).reply(500);
    nock(WEBHOOK_HOST).post(WEBHOOK_PATH).reply(200);
    const promise = notify({ type: 'ticket.created', data: { id: 1 } }, WEBHOOK_URL, 'CH');
    await jest.runAllTimersAsync();
    await expect(promise).resolves.not.toThrow();
  });

  it('does not retry on 400', async () => {
    const notify = require('../../../src/integrations/teams/notifier');
    const scope = nock(WEBHOOK_HOST).post(WEBHOOK_PATH).reply(400);
    const promise = notify({ type: 'ticket.created', data: { id: 1 } }, WEBHOOK_URL, 'CH');
    await jest.runAllTimersAsync();
    await promise;
    expect(scope.isDone()).toBe(true);
  });

  it('retries on 429 and respects Retry-After header', async () => {
    const notify = require('../../../src/integrations/teams/notifier');
    nock(WEBHOOK_HOST)
      .post(WEBHOOK_PATH)
      .reply(429, '', { 'Retry-After': '1' });
    nock(WEBHOOK_HOST).post(WEBHOOK_PATH).reply(200);
    const promise = notify({ type: 'ticket.created', data: { id: 1 } }, WEBHOOK_URL, 'CH');
    await jest.runAllTimersAsync();
    await expect(promise).resolves.not.toThrow();
  });

  it('resolves without throwing after all retries exhausted', async () => {
    const notify = require('../../../src/integrations/teams/notifier');
    nock(WEBHOOK_HOST).post(WEBHOOK_PATH).reply(500).persist();
    const promise = notify({ type: 'ticket.created', data: { id: 1 } }, WEBHOOK_URL, 'CH');
    await jest.runAllTimersAsync();
    await expect(promise).resolves.not.toThrow();
    nock.cleanAll();
  });

  it('resolves without throwing on network error', async () => {
    const notify = require('../../../src/integrations/teams/notifier');
    nock(WEBHOOK_HOST).post(WEBHOOK_PATH).replyWithError('ECONNREFUSED');
    const promise = notify({ type: 'ticket.created', data: { id: 1 } }, WEBHOOK_URL, 'CH');
    await jest.runAllTimersAsync();
    await expect(promise).resolves.not.toThrow();
  });

  it('resolves without throwing for unknown event type', async () => {
    const notify = require('../../../src/integrations/teams/notifier');
    await expect(
      notify({ type: 'ticket.unknown', data: {} }, WEBHOOK_URL, 'CH')
    ).resolves.not.toThrow();
  });
});
