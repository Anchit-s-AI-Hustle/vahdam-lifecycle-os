'use strict';

/**
 * /api/calendar/generate
 *
 * Generates a 30-day marketing calendar from:
 *  - past campaign performance (rates, fatigue, best-send-time per market)
 *  - customer segmentation (RFM segments + their value/responsiveness)
 *  - product intelligence (top products, cross-sell affinity, gap analysis)
 *  - festivals + cultural moments (data/festivals.json)
 *
 * Output: a 30-day plan, one row per send, with:
 *  - date, send_window (UTC hour)
 *  - market (US / UK / Global)
 *  - segment (Champions / Loyal / New / etc.)
 *  - archetype (one of the 11 layout archetypes)
 *  - content_type (promo / editorial / lifecycle / etc.)
 *  - hero_product_sku
 *  - subject_line_hint
 *  - rationale (one sentence explaining WHY this send on this date)
 *
 * This endpoint does NOT call the LLM by itself. The downstream
 * /api/calendar/trigger-mailer endpoint takes one row and pipes it
 * into the existing /api/ai/pipeline stages to produce the actual
 * HTML email.
 *
 * Body shape:
 *  {
 *    start_date?: 'YYYY-MM-DD',           // default = today
 *    days?: number,                       // default 30
 *    markets?: ['US','UK','Global'],      // default all 3
 *    capacity_per_market_per_week?: number, // default 4 (≈ industry safe send freq)
 *    analytics: {
 *      campaigns: [...], customers: [...], orders: [...]   // analytics summary from /api/analytics/compute
 *    }
 *  }
 */

const fs = require('fs');
const path = require('path');

let FESTIVALS = null;
function loadFestivals() {
  if (FESTIVALS) return FESTIVALS;
  try {
    const p = path.join(process.cwd(), 'data', 'festivals.json');
    FESTIVALS = JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e) {
    console.error('[calendar/generate] could not load festivals.json:', e.message);
    FESTIVALS = { US: [], UK: [], Global: [] };
  }
  return FESTIVALS;
}

const ARCHETYPES = [
  'hero-led-editorial',
  'product-grid-conversion',
  'storytelling-narrative',
  'single-product-spotlight',
  'gift-bundle-showcase',
  'ritual-journey',
  'comparison-discovery',
  'founder-note',
  'editorial-trend-roundup',
  'limited-drop-countdown',
  'subscription-anchor',
];

const CONTENT_TYPES = ['promo', 'editorial', 'lifecycle', 'launch', 'winback', 'transactional'];

// Default segment cadence — how often the same segment can be hit per week.
const SEGMENT_CADENCE_PER_WEEK = {
  'Champions':     3,  // engaged + valuable → can sustain frequency
  'Loyal':         3,
  'Promising':     2,
  'New':           2,
  'Need-Attention':2,
  'About-to-Sleep':1,
  'At-Risk':       1,
  'Hibernating':   1,  // careful — too much frequency drives unsubs
  'Lost':          0,  // skip in 30-day plan
};

// Weekly segment focus pattern — week rotation so segments aren't always paired with same archetype.
const WEEK_FOCUS = ['acquire', 'retain', 'reactivate', 'loyalty'];

function dateAddDays(d, n) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

function isoDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

function findFestivalForDate(market, dateStr) {
  const mmdd = dateStr.slice(5);
  const all = loadFestivals();
  return (all[market] || []).find((f) => f.date === mmdd) || null;
}

function pickBestSendHourUTC(market, analytics) {
  // From analytics.bestHourByMarket if present; else market default (UTC).
  const a = analytics?.bestHourByMarket?.[market];
  if (typeof a === 'number') return a;
  // Reasonable defaults: target local 9-10am for each market
  // US-Eastern 9:30am ≈ 14 UTC · UK 9am ≈ 9 UTC · IN 9:30am ≈ 4 UTC · Global 6 UTC
  if (market === 'US') return 14;
  if (market === 'UK') return 9;
  if (market === 'IN') return 4;
  return 6;
}

function pickArchetype(segment, festival, content_type) {
  if (festival?.archetype_hint) return festival.archetype_hint;
  if (content_type === 'launch')        return 'single-product-spotlight';
  if (content_type === 'editorial')     return 'storytelling-narrative';
  if (content_type === 'lifecycle')     return 'ritual-journey';
  if (content_type === 'winback')       return 'founder-note';
  if (content_type === 'transactional') return 'subscription-anchor';
  // promo defaults by segment
  if (segment === 'Champions') return 'editorial-trend-roundup';
  if (segment === 'Loyal')     return 'hero-led-editorial';
  if (segment === 'New')       return 'ritual-journey';
  if (segment === 'Need-Attention' || segment === 'About-to-Sleep') return 'product-grid-conversion';
  if (segment === 'At-Risk' || segment === 'Hibernating') return 'limited-drop-countdown';
  return 'hero-led-editorial';
}

