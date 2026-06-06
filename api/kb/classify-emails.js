'use strict';

/**
 * /api/kb/classify-emails
 *
 * Format bifurcation for captured competitor emails. Reads from the existing
 * competitor benchmarking pipeline (Google Sheet via /api/competitor?action=list)
 * and writes a classification row to public.competitor_emails_classified for
 * each email.
 *
 * Classifier is heuristic (cheap, deterministic). LLM-based classification
 * could be added later if accuracy needs to improve.
 *
 * GET  ?limit=200       — list current classifications
 * GET  ?summary=1       — return aggregate counts by format
 * POST                  — run the classifier over all captured emails;
 *                         skips already-classified email_keys; returns counts
 *
 * Body (optional on POST): { reclassify: true }  — re-runs even on existing rows.
 */

function supaEnv() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
           || process.env.SUPABASE_SERVICE_KEY
           || process.env.SUPABASE_ANON_KEY
           || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL or SUPABASE_*_KEY missing');
  return { url: url.replace(/\/$/, ''), key };
}

function classify({ html, bodyText }) {
  const text = (bodyText || '').trim();
  const wordCount = text ? text.split(/\s+/).length : 0;

  // Count images in raw HTML
  const imgMatches = (html || '').match(/<img\b[^>]*>/gi) || [];
  const imageCount = imgMatches.length;

  // Heuristics
  let format;
  if (wordCount >= 120 && imageCount <= 2) format = 'text';
  else if (imageCount >= 6 || (imageCount >= 3 && wordCount < 80)) format = 'image_heavy';
  else if (wordCount >= 40 && imageCount >= 1 && imageCount <= 5) format = 'html';
  else format = 'mixed';

  return { format, word_count: wordCount, image_count: imageCount };
}

async function fetchEmails(origin) {
  // Reuse the existing competitor endpoint to read the captured emails.
  const r = await fetch(`${origin}/api/competitor?action=list`);
  if (!r.ok) throw new Error(`/api/competitor?action=list returned ${r.status}`);
  const data = await r.json();
  return data.emails || [];
}

async function fetchHtml(origin, id) {
  const r = await fetch(`${origin}/api/competitor?action=html&id=${encodeURIComponent(id)}`);
  if (!r.ok) return '';
  const data = await r.json().catch(() => ({}));
  return data && typeof data.html === 'string' ? data.html : '';
}

function dedupeKey(e) {
  return `${(e.senderEmail || '').toLowerCase()}|${(e.subject || '').trim()}|${e.receivedAt || ''}`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  let env;
  try { env = supaEnv(); }
  catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
  const headers = { apikey: env.key, Authorization: `Bearer ${env.key}`, 'Content-Type': 'application/json' };

  if (req.method === 'GET') {
    if (req.query?.summary === '1') {
      // Aggregate counts by format
      const url = `${env.url}/rest/v1/competitor_emails_classified?select=format,brand&limit=2000`;
      const r = await fetch(url, { headers });
      const items = r.ok ? await r.json() : [];
      const counts = items.reduce((acc, it) => { acc[it.format] = (acc[it.format] || 0) + 1; return acc; }, {});
      const byBrand = items.reduce((acc, it) => {
        if (!it.brand) return acc;
        acc[it.brand] = acc[it.brand] || { text:0, html:0, image_heavy:0, mixed:0 };
        acc[it.brand][it.format] = (acc[it.brand][it.format] || 0) + 1;
        return acc;
      }, {});
      return res.status(200).json({ ok: true, total: items.length, counts, byBrand });
    }
    const limit = Math.min(parseInt(req.query?.limit || '200', 10) || 200, 500);
    const fmt = req.query?.format ? `&format=eq.${encodeURIComponent(req.query.format)}` : '';
    const url = `${env.url}/rest/v1/competitor_emails_classified?select=*&order=classified_at.desc&limit=${limit}${fmt}`;
    const r = await fetch(url, { headers });
    const items = r.ok ? await r.json() : [];
    return res.status(200).json({ ok: true, items });
  }

  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'GET/POST only' });

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const reclassify = !!body.reclassify;

  // Build origin from request — works for both /api routes and direct curl.
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const origin = `${proto}://${host}`;

  let emails;
  try { emails = await fetchEmails(origin); }
  catch (err) { return res.status(502).json({ ok: false, error: 'fetch emails failed: ' + err.message }); }

  // Existing keys
  let existing = new Set();
  if (!reclassify) {
    const r = await fetch(`${env.url}/rest/v1/competitor_emails_classified?select=email_key&limit=2000`, { headers });
    if (r.ok) {
      const rows = await r.json();
      existing = new Set(rows.map((x) => x.email_key));
    }
  }

  const toUpsert = [];
  const counts = { text:0, html:0, image_heavy:0, mixed:0 };
  let scanned = 0, skipped = 0;

  for (const e of emails) {
    scanned++;
    const key = dedupeKey(e);
    if (!reclassify && existing.has(key)) { skipped++; continue; }

    let html = '';
    try { html = await fetchHtml(origin, e.id); } catch {}
    const c = classify({ html, bodyText: e.bodyText });
    counts[c.format] = (counts[c.format] || 0) + 1;
    toUpsert.push({
      email_key: key,
      brand: e.brand || null,
      format: c.format,
      word_count: c.word_count,
      image_count: c.image_count,
      has_promo: !!(e.promoCodes && e.promoCodes !== 'None'),
      promo_codes: e.promoCodes && e.promoCodes !== 'None' ? e.promoCodes : null,
      classifier: 'heuristic',
    });
  }

  if (!toUpsert.length) {
    return res.status(200).json({ ok: true, scanned, skipped, inserted: 0, counts });
  }

  try {
    const r = await fetch(`${env.url}/rest/v1/competitor_emails_classified?on_conflict=email_key`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal,resolution=merge-duplicates' },
      body: JSON.stringify(toUpsert),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return res.status(r.status).json({ ok: false, error: txt.slice(0, 300), scanned, inserted: 0 });
    }
    return res.status(200).json({ ok: true, scanned, skipped, inserted: toUpsert.length, counts });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message, scanned, inserted: 0 });
  }
};

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }
