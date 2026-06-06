'use strict';

/**
 * POST /api/kb/ingest
 *
 * Anyone pastes a URL (blog, tweet, video, podcast notes, anything). The
 * endpoint fetches the page server-side, extracts main text, asks the LLM
 * to summarize, and stores the result in Supabase `public.kb_knowledge`.
 *
 * Body: { url, source_type?, tags?, added_by?, notes? }
 * Returns: { ok, id, status, summary, key_points, tags }
 *
 * RLS on kb_knowledge is permissive — we write with the anon key. To tighten
 * later, switch to SUPABASE_SERVICE_ROLE_KEY here.
 */

const crypto = require('crypto');
const { callLLM } = require('../_shared/llm.js');

// ── helpers ────────────────────────────────────────────────────────────────
function canonicalUrl(raw) {
  try {
    const u = new URL(raw);
    u.hash = '';
    // strip common tracking params
    const TRACK = /^(utm_|fbclid$|gclid$|mc_|_hsenc$|_hsmi$|hsCtaTracking$|ref$|source$)/i;
    [...u.searchParams.keys()].forEach((k) => { if (TRACK.test(k)) u.searchParams.delete(k); });
    if (u.pathname.endsWith('/') && u.pathname !== '/') u.pathname = u.pathname.slice(0, -1);
    return u.toString();
  } catch {
    return raw;
  }
}

function urlHash(url) {
  return crypto.createHash('sha1').update(canonicalUrl(url)).digest('hex');
}

function stripHtml(html) {
  if (!html) return '';
  // Remove script / style / noscript / nav / footer / aside
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ');
  // Strip tags
  s = s.replace(/<\/?[a-z][^>]*>/gi, ' ');
  // Decode common entities
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  // Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim();
  // Cap to 50KB to keep LLM costs bounded
  return s.slice(0, 50000);
}

function extractTitle(html) {
  const m = /<title[^>]*>([^<]+)<\/title>/i.exec(html || '');
  if (m) return m[1].trim().slice(0, 240);
  const og = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html || '');
  if (og) return og[1].trim().slice(0, 240);
  return null;
}

function extractAuthor(html) {
  const m = /<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)["']/i.exec(html || '');
  if (m) return m[1].trim().slice(0, 120);
  const og = /<meta[^>]+property=["']article:author["'][^>]+content=["']([^"']+)["']/i.exec(html || '');
  if (og) return og[1].trim().slice(0, 120);
  return null;
}

function guessSourceType(url) {
  const u = url.toLowerCase();
  if (/twitter\.com|x\.com/.test(u)) return 'tweet';
  if (/youtube\.com|vimeo\.com/.test(u)) return 'video';
  if (/medium\.com|substack\.com|\.blog|wordpress|ghost\.io/.test(u)) return 'blog';
  return 'web';
}

async function fetchPage(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 VahdamKBBot/1.0 (+contact: knowledge@vahdam.com)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    const text = await res.text();
    return { status: res.status, html: text, finalUrl: res.url || url };
  } finally {
    clearTimeout(t);
  }
}

// ── Supabase REST helpers (no SDK to keep this serverless function small) ──
function supabaseEnv() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
           || process.env.SUPABASE_SERVICE_KEY
           || process.env.SUPABASE_ANON_KEY
           || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL or SUPABASE_*_KEY missing');
  return { url: url.replace(/\/$/, ''), key };
}

async function sbInsert(table, row) {
  const { url, key } = supabaseEnv();
  const r = await fetch(`${url}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(row),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`supabase insert ${table} failed: ${r.status} ${txt.slice(0, 300)}`);
  }
  const data = await r.json().catch(() => []);
  return Array.isArray(data) ? data[0] : data;
}

async function sbUpsertByHash(table, row, conflictColumn) {
  const { url, key } = supabaseEnv();
  const r = await fetch(`${url}/rest/v1/${table}?on_conflict=${conflictColumn}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation,resolution=merge-duplicates',
    },
    body: JSON.stringify(row),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`supabase upsert ${table} failed: ${r.status} ${txt.slice(0, 300)}`);
  }
  const data = await r.json().catch(() => []);
  return Array.isArray(data) ? data[0] : data;
}