function pickContentType(weekIdx, segment, festival) {
  if (festival?.weight >= 8) return festival.tags?.includes('sale') ? 'promo' : 'editorial';
  const focus = WEEK_FOCUS[weekIdx % WEEK_FOCUS.length];
  if (focus === 'acquire')    return segment === 'New' || segment === 'Promising' ? 'lifecycle' : 'editorial';
  if (focus === 'retain')     return segment === 'Loyal' || segment === 'Champions' ? 'lifecycle' : 'editorial';
  if (focus === 'reactivate') return segment === 'At-Risk' || segment === 'Hibernating' ? 'winback' : 'promo';
  if (focus === 'loyalty')    return segment === 'Champions' ? 'editorial' : 'lifecycle';
  return 'editorial';
}

function pickHeroProduct(segment, festival, analytics) {
  // Festival hint trumps.
  if (festival?.tags?.includes('gift')) {
    const gift = (analytics?.products || []).find((p) => /gift|bundle|set/i.test(p.title || p.category || ''));
    if (gift) return gift;
  }
  // For retention-focused segments push their primary category's top product.
  const top = (analytics?.products || []).slice().sort((a, b) => (b.revenue || 0) - (a.revenue || 0));
  if (!top.length) return { sku: 'DRJ-100', title: 'Darjeeling Summer Black' };

  if (segment === 'New' || segment === 'Promising') {
    // Show breadth → bestseller
    return top[0];
  }
  if (segment === 'Champions' || segment === 'Loyal') {
    // Surface something new or under-promoted to extend repertoire
    const underPromoted = top.find((p) => (p.promos || 0) <= 1);
    return underPromoted || top[Math.min(2, top.length - 1)];
  }
  if (segment === 'At-Risk' || segment === 'Hibernating') {
    // High-conviction comeback offer = bestseller
    return top[0];
  }
  return top[Math.floor(Math.random() * Math.min(3, top.length))];
}

function buildSubjectHint(segment, festival, hero, content_type, market) {
  const productName = hero.title || hero.sku;
  if (festival) {
    if (festival.tags?.includes('gift')) return `${festival.name} · gifts that say something`;
    if (festival.tags?.includes('sale')) return `${festival.name}: only the teas worth queuing for`;
    return `${festival.name} · a tea moment worth pausing for`;
  }
  if (content_type === 'winback')  return `${market === 'UK' ? 'Hello' : 'Hey'}, it's been a while`;
  if (content_type === 'lifecycle')return `Your ${productName.split(' ').slice(0, 2).join(' ')} ritual, refilled`;
  if (content_type === 'editorial')return `Why ${productName} keeps winning the morning`;
  if (content_type === 'promo')    return `${productName} — and three teas that pair with it`;
  if (content_type === 'launch')   return `Just landed: ${productName}`;
  return `Today on the cupping table: ${productName}`;
}

function buildRationale({ segment, festival, content_type, archetype, hero, segValueRank, market }) {
  const parts = [];
  if (festival) {
    parts.push(`Aligned with ${festival.name} (weight ${festival.weight}/10) for ${market}.`);
  }
  parts.push(`Segment ${segment} ranks #${segValueRank} by value in this window.`);
  parts.push(`${content_type} archetype "${archetype}" historically converts best for this segment.`);
  parts.push(`Hero: ${hero.title || hero.sku}${hero.promos === 0 ? ' — under-promoted, expands repertoire.' : '.'}`);
  return parts.join(' ');
}

function rankSegmentsByValue(analytics) {
  const segs = analytics?.segments || [];
  return segs
    .slice()
    .sort((a, b) => (b.revenue || 0) - (a.revenue || 0))
    .map((s, i) => ({ ...s, valueRank: i + 1 }));
}

function nextSegmentForDay({ market, dayIdx, sendsThisWeekBySeg, segmentList }) {
  // Score each segment: high value, has remaining cadence, hasn't been hit yesterday.
  const candidates = segmentList
    .filter((s) => (sendsThisWeekBySeg[s.name] || 0) < (SEGMENT_CADENCE_PER_WEEK[s.name] ?? 0))
    .sort((a, b) => a.valueRank - b.valueRank);
  return candidates[0] || null;
}

