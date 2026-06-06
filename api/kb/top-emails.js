'use strict';

/**
 * /api/kb/top-emails
 *
 * GET            — list top VAHDAM emails (paginated).
 * POST           — single insert: one row in body.
 * POST ?bulk=1   — bulk insert: { items: [...] } (capped at 200 per call).
 *
 * Accepts JSON only. (Paste-CSV → parse in the UI, then POST as JSON.)
 *
 * Row shape (all optional except subject + body_text):
 *   { sent_at, subject, preheader, body_text, body_html, market, segment,
 *     campaign_type, open_rate, click_rate, conversion_rate, revenue,
 *     send_count, notes, tags }
 */

const ALLOWED_FIELDS = [
  'sent_at','subject','preheader','body_text','body_html','market','segment',
  'campaign_type','open_rate','click_rate','conversion_rate','revenue',
  'send_count','notes','tags','added_by'
];

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') out[k] = obj[k];
  return out;
}

function clampRate(v) {
  if (v === undefined || v === null) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  // Accept 0-1 or 0-100 (auto-detect)
  if (n > 1.0001) return Math.min(n / 100, 1);
  return Math.max(0, Math.min(n, 1));
}

function normalize(row) {
  const r = pick(row, ALLOWED_FIELDS);
  if (!r.subject || !r.body_text) return null;
  if (r.open_rate !== undefined)       r.open_rate       = clampRate(r.open_rate);
  if (r.click_rate !== undefined)      r.click_rate      = clampRate(r.click_rate);
  if (r.conversion_rate !== undefined) r.conversion_rate = clampRate(r.conversion_rate);
  if (r.revenue !== undefined)         r.revenue         = Number(r.revenue) || null;
  if (r.send_count !== undefined)      r.send_count      = parseInt(r.send_count, 10) || null;
  if (r.tags && !Array.isArray(r.tags)) r.tags = String(r.tags).split(',').map((t)=>t.trim().toLowerCase()).filter(Boolean);
  return r;
}

function supaEnv() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
           || process.env.SUPABASE_SERVICE_KEY
           || process.env.SUPABASE_ANON_KEY
           || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL or SUPABASE_*_KEY missing');
  return { url: url.replace(/\/$/, ''), key };
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

  if (req.method === 'GET') {
    const limit = Math.min(parseInt(req.query?.limit || '200', 10) || 200, 500);
    const market = req.query?.market;
    const orderBy = req.query?.order === 'open' ? 'open_rate.desc' : (req.query?.order === 'rev' ? 'revenue.desc' : 'added_at.desc');
    const filter = market ? `&market=eq.${encodeURIComponent(market)}` : '';
    const url = `${env.url}/rest/v1/kb_top_emails?select=*&order=${orderBy}&limit=${limit}${filter}`;
    try {
      const r = await fetch(url, { headers: { apikey: env.key, Authorization: `Bearer ${env.key}` } });
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        return res.status(r.status).json({ ok: false, items: [], error: txt.slice(0, 300) });
      }
      const items = await r.json();
      return res.status(200).json({ ok: true, items, count: Array.isArray(items) ? items.length : 0 });
    } catch (err) {
      return res.status(500).json({ ok: false, items: [], error: err.message });
    }
  }

  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
    const isBulk = req.query?.bulk === '1' || Array.isArray(body.items);
    const rawRows = isBulk ? (body.items || []) : [body];
    if (!Array.isArray(rawRows) || !rawRows.length) {
      return res.status(400).json({ ok: false, error: 'Provide one row or { items: [...] }' });
    }
    if (rawRows.length > 200) {
      return res.status(400).json({ ok: false, error: 'Bulk limit is 200 rows per request' });
    }
    const rows = rawRows.map(normalize).filter(Boolean);
    if (!rows.length) {
      return res.status(400).json({ ok: false, error: 'No valid rows — each row must have subject + body_text' });
    }
    try {
      const r = await fetch(`${env.url}/rest/v1/kb_top_emails`, {
        method: 'POST',
        headers: {
          apikey: env.key,
          Authorization: `Bearer ${env.key}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify(rows),
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        return res.status(r.status).json({ ok: false, inserted: 0, error: txt.slice(0, 300) });
      }
      const inserted = await r.json();
      return res.status(200).json({ ok: true, inserted: Array.isArray(inserted) ? inserted.length : 0, rejected: rawRows.length - rows.length });
    } catch (err) {
      return res.status(500).json({ ok: false, inserted: 0, error: err.message });
    }
  }

  return res.status(405).json({ ok: false, error: 'GET or POST only' });
};

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }
