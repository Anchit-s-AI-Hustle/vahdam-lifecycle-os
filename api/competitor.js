'use strict';

/**
 * /api/competitor — single catch-all endpoint for Competitor Benchmarking.
 *
 * One Serverless Function (Hobby plan caps at 12; the app sits at the limit),
 * dispatched by ?action=:
 *   ?action=list            → all captured mails (newest first)        [GET, public]
 *   ?action=html&id=<row>   → raw HTML for one mail                    [GET, public]
 *   ?action=poll            → throttled sync trigger for the dashboard [GET, public]
 *   ?action=sync            → force a full sync                        [GET/POST, CRON_SECRET]
 *
 * All data + ingestion live in this repo (api/_shared/competitor-core.js) — no
 * dependency on any other deployment.
 */

const core = require('./_shared/competitor-core');

// Warm-instance throttle so concurrent dashboards / hot-reloads don't hammer IMAP.
const POLL_THROTTLE_MS = 30000;
let lastPoll = 0;
let lastResult = null;

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // unprotected if not configured (dev)
  const auth = req.headers && req.headers.authorization;
  if (auth === `Bearer ${secret}`) return true;
  const url = new URL(req.url, 'http://x');
  return url.searchParams.get('secret') === secret;
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const url = new URL(req.url, 'http://x');
  const action = url.searchParams.get('action') || 'list';

  try {
    if (action === 'list') {
      const emails = await core.getAllEmails();
      res.status(200).json({ ok: true, emails });
      return;
    }

    if (action === 'html') {
      const id = Number(url.searchParams.get('id'));
      if (!Number.isInteger(id) || id < 2) { res.status(400).json({ ok: false, html: '' }); return; }
      const html = await core.getEmailHtml(id);
      res.status(200).json({ ok: true, html });
      return;
    }

    if (action === 'poll') {
      const now = Date.now();
      const since = now - lastPoll;
      if (since < POLL_THROTTLE_MS) {
        res.status(200).json({ ok: true, throttled: true, nextSyncInMs: POLL_THROTTLE_MS - since, last: lastResult });
        return;
      }
      lastPoll = now;
      lastResult = await core.runSync(25);
      res.status(200).json({ ok: true, throttled: false, ...lastResult });
      return;
    }

    if (action === 'sync') {
      if (!authorized(req)) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      const result = await core.runSync(25);
      lastResult = result;
      res.status(200).json(result);
      return;
    }

    res.status(400).json({ ok: false, error: `Unknown action: ${action}` });
  } catch (err) {
    console.error(`[api/competitor] action=${action} failed:`, err);
    res.status(500).json({ ok: false, error: err.message });
  }
};
