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

    // Serve one mail as a standalone HTML page (for the free screenshot API to render).
    if (action === 'raw') {
      const page = await core.getRawHtml({ key: url.searchParams.get('key'), id: url.searchParams.get('id') });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.status(page ? 200 : 404).send(page || '<!doctype html><title>Not found</title><p>Email not found.</p>');
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

    // ── Phase 2: competitor brand database + discovery ──
    if (action === 'brands') {
      const brands = await core.getBrands();
      res.status(200).json({ ok: true, brands, total: brands.length });
      return;
    }

    if (action === 'seed') {
      const r = await core.seedBrands(new Date().toISOString());
      res.status(200).json({ ok: true, ...r });
      return;
    }

    if (action === 'discover') {
      // Accept optional categories[]/geographies[]/limit via query (?categories=Tea,Coffee&limit=30).
      const csv = (k) => { const v = url.searchParams.get(k); return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []; };
      const found = await core.discoverBrands({
        categories: csv('categories'),
        geographies: csv('geographies'),
        limit: url.searchParams.get('limit'),
      });
      const stored = await core.appendBrands(found.brands, new Date().toISOString());
      res.status(200).json({ ok: true, proposed: found.brands.length, provider: found.provider, ...stored });
      return;
    }

    res.status(400).json({ ok: false, error: `Unknown action: ${action}` });
  } catch (err) {
    console.error(`[api/competitor] action=${action} failed:`, err);
    res.status(500).json({ ok: false, error: err.message });
  }
};
