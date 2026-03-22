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
