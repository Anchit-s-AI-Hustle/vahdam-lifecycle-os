'use strict';

/**
 * /api/calendar/trigger-mailer
 *
 * Takes ONE calendar row from /api/calendar/generate and runs it through
 * the existing pipeline stages to produce the full HTML mailer:
 *   strategy → variant → images → html → score
 *
 * Body: { entry: <calendar-row>, market_override?: 'US' }
 *
 * Returns: { ok, html, subject, archetype, variants: { A, B, T1, T2 }, runs: [...] }
 *
 * IMPORTANT: This does NOT actually send the email — it produces the artefact.
 * Sending is a separate, intentionally-gated endpoint to be added later.
 */

const llm = require('../_shared/llm.js');
const fs = require('fs');
const path = require('path');

// ─── VAHDAM store URLs (verified per CLAUDE.md) ─────────────────────────────
function regionBase(market) {
  const m = String(market || '').toUpperCase();
  const map = {
    US: 'https://www.vahdamteas.com',
    UK: 'https://uk.vahdamteas.com',
    IN: 'https://www.vahdamindia.com',
    EU: 'https://eu.vahdamteas.com',
    AU: 'https://au.vahdamteas.com',
    CA: 'https://www.vahdamteas.com',
    JP: 'https://www.vahdamteas.com',
    SG: 'https://www.vahdamteas.com',
    ME: 'https://www.vahdamteas.com',
    GLOBAL: 'https://www.vahdamteas.com',
  };
  return map[m] || 'https://www.vahdamteas.com';
}