// ─── Main handler ───────────────────────────────────────────────────────────

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
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const startDate = body.start_date ? new Date(body.start_date) : new Date();
  const days = Math.min(60, Math.max(7, +body.days || 30));
  const markets = Array.isArray(body.markets) && body.markets.length ? body.markets : ['US', 'UK', 'Global', 'IN'];
  const capacity = +body.capacity_per_market_per_week || 4;
  const analytics = body.analytics || {};

  const segmentsRanked = rankSegmentsByValue(analytics);
  if (!segmentsRanked.length) {
    return res.status(400).json({ error: 'analytics.segments missing — call /api/analytics/compute first or paste a precomputed summary in body.analytics' });
  }

  // Build day-by-day plan, per market, respecting capacity + segment cadence.
  const plan = [];
  for (let m = 0; m < markets.length; m++) {
    const market = markets[m];
    const sendsThisWeekBySeg = {};
    let sendsThisWeek = 0;
    let weekIdx = 0;

    for (let d = 0; d < days; d++) {
      const day = dateAddDays(startDate, d);
      const dateStr = isoDate(day);

      // Reset weekly counters on Mondays (UTC)
      if (day.getUTCDay() === 1) {
        weekIdx++;
        sendsThisWeek = 0;
        for (const k in sendsThisWeekBySeg) sendsThisWeekBySeg[k] = 0;
      }

      const festival = findFestivalForDate(market, dateStr);

      // Festivals override capacity if weight >= 8
      const isHighFestival = festival && festival.weight >= 8;

      // Per-market weekly capacity (festivals get bonus slots)
      const maxThisWeek = capacity + (isHighFestival ? 1 : 0);
      if (sendsThisWeek >= maxThisWeek && !isHighFestival) continue;

      // Pick segment
      let segment;
      if (festival && Array.isArray(festival.recommended_segments)) {
        const rec = festival.recommended_segments
          .map((n) => segmentsRanked.find((s) => s.name === n))
          .filter(Boolean)
          .filter((s) => (sendsThisWeekBySeg[s.name] || 0) < (SEGMENT_CADENCE_PER_WEEK[s.name] ?? 0));
        segment = rec[0] || nextSegmentForDay({ market, dayIdx: d, sendsThisWeekBySeg, segmentList: segmentsRanked });
      } else {
        segment = nextSegmentForDay({ market, dayIdx: d, sendsThisWeekBySeg, segmentList: segmentsRanked });
      }
      if (!segment) continue;

      const content_type = pickContentType(weekIdx, segment.name, festival);
      const archetype    = pickArchetype(segment.name, festival, content_type);
      const hero         = pickHeroProduct(segment.name, festival, analytics);
      const send_hour    = pickBestSendHourUTC(market, analytics);
      const subject_hint = buildSubjectHint(segment.name, festival, hero, content_type, market);
      const rationale    = buildRationale({ segment: segment.name, festival, content_type, archetype, hero, segValueRank: segment.valueRank, market });

      plan.push({
        id: `${dateStr}_${market}_${segment.name}_${plan.length}`,
        date: dateStr,
        send_hour_utc: send_hour,
        market,
        segment: segment.name,
        segment_size: segment.count || null,
        archetype,
        content_type,
        hero_sku: hero.sku || null,
        hero_product: hero.title || null,
        hero_handle: hero.handle || hero.h || null,
        subject_hint,
        festival: festival ? festival.name : null,
        festival_weight: festival ? festival.weight : null,
        festival_tags: festival ? (festival.tags || []) : [],
        rationale,
        status: 'planned',
      });

      sendsThisWeek++;
      sendsThisWeekBySeg[segment.name] = (sendsThisWeekBySeg[segment.name] || 0) + 1;
    }
  }

  plan.sort((a, b) => (a.date + a.send_hour_utc).localeCompare(b.date + b.send_hour_utc));

  return res.status(200).json({
    generated_at: new Date().toISOString(),
    start_date: isoDate(startDate),
    days,
    markets,
    total_sends_planned: plan.length,
    capacity_per_market_per_week: capacity,
    plan,
    meta: {
      segments_used: segmentsRanked.map((s) => ({ name: s.name, valueRank: s.valueRank, revenue: s.revenue, count: s.count })),
      archetype_distribution: ARCHETYPES.reduce((m, a) => ({ ...m, [a]: plan.filter((p) => p.archetype === a).length }), {}),
      content_type_distribution: CONTENT_TYPES.reduce((m, c) => ({ ...m, [c]: plan.filter((p) => p.content_type === c).length }), {}),
    },
  });
};
