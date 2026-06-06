'use strict';

/**
 * GET /api/kb/list
 *
 * Public read of public.kb_knowledge — the dashboard's Manual Knowledge tab
 * renders this. Limits + ordering kept tight so the payload stays small.
 *
 * Query: ?limit=200&status=summarized
 */

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'GET only' });

  const supaUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY
                || process.env.SUPABASE_SERVICE_KEY
                || process.env.SUPABASE_ANON_KEY
                || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supaUrl || !supaKey) {
    return res.status(500).json({ ok: false, items: [], error: 'supabase not configured' });
  }

  const limit = Math.min(parseInt(req.query?.limit || '200', 10) || 200, 500);
  const status = req.query?.status ? `&status=eq.${encodeURIComponent(req.query.status)}` : '';
  const url = `${supaUrl.replace(/\/$/, '')}/rest/v1/kb_knowledge?select=id,url,source_type,title,author,summary,key_points,tags,status,added_by,added_at,processed_at&order=added_at.desc&limit=${limit}${status}`;

  try {
    const r = await fetch(url, {
      headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` },
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return res.status(r.status).json({ ok: false, items: [], error: txt.slice(0, 300) });
    }
    const items = await r.json();
    return res.status(200).json({ ok: true, items, count: Array.isArray(items) ? items.length : 0 });
  } catch (err) {
    return res.status(500).json({ ok: false, items: [], error: err.message });
  }
};
