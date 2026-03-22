/**
 * Loads config.yaml, interpolates ${ENV_VAR} placeholders from process.env,
 * validates required fields, and exports the final config object.
 *
 * Required env vars: KACE_WEBHOOK_SECRET, TEAMS_WEBHOOK_URL
 * Optional env vars: PORT (default: 3000)
 */

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