async function sbUpdateById(table, id, patch) {
  const { url, key } = supabaseEnv();
  const r = await fetch(`${url}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(patch),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`supabase update ${table} failed: ${r.status} ${txt.slice(0, 300)}`);
  }
  return r.json().catch(() => null);
}

// ── LLM summarization ──────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are the knowledge curator for VAHDAM India — a premium D2C tea brand. You receive raw extracted text from a web page (blog post, tweet, article, podcast notes). Your job: distill it into a useful reference for the brand's marketing team.

Return STRICT JSON ONLY:
{
  "summary": "<one paragraph, 60-120 words, what the source actually says + why a marketer should care>",
  "key_points": ["<takeaway 1>", "<takeaway 2>", "<takeaway 3>", "<takeaway 4>", "<takeaway 5>"],
  "tags": ["<2-5 short tags like copywriting, retention, positioning, ux, growth, branding>"]
}

Rules:
- Be specific. Reference numbers, brand names, frameworks if mentioned.
- Skip headers, ads, navigation, footers.
- If the text is empty/garbage, return {"summary":"<could not extract content>","key_points":[],"tags":["error"]}.
- Output the JSON object only, starting with { and ending with }. No markdown.`;

async function summarize(textBody, urlForContext) {
  if (!textBody || textBody.length < 60) {
    return { summary: 'Could not extract meaningful content from this URL.', key_points: [], tags: ['error'] };
  }
  // Cap input ~30K chars to be safe with cheap models
  const input = textBody.slice(0, 30000);
  const userMsg = `URL: ${urlForContext}\n\nExtracted text:\n"""\n${input}\n"""`;
  try {
    const raw = await callLLM({
      system: SYSTEM_PROMPT,
      user: userMsg,
      maxTokens: 700,
      temperature: 0.3,
      jsonMode: true,
    });
    // Robust JSON extraction
    const json = JSON.parse(raw.replace(/^[\s\S]*?({[\s\S]*})[\s\S]*$/, '$1'));
    return {
      summary: String(json.summary || '').slice(0, 2000),
      key_points: Array.isArray(json.key_points) ? json.key_points.slice(0, 8).map(String) : [],
      tags: Array.isArray(json.tags) ? json.tags.slice(0, 6).map((t) => String(t).toLowerCase()) : [],
    };
  } catch (err) {
    return { summary: `Summary failed: ${err.message}`, key_points: [], tags: ['error'] };
  }
}

// ── handler ────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const url = String(body.url || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ ok: false, error: 'Provide a valid http(s) url' });
  }
  const added_by = String(body.added_by || 'anonymous').slice(0, 120);
  const source_type = (body.source_type && String(body.source_type)) || guessSourceType(url);
  const userTags = Array.isArray(body.tags) ? body.tags.map((t) => String(t).toLowerCase()) : null;

  const canonical = canonicalUrl(url);
  const hash = urlHash(canonical);

  // 1. Upsert initial row in 'queued' state so the UI can show progress
  let row;
  try {
    row = await sbUpsertByHash('kb_knowledge', {
      url: canonical,
      url_hash: hash,
      source_type,
      tags: userTags,
      status: 'queued',
      added_by,
    }, 'url_hash');
  } catch (err) {
    return res.status(500).json({ ok: false, stage: 'db', error: err.message });
  }
  const rowId = row && row.id;
  if (!rowId) return res.status(500).json({ ok: false, error: 'failed to create kb_knowledge row' });

  // 2. Fetch page
  let pageHtml = '', finalUrl = canonical, fetchStatus = 0;
  try {
    const fetched = await fetchPage(canonical);
    pageHtml = fetched.html;
    finalUrl = fetched.finalUrl || canonical;
    fetchStatus = fetched.status;
    if (fetchStatus < 200 || fetchStatus >= 400) throw new Error(`HTTP ${fetchStatus}`);
  } catch (err) {
    await sbUpdateById('kb_knowledge', rowId, { status: 'failed', processed_at: new Date().toISOString(), summary: `Fetch failed: ${err.message}` });
    return res.status(502).json({ ok: false, stage: 'fetch', error: err.message, id: rowId });
  }

  const title = extractTitle(pageHtml);
  const author = extractAuthor(pageHtml);
  const rawText = stripHtml(pageHtml);

  // 3. Save fetched state
  try {
    await sbUpdateById('kb_knowledge', rowId, {
      title, author, raw_text: rawText, status: 'fetched'
    });
  } catch (err) {
    // Non-fatal — continue to summarize anyway
    console.warn('[kb/ingest] partial save failed:', err.message);
  }

  // 4. Summarize via LLM
  const out = await summarize(rawText, canonical);

  // 5. Merge tags (user-provided + LLM-suggested)
  const mergedTags = [...new Set([...(userTags || []), ...(out.tags || [])])].slice(0, 8);

  // 6. Final update
  try {
    const final = await sbUpdateById('kb_knowledge', rowId, {
      summary: out.summary,
      key_points: out.key_points,
      tags: mergedTags,
      status: 'summarized',
      processed_at: new Date().toISOString(),
    });
    return res.status(200).json({
      ok: true,
      id: rowId,
      title, author,
      summary: out.summary,
      key_points: out.key_points,
      tags: mergedTags,
      status: 'summarized',
      url: canonical,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, stage: 'final-save', error: err.message, id: rowId });
  }
};

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }
