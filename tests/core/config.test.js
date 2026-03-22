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
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.dontMock('js-yaml');
  });

  it('loads required fields from env vars', () => {
    const cfg = loadConfig({
      KACE_WEBHOOK_SECRET: 'secret123',
      TEAMS_WEBHOOK_URL: 'https://teams.example.com/webhook',
    });
    expect(cfg.kace.webhook_secret).toBe('secret123');
    expect(cfg.teams.webhook_url).toBe('https://teams.example.com/webhook');
  });

  it('loads channel_name literal value from yaml', () => {
    const cfg = loadConfig({
      KACE_WEBHOOK_SECRET: 'secret123',
      TEAMS_WEBHOOK_URL: 'https://teams.example.com/webhook',
    });
    // channel_name is a literal in yaml, not an env var — verify it loaded
    expect(cfg.teams.channel_name).toBe('IT Helpdesk');
  });

  it('defaults channel_name to KacePlus when absent from config', () => {
    jest.resetModules();
    // Mock js-yaml to return config without channel_name
    jest.doMock('js-yaml', () => ({
      load: () => ({
        kace: { webhook_secret: 'secret123' },
        teams: { webhook_url: 'https://example.com/webhook' },
        // channel_name intentionally omitted
      }),
    }));
    process.env = {
      KACE_WEBHOOK_SECRET: 'secret123',
      TEAMS_WEBHOOK_URL: 'https://example.com/webhook',
    };
    const cfg = require('../../src/core/config');
    expect(cfg.teams.channel_name).toBe('KacePlus');
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
