'use strict';

/**
 * /api/kb/brands
 *
 * GET     — list competitor brands (filter by category, region, active).
 * POST    — add a new brand.
 * PATCH   — update one brand by id (toggle is_active, update priority, etc.).
 * DELETE  — soft delete (sets is_active = false). Pass ?hard=1 to truly drop.
 *
 * Backed by public.competitor_brands (seeded with 60 Top 10 DTC brands
 * across tea / coffee / supplements × US / UK in migration 20260608).
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

const ALLOWED = ['name','website','category','region','priority','subscribe_url','email_alias','is_active','notes','added_by'];
function pick(o, keys) { const r={}; for (const k of keys) if (o[k] !== undefined) r[k] = o[k]; return r; }

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  let env;
  try { env = supaEnv(); }
  catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
  const headers = { apikey: env.key, Authorization: `Bearer ${env.key}`, 'Content-Type': 'application/json' };

  if (req.method === 'GET') {
    const q = req.query || {};
    const filters = [];
    if (q.category) filters.push(`category=eq.${encodeURIComponent(q.category)}`);
    if (q.region)   filters.push(`region=eq.${encodeURIComponent(q.region)}`);
    if (q.active !== undefined && q.active !== 'all') filters.push(`is_active=eq.${q.active === 'false' ? 'false' : 'true'}`);
    const filterStr = filters.length ? `&${filters.join('&')}` : '';
    const url = `${env.url}/rest/v1/competitor_brands?select=*&order=category.asc,region.asc,priority.asc,name.asc&limit=500${filterStr}`;
    try {
      const r = await fetch(url, { headers });
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        return res.status(r.status).json({ ok: false, items: [], error: txt.slice(0,300) });
      }
      const items = await r.json();
      // Aggregate counts for the UI
      const summary = items.reduce((acc, b) => {
        const k = `${b.category}|${b.region}`;
        acc[k] = (acc[k] || 0) + (b.is_active ? 1 : 0);
        return acc;
      }, {});
      return res.status(200).json({ ok: true, items, count: items.length, summary });
    } catch (err) {
      return res.status(500).json({ ok: false, items: [], error: err.message });
    }
  }

  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
    const row = pick(body, ALLOWED);
    if (!row.name || !row.category || !row.region) {
      return res.status(400).json({ ok: false, error: 'name, category, region required' });
    }
    try {
      const r = await fetch(`${env.url}/rest/v1/competitor_brands?on_conflict=name,region`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=representation,resolution=merge-duplicates' },
        body: JSON.stringify(row),
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        return res.status(r.status).json({ ok: false, error: txt.slice(0,300) });
      }
      const data = await r.json();
      return res.status(200).json({ ok: true, brand: Array.isArray(data) ? data[0] : data });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  if (req.method === 'PATCH') {
    const id = req.query?.id || (req.body && req.body.id);
    if (!id) return res.status(400).json({ ok: false, error: 'id required' });
    const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
    const patch = pick(body, ALLOWED);
    if (!Object.keys(patch).length) return res.status(400).json({ ok: false, error: 'no fields to update' });
    try {
      const r = await fetch(`${env.url}/rest/v1/competitor_brands?id=eq.${id}`, {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify(patch),
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        return res.status(r.status).json({ ok: false, error: txt.slice(0,300) });
      }
      const data = await r.json();
      return res.status(200).json({ ok: true, brand: Array.isArray(data) ? data[0] : data });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  if (req.method === 'DELETE') {
    const id = req.query?.id;
    if (!id) return res.status(400).json({ ok: false, error: 'id required' });
    const hard = req.query?.hard === '1';
    try {
      if (hard) {
        const r = await fetch(`${env.url}/rest/v1/competitor_brands?id=eq.${id}`, { method: 'DELETE', headers });
        if (!r.ok) {
          const txt = await r.text().catch(() => '');
          return res.status(r.status).json({ ok: false, error: txt.slice(0,300) });
        }
        return res.status(200).json({ ok: true, deleted: 'hard' });
      } else {
        const r = await fetch(`${env.url}/rest/v1/competitor_brands?id=eq.${id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ is_active: false }),
        });
        if (!r.ok) {
          const txt = await r.text().catch(() => '');
          return res.status(r.status).json({ ok: false, error: txt.slice(0,300) });
        }
        return res.status(200).json({ ok: true, deleted: 'soft' });
      }
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  return res.status(405).json({ ok: false, error: 'GET/POST/PATCH/DELETE only' });
};

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }
