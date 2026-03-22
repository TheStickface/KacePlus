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