function slugify(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/['’.]/g, '').replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Best-effort SKU→handle lookup from the built catalog (data/catalog/products_<region>.json).
const _catalogCache = {};
function lookupHandle(market, sku) {
  if (!sku) return null;
  const region = ({ US: 'usa', UK: 'uk' })[String(market || '').toUpperCase()] || 'global';
  if (!(region in _catalogCache)) {
    _catalogCache[region] = null;
    try {
      const p = path.join(__dirname, '..', '..', 'data', 'catalog', `products_${region}.json`);
      if (fs.existsSync(p)) _catalogCache[region] = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch { /* ignore */ }
  }
  const cat = _catalogCache[region];
  if (!Array.isArray(cat)) return null;
  const hit = cat.find((p) => (p.sku || p.variant_sku) === sku || p.s === sku);
  return hit ? (hit.h || hit.handle || null) : null;
}

// Map a content type / festival to a sensible collection slug.
function collectionForEntry(entry) {
  const tags = (entry.festival_tags || []).map((t) => String(t).toLowerCase());
  if (tags.includes('gift')) return 'gift-sets';
  switch (String(entry.content_type || '').toLowerCase()) {
    case 'launch':   return 'new-arrivals';
    case 'editorial':return 'bestsellers';
    case 'winback':  return 'bestsellers';
    case 'lifecycle':return 'tea';
    case 'promo':    return 'bestsellers';
    default:         return 'bestsellers';
  }
}

// Resolve the single CTA destination for a calendar entry → a real VAHDAM URL.
function ctaUrlForEntry(entry, market) {
  const base = regionBase(market);
  // 1. Precise product page if we know the handle (or can resolve it from the SKU).
  const handle = entry.hero_handle || lookupHandle(market, entry.hero_sku);
  if (handle) return `${base}/products/${handle}`;
  // 2. Otherwise the relevant collection page.
  const slug = collectionForEntry(entry);
  if (slug) return `${base}/collections/${slug}`;
  // 3. Last resort: on-site search for the hero product so the link still lands somewhere real.
  if (entry.hero_product) return `${base}/search?q=${encodeURIComponent(entry.hero_product)}`;
  return base;
}

function buildBriefFromEntry(entry) {
  const parts = [
    `Campaign date: ${entry.date}`,
    `Market: ${entry.market}`,
    `Audience segment: ${entry.segment}${entry.segment_size ? ` (~${entry.segment_size} customers)` : ''}`,
    `Content type: ${entry.content_type}`,
    `Layout archetype: ${entry.archetype}`,
    `Hero product: ${entry.hero_product || entry.hero_sku}`,
    entry.festival ? `Cultural moment: ${entry.festival} (weight ${entry.festival_weight}/10)` : null,
    `Subject-line direction: ${entry.subject_hint}`,
    '',
    'Strategist guidance:',
    `- Stay strictly on VAHDAM brand voice: warm, sensory, story-driven. No "transform", no "wellness journey", no all-caps urgency.`,
    `- Match the archetype layout convention (see project brand spec).`,
    `- One CTA, one hero product, optional 2-3 supporting products.`,
    `- For ${entry.segment}: ${segmentVoiceGuide(entry.segment, entry.content_type)}`,
  ].filter(Boolean).join('\n');

  return parts;
}

function segmentVoiceGuide(segment, contentType) {
  const map = {
    Champions:        'reward, don\'t discount. Surface something new or limited.',
    Loyal:            'depth, story, origin. Editorial tone over promo.',
    Promising:        'continuity — show the next step in the ritual.',
    New:              'guide the second sip. Teach brewing, suggest pairings.',
    'Need-Attention': 'soft re-engagement, no aggressive discount yet.',
    'About-to-Sleep': 'gentle reminder + curated 3-pick. Question-based subject.',
    'At-Risk':        'one personal note, one fair offer, single CTA.',
    Hibernating:      'short founder\'s note, no discount, link to one curated read.',
    Lost:             'do not send.',
  };
  return map[segment] || 'professional, warm, on-brand.';
}

async function safeCall(fn, label) {
  try {
    return { ok: true, data: await fn(), label };
  } catch (e) {
    return { ok: false, error: e.message || String(e), label };
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'POST only' });

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const entry = body.entry;
  if (!entry || !entry.market || !entry.segment) {
    return res.status(400).json({ error: 'body.entry must include at minimum { market, segment, archetype, hero_sku }' });
  }

  const market = body.market_override || entry.market;

  const brief = buildBriefFromEntry(entry);
  const runs  = [];

  // ── Stage 1: Strategy (subject + headline + bullets + CTA) ──
  const strategy = await safeCall(async () => {
    const out = await llm({
      systemPrompt:
        'You are VAHDAM\'s lifecycle copywriter. Produce a strict JSON object with keys: ' +
        'subject_line (string, ≤ 60 chars), preview_text (string, ≤ 90 chars), ' +
        'hero_headline (string, ≤ 8 words), hero_subline (string, ≤ 18 words), ' +
        'body_blocks (array of {heading, body}), cta_text (string, ≤ 4 words). ' +
        'Use VAHDAM brand voice (warm, sensory, story-driven). No banned phrases.',
      userMessage: brief,
      responseFormat: { type: 'json_object' },
      maxTokens: 1200,
      temperature: 0.75,
      stage: 'strategy',
    });
    return JSON.parse(out.text);
  }, 'strategy');
  runs.push({ stage: 'strategy', ok: strategy.ok, error: strategy.ok ? null : strategy.error });

  if (!strategy.ok) {
    return res.status(503).json({ ok: false, message: 'Strategy stage failed', runs });
  }

  const S = strategy.data;
  const ctaUrl = ctaUrlForEntry(entry, market);

  // ── Stage 2: 4 variants — A & B = image-driven, T1 & T2 = text-only ──
  // The downstream image pipeline (api/ai/image.js) handles image generation
  // for variants A + B. For T1 + T2 we hand back pure-HTML email shells.
  const variants = {
    A: {
      kind: 'image',
      label: 'Image · Hero',
      hero_image_brief: `${entry.archetype} layout. Subject "${S.subject_line}". Hero ${entry.hero_product || entry.hero_sku}. Mood: ${entry.content_type === 'promo' ? 'high-clarity product photography' : 'cinematic, warm, atmospheric'}.`,
    },
    B: {
      kind: 'image',
      label: 'Image · Lifestyle',
      hero_image_brief: `Lifestyle ${entry.archetype} layout. Subject "${S.subject_line}". Hero ${entry.hero_product || entry.hero_sku}. Mood: wide editorial scene, soft natural light, ritual context, no on-image text.`,
    },
    T1: {
      kind: 'text',
      label: 'Text · Editorial',
      style: 'editorial',
      preview_text: S.preview_text,
      cta_url: ctaUrl,
      html: renderTextVariant({
        style: 'editorial',
        subject: S.subject_line,
        hero_headline: S.hero_headline,
        hero_subline: S.hero_subline,
        body_blocks: S.body_blocks || [],
        cta_text: S.cta_text || 'Shop the edit',
        cta_url: ctaUrl,
        market,
      }),
    },
    T2: {
      kind: 'text',
      label: 'Text · Founder note',
      style: 'founder',
      preview_text: S.preview_text,
      cta_url: ctaUrl,
      html: renderTextVariant({
        style: 'founder',
        subject: S.subject_line,
        hero_headline: S.hero_headline,
        hero_subline: S.hero_subline,
        body_blocks: S.body_blocks || [],
        cta_text: S.cta_text || 'Shop the edit',
        cta_url: ctaUrl,
        market,
      }),
    },
  };

  return res.status(200).json({
    ok: true,
    entry,
    strategy: S,
    cta_url: ctaUrl,
    variants,
    runs,
  });
};

// ─── Text-variant renderer (no images, brand-compliant) ─────────────────────
function renderTextVariant({ style, subject, hero_headline, hero_subline, body_blocks, cta_text, cta_url, market }) {
  // CTA points at the resolved product/collection page; the brand domain still
  // falls back per-market if no specific destination was provided.
  const baseUrl = cta_url || regionBase(market);

  const palette = {
    green: '#004A2B', gold: '#AB8743', ink: '#171717', cream: '#FBF5EA',
  };

  const blocks = (body_blocks || []).map((b) => `
    <tr><td style="padding:18px 32px 0;">
      <p style="font-family:'Lao MN','Cormorant Garamond',Georgia,serif;font-size:20px;color:${palette.green};margin:0 0 6px;letter-spacing:0.2px;">${esc(b.heading || '')}</p>
      <p style="font-family:'Proxima Nova','Helvetica Neue',Arial,sans-serif;font-size:15px;line-height:1.65;color:${palette.ink};margin:0;">${esc(b.body || '')}</p>
    </td></tr>`).join('');

  if (style === 'founder') {
    return `<!doctype html>
<html><body style="margin:0;padding:0;background:${palette.cream};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${palette.cream};">
  <tr><td align="center" style="padding:36px 16px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #ece4d2;">
      <tr><td style="padding:36px 32px 0;text-align:center;">
        <div style="font-family:'Lao MN','Cormorant Garamond',Georgia,serif;font-size:13px;letter-spacing:3px;color:${palette.gold};text-transform:uppercase;">VAHDAM</div>
      </td></tr>
      <tr><td style="padding:24px 32px 0;">
        <p style="font-family:'Lao MN','Cormorant Garamond',Georgia,serif;font-size:30px;line-height:1.25;color:${palette.green};margin:0 0 10px;font-weight:500;">${esc(hero_headline)}</p>
        <p style="font-family:'Proxima Nova','Helvetica Neue',Arial,sans-serif;font-size:15px;line-height:1.6;color:${palette.ink};margin:0 0 8px;">${esc(hero_subline)}</p>
        <p style="font-family:'Proxima Nova',sans-serif;font-size:13px;color:#7a6e5a;margin:0;">— a note from the cupping table</p>
      </td></tr>
      ${blocks}
      <tr><td style="padding:28px 32px 36px;text-align:center;">
        <a href="${baseUrl}" style="display:inline-block;background:${palette.green};color:${palette.cream};text-decoration:none;padding:14px 30px;font-family:'Proxima Nova',sans-serif;font-size:14px;letter-spacing:1.4px;text-transform:uppercase;">${esc(cta_text)}</a>
      </td></tr>
      <tr><td style="padding:14px 32px 30px;border-top:1px solid #ece4d2;text-align:center;">
        <p style="font-family:'Proxima Nova',sans-serif;font-size:11px;color:#7a6e5a;margin:0;">Brewed at origin. Shipped within days, not seasons.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
  }

  // editorial style (default)
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:${palette.cream};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${palette.cream};">
  <tr><td align="center" style="padding:36px 16px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #ece4d2;">
      <tr><td style="padding:24px 32px 0;text-align:center;">
        <div style="font-family:'Lao MN',Georgia,serif;font-size:13px;letter-spacing:3px;color:${palette.gold};text-transform:uppercase;">VAHDAM · ${esc(market)}</div>
      </td></tr>
      <tr><td style="padding:24px 32px 0;border-bottom:1px solid #ece4d2;">
        <h1 style="font-family:'Lao MN','Cormorant Garamond',Georgia,serif;font-size:34px;line-height:1.18;color:${palette.green};margin:0 0 8px;font-weight:500;letter-spacing:-0.3px;">${esc(hero_headline)}</h1>
        <p style="font-family:'Proxima Nova','Helvetica Neue',Arial,sans-serif;font-size:16px;line-height:1.55;color:${palette.ink};margin:0 0 24px;">${esc(hero_subline)}</p>
      </td></tr>
      ${blocks}
      <tr><td style="padding:28px 32px 36px;text-align:center;border-top:1px solid #ece4d2;">
        <a href="${baseUrl}" style="display:inline-block;background:${palette.green};color:${palette.cream};text-decoration:none;padding:14px 30px;font-family:'Proxima Nova',sans-serif;font-size:14px;letter-spacing:1.4px;text-transform:uppercase;">${esc(cta_text)}</a>
        <p style="font-family:'Proxima Nova',sans-serif;font-size:11px;color:#7a6e5a;margin:18px 0 0;">No flash sales. No fillers. Just tea, picked at the source.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
}
