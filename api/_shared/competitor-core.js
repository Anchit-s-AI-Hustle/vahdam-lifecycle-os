'use strict';

/**
 * competitor-core.js — self-contained Competitor Benchmarking engine.
 *
 * Everything the feature needs runs from THIS repo (no dependency on the
 * separate competitor-intelligence-hub deployment):
 *   - Google Sheets read/write (service account)   — the database
 *   - Gmail IMAP fetch + mailparser                 — ingestion
 *   - text extraction (brand / promo / body)        — structuring
 *   - HCTI full-length screenshot (hosted URL)      — image of each mail
 *   - raw HTML stored per mail (column K)            — exact, re-renderable
 *
 * Lives under api/_shared/ so Vercel does NOT count it as a Serverless
 * Function (underscore-prefixed paths are excluded). The single public
 * function is api/competitor.js, which dispatches to the helpers here.
 *
 * Storage model per mail (Google Sheet columns A–K):
 *   A Brand · B Sender · C Received · D Subject · E Preview · F Body text
 *   G Promo codes · H Screenshot URL · I Inline image links · J Attachment
 *   links · K Raw HTML (capped 49k)
 */

const { google } = require('googleapis');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

// ── Sentinels ──────────────────────────────────────────────────────────────
const NONE = 'None';
const NO_SCREENSHOT = 'No Screenshot';
const RAW_HTML_MAX = 49000;

const SHEET_COLUMNS = [
  'Brand', 'Sender Email', 'Received At', 'Subject', 'Preview', 'Body Text',
  'Promo Codes', 'Screenshot URL', 'Inline Image URLs', 'Attachment URLs', 'Raw HTML',
];

// ── Google auth / clients ────────────────────────────────────────────────────
let _sheets = null;
function sheetsClient() {
  if (_sheets) return _sheets;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!email || !key) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL/PRIVATE_KEY');
  key = key.replace(/\\n/g, '\n').replace(/^["']|["']$/g, '');
  const auth = new google.auth.JWT({
    email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  _sheets = google.sheets({ version: 'v4', auth });
  return _sheets;
}
function sheetId() {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error('Missing GOOGLE_SHEET_ID');
  return id;
}
function sheetTab() { return process.env.GOOGLE_SHEET_TAB || 'Emails'; }

// ── Row <-> record mapping ────────────────────────────────────────────────────
function rowToRecord(row, rowNumber) {
  const get = (i) => (row[i] == null ? '' : String(row[i]));
  return {
    id: String(rowNumber),
    brand: get(0) || 'Unknown',
    senderEmail: get(1),
    receivedAt: get(2),
    subject: get(3),
    preview: get(4),
    bodyText: get(5),
    promoCodes: get(6) || NONE,
    screenshotUrl: get(7) || NONE,
    inlineImageUrls: get(8) || NONE,
    attachmentUrls: get(9) || NONE,
  };
}

// ── Sheet operations ──────────────────────────────────────────────────────────
async function ensureSheetTab() {
  const sheets = sheetsClient();
  const tab = sheetTab();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId(), fields: 'sheets.properties.title' });
  const exists = (meta.data.sheets || []).some((s) => s.properties && s.properties.title === tab);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId(),
      requestBody: { requests: [{ addSheet: { properties: { title: tab } } }] },
    });
  }
}

async function ensureHeaderRow() {
  const sheets = sheetsClient();
  const tab = sheetTab();
  await ensureSheetTab();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId(), range: `${tab}!A1:K1` });
  if (!(res.data.values && res.data.values[0] && res.data.values[0][0])) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId(), range: `${tab}!A1`, valueInputOption: 'RAW',
      requestBody: { values: [SHEET_COLUMNS] },
    });
  }
}

async function appendEmailRow(e) {
  const sheets = sheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId(), range: `${sheetTab()}!A:K`,
    valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[
        e.brand, e.senderEmail, e.receivedAt, e.subject, e.preview, e.bodyText,
        e.promoCodes, e.screenshotUrl, e.inlineImageUrls, e.attachmentUrls,
        (e.rawHtml || '').slice(0, RAW_HTML_MAX),
      ]],
    },
  });
}

/**
 * Sort the Emails tab in DESCENDING order of column C (Received At).
 * Called after each sync batch (NOT per-row) so newest mail always sits
 * at the top of the sheet — what the user opens to see latest first.
 *
 * Best-effort: any failure (no rows, transient API error) just logs and
 * returns — never breaks the sync. The Sheets API needs the numeric
 * sheetId (not the spreadsheet ID), so we read the metadata once.
 */
async function sortEmailsByReceivedDesc() {
  const sheets = sheetsClient();
  const tab = sheetTab();
  try {
    // 1. Get the numeric sheet ID for our tab + the row count.
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: sheetId(),
      fields: 'sheets.properties(sheetId,title,gridProperties)',
    });
    const sheet = (meta.data.sheets || []).find((s) => s.properties && s.properties.title === tab);
    if (!sheet) return;
    const gridSheetId = sheet.properties.sheetId;
    const rowCount = (sheet.properties.gridProperties && sheet.properties.gridProperties.rowCount) || 0;
    if (rowCount < 3) return;       // header + 0 or 1 rows — nothing to sort

    // 2. SortRange: rows 1..end (0-indexed header excluded), all 11 columns,
    //    sortSpec on column C (index 2) descending.
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId(),
      requestBody: {
        requests: [{
          sortRange: {
            range: {
              sheetId: gridSheetId,
              startRowIndex: 1,            // skip header row
              endRowIndex: rowCount,
              startColumnIndex: 0,
              endColumnIndex: 11,           // A..K inclusive
            },
            sortSpecs: [{ dimensionIndex: 2, sortOrder: 'DESCENDING' }],
          },
        }],
      },
    });
  } catch (err) {
    // Non-fatal — sync still succeeds even if sort fails.
    console.warn('[sortEmailsByReceivedDesc] skipped:', (err && err.message) || err);
  }
}

async function getAllEmails() {
  const sheets = sheetsClient();
  let res;
  try {
    res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId(), range: `${sheetTab()}!A2:J` });
  } catch (err) {
    if (/Unable to parse range/i.test((err && err.message) || '')) return [];
    throw err;
  }
  const rows = res.data.values || [];
  return rows
    .map((row, i) => rowToRecord(row, i + 2))
    .filter((r) => r.senderEmail || r.subject || r.brand !== 'Unknown')
    .reverse();
}

async function getEmailHtml(rowNumber) {
  const n = Number(rowNumber);
  if (!Number.isInteger(n) || n < 2) return '';
  const sheets = sheetsClient();
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId(), range: `${sheetTab()}!K${n}` });
    return (res.data.values && res.data.values[0] && res.data.values[0][0]) || '';
  } catch (e) { return ''; }
}

async function getExistingKeys() {
  const emails = await getAllEmails();
  return new Set(emails.map((e) => `${e.senderEmail}|${e.subject}|${e.receivedAt}`));
}

// ── Text extraction ───────────────────────────────────────────────────────────
function cleanBrandName(displayName, fromAddress) {
  let name = (displayName || '').trim().replace(/<[^>]*>/g, '').replace(/^["']+|["']+$/g, '').trim();
  name = name
    .replace(/\b(newsletter|team|email|mail|info|no[-\s]?reply|noreply|marketing|offers?|deals?|promotions?)\b/gi, '')
    .replace(/[|•·–—-]+\s*$/g, '').replace(/\s{2,}/g, ' ').trim();
  if (name) return name;
  const domain = ((fromAddress || '').split('@')[1] || '').toLowerCase();
  const core = domain
    .replace(/\.(com|net|org|io|co|shop|store|email|mail)(\.[a-z]{2})?$/i, '')
    .split('.').filter((p) => !['www', 'email', 'mail', 'e', 'news', 'send', 'mkt', 'go', 'info'].includes(p)).pop();
  if (!core) return 'Unknown';
  return core.charAt(0).toUpperCase() + core.slice(1);
}

function htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|tr|table|h[1-6]|li|ul|ol|section|header|footer)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&[a-z]+;/gi, ' ')
    .split('\n').map((l) => l.replace(/[ \t]{2,}/g, ' ').trim())
    .filter((l, i, arr) => l.length > 0 || (i > 0 && arr[i - 1].length > 0))
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function buildPreview(bodyText, max) {
  max = max || 200;
  const oneLine = (bodyText || '').replace(/\s+/g, ' ').trim();
  return oneLine.length <= max ? oneLine : oneLine.slice(0, max).replace(/\s+\S*$/, '') + '…';
}

const CONTEXT_RE = /(?:code|coupon|promo(?:tion)?|voucher|use|enter|apply|with)\s*(?:code)?\s*[:\-]?\s*["“']?\b([A-Z0-9][A-Z0-9._-]{2,18})\b/gi;
const SHAPE_RE = /\b([A-Z]{2,}[0-9]{1,4}|[A-Z]{3,}[0-9]+[A-Z0-9]*)\b/g;
const STOPWORDS = new Set(['SHOP', 'SALE', 'FREE', 'NEW', 'NOW', 'SAVE', 'OFF', 'GET', 'BUY', 'ONLY', 'TODAY', 'HERE', 'VIEW', 'OPEN', 'CLICK', 'SHIPPING', 'GIFT', 'THE', 'AND', 'FOR', 'YOU', 'YOUR', 'ALL', 'USD', 'EUR', 'GBP', 'INR', 'HTML', 'HTTPS', 'HTTP', 'WWW', 'COM', 'PNG', 'JPG', 'JPEG', 'GIF']);

function extractPromoCodes(text) {
  if (!text) return [];
  const found = new Set();
  for (const m of Array.from(text.matchAll(CONTEXT_RE))) {
    const code = m[1] && m[1].toUpperCase();
    if (!code || STOPWORDS.has(code)) continue;
    if (/[0-9]/.test(code) || code.length >= 5) found.add(code);
  }
  for (const m of Array.from(text.matchAll(SHAPE_RE))) {
    const code = m[1] && m[1].toUpperCase();
    if (code && !STOPWORDS.has(code)) found.add(code);
  }
  return Array.from(found).slice(0, 8);
}
const joinOrNone = (arr) => (arr && arr.length ? arr.join(', ') : NONE);

// ── Visual rendering — FREE full-page screenshot, no heavy deps ──────────────
// Headless Chromium can't be bundled into this serverless function without
// breaking its cold-start (it exceeds the size/init budget). Instead we render
// for free WITHOUT bundling a browser:
//   1. The full raw HTML of every mail is stored in the sheet (col K) and is
//      served as a standalone page at /api/competitor?action=raw&key=<b64>.
//   2. We store (col H) a screenshot URL = a free image API (Microlink) pointed
//      at that page, which renders a full-page PNG on demand — no API key, no
//      watermark. The dashboard <img>/download just uses that URL.
// The HTML is the archived source of truth; the screenshot is reproducible.

function wrapHtml(rawHtml) {
  if (/<html[\s>]/i.test(rawHtml)) return rawHtml;
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#fff;font-family:Arial,Helvetica,sans-serif;}.__wrap{width:640px;margin:0 auto;}</style></head><body><div class="__wrap">${rawHtml}</div></body></html>`;
}

// Base URL of this deployment (for the public raw-HTML endpoint).
function appBaseUrl() {
  return (process.env.SCREENSHOT_BASE_URL || 'https://vahdam-lifecycle-os.vercel.app').replace(/\/$/, '');
}
// Stable key for an email → used to look up its HTML at the raw endpoint.
function emailKey(address, subject, receivedAt) {
  return Buffer.from(`${address}|${subject}|${receivedAt}`).toString('base64');
}
// Free full-page screenshot URL (Microlink) of the raw-HTML page for this mail.
function screenshotUrlForKey(key) {
  const rawUrl = `${appBaseUrl()}/api/competitor?action=raw&key=${encodeURIComponent(key)}`;
  return `https://api.microlink.io/?url=${encodeURIComponent(rawUrl)}&screenshot=true&fullPage=true&meta=false&embed=screenshot.url`;
}

/** Return a standalone HTML page for one mail (by row id or base64 key). */
async function getRawHtml(opts) {
  opts = opts || {};
  let html = '';
  if (opts.id) {
    html = await getEmailHtml(Number(opts.id));
  } else if (opts.key) {
    let decoded = '';
    try { decoded = Buffer.from(String(opts.key), 'base64').toString('utf8'); } catch (e) { decoded = ''; }
    if (decoded) {
      const emails = await getAllEmails();
      const m = emails.find((e) => `${e.senderEmail}|${e.subject}|${e.receivedAt}` === decoded);
      if (m) html = await getEmailHtml(Number(m.id));
    }
  }
  return html ? wrapHtml(html) : '';
}

// ── IMAP ingestion ────────────────────────────────────────────────────────────
function imapConfig() {
  const user = process.env.GMAIL_IMAP_USER;
  const pass = process.env.GMAIL_IMAP_PASSWORD;
  if (!user || !pass) throw new Error('Missing GMAIL_IMAP_USER/PASSWORD');
  return {
    host: process.env.GMAIL_IMAP_HOST || 'imap.gmail.com',
    port: Number(process.env.GMAIL_IMAP_PORT || 993),
    secure: true, auth: { user, pass }, logger: false,
  };
}

async function fetchUnreadEmails(limit) {
  limit = limit || 25;
  const client = new ImapFlow(imapConfig());
  const out = [];
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  try {
    const uids = await client.search({ seen: false }, { uid: true });
    if (!uids || !uids.length) return out;
    for (const uid of uids.slice(0, limit)) {
      try {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!msg || !msg.source) continue;
        out.push(await simpleParser(msg.source));
        await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
      } catch (err) { console.error(`[competitor] uid ${uid} failed`, err.message); }
    }
  } finally {
    lock.release();
    await client.logout().catch(() => client.close());
  }
  return out;
}

// ── Sync orchestration ────────────────────────────────────────────────────────
async function runSync(limit) {
  const started = Date.now();
  const errors = [];
  let appended = 0;
  await ensureHeaderRow();
  const existing = await getExistingKeys();
  const parsedList = await fetchUnreadEmails(limit || 25);

  for (const parsed of parsedList) {
    try {
      const from = (parsed.from && parsed.from.value && parsed.from.value[0]) || {};
      const address = (from.address || '').toLowerCase();
      const brand = cleanBrandName(from.name || '', address);
      const subject = parsed.subject || '(no subject)';
      const receivedAt = (parsed.date || new Date()).toISOString();
      const fullHtml = parsed.html || parsed.textAsHtml || '';
      const bodyText = (parsed.text && parsed.text.trim()) || htmlToText(fullHtml);
      const preview = buildPreview(bodyText);
      const promoCodes = joinOrNone(extractPromoCodes(`${subject}\n${bodyText}`));

      const key = `${address}|${subject}|${receivedAt}`;
      if (existing.has(key)) continue;

      // FREE full-page screenshot URL (Microlink renders the stored HTML page
      // on demand). No browser bundled here. Raw HTML (col K) is the archive.
      const screenshotUrl = fullHtml ? screenshotUrlForKey(emailKey(address, subject, receivedAt)) : NONE;

      const inlineCount = (parsed.attachments || []).filter((a) => a.contentDisposition === 'inline' || a.cid || a.related).length;
      const attachCount = (parsed.attachments || []).length - inlineCount;

      await appendEmailRow({
        brand, senderEmail: address, receivedAt, subject, preview, bodyText, promoCodes,
        screenshotUrl,
        inlineImageUrls: inlineCount ? `${inlineCount} inline (in HTML)` : NONE,
        attachmentUrls: attachCount ? `${attachCount} attachment(s)` : NONE,
        rawHtml: fullHtml,
      });
      existing.add(key);
      appended++;
    } catch (err) {
      errors.push((err && err.message) || 'unknown');
    }
  }
  // Newest-first sort: only when we actually appended (cheap call, but no point
  // re-sorting on a no-op poll).
  if (appended > 0) { await sortEmailsByReceivedDesc(); }
  return { ok: true, processed: parsedList.length, appended, errors, durationMs: Date.now() - started };
}

// ═══════════════════════════════════════════════════════════════════════════
//  PHASE 2 — Competitor BRAND database + discovery engine
//  Stored in a second tab ("Competitors") of the same spreadsheet.
// ═══════════════════════════════════════════════════════════════════════════

const callLLM = require('./llm');

function brandsTab() { return process.env.GOOGLE_BRANDS_TAB || 'Competitors'; }

// Column order for the Competitors tab (A–R).
const BRAND_COLUMNS = [
  'Brand Name', 'Website URL', 'Domain', 'Category', 'Country', 'Positioning',
  'Newsletter Signup URL', 'Popup Signup', 'SMS Signup', 'Blog URL',
  'Bestseller URL', 'New Arrivals URL', 'Subscription Status', 'Date Subscribed',
  'Confirmation Required', 'Confirmation Completed', 'Source', 'Added At',
];

// Our OWN brand domains — never treated as competitors (excluded from seed,
// discovery, and display).
const OWN_DOMAINS = ['vahdamteas.com', 'vahdamindia.com', 'vahdam.com'];
function isOwnBrand(domainOrUrl) {
  const d = normalizeDomain(domainOrUrl);
  return OWN_DOMAINS.some((o) => d === o || d.endsWith('.' + o));
}

// Priority seed brands (Prompt 1) — VAHDAM is the reference, NOT a competitor,
// so it is intentionally excluded.
const SEED_BRANDS = [
  { brandName: 'Pique', websiteUrl: 'https://www.piquelife.com', category: 'Tea', country: 'United States', positioning: 'Premium' },
  { brandName: 'Four Sigmatic', websiteUrl: 'https://foursigmatic.com', category: 'Functional Coffee', country: 'United States', positioning: 'Premium' },
  { brandName: 'AG1', websiteUrl: 'https://drinkag1.com', category: 'Supplements', country: 'United States', positioning: 'Premium' },
  { brandName: 'Everyday Dose', websiteUrl: 'https://everydaydose.com', category: 'Functional Coffee', country: 'United States', positioning: 'Premium' },
  { brandName: 'MUD\\WTR', websiteUrl: 'https://mudwtr.com', category: 'Functional Coffee', country: 'United States', positioning: 'Premium' },
  { brandName: 'Beam', websiteUrl: 'https://beamorganics.com', category: 'Wellness Beverages', country: 'United States', positioning: 'Premium' },
  { brandName: 'RYZE', websiteUrl: 'https://ryzesuperfoods.com', category: 'Functional Coffee', country: 'United States', positioning: 'Premium' },
];

function normalizeDomain(url) {
  if (!url) return '';
  let u = String(url).trim().toLowerCase();
  u = u.replace(/^https?:\/\//, '').replace(/^www\./, '');
  return u.split('/')[0].split('?')[0].trim();
}

async function ensureBrandsTab() {
  const sheets = sheetsClient();
  const tab = brandsTab();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId(), fields: 'sheets.properties.title' });
  const exists = (meta.data.sheets || []).some((s) => s.properties && s.properties.title === tab);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId(),
      requestBody: { requests: [{ addSheet: { properties: { title: tab } } }] },
    });
  }
  const head = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId(), range: `${tab}!A1:R1` });
  if (!(head.data.values && head.data.values[0] && head.data.values[0][0])) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId(), range: `${tab}!A1`, valueInputOption: 'RAW',
      requestBody: { values: [BRAND_COLUMNS] },
    });
  }
}

function brandRowToRecord(row, n) {
  const g = (i) => (row[i] == null ? '' : String(row[i]));
  return {
    id: String(n),
    brandName: g(0), websiteUrl: g(1), domain: g(2), category: g(3), country: g(4),
    positioning: g(5), newsletterSignupUrl: g(6), popupSignup: g(7), smsSignup: g(8),
    blogUrl: g(9), bestsellerUrl: g(10), newArrivalsUrl: g(11),
    subscriptionStatus: g(12) || 'Not subscribed', dateSubscribed: g(13),
    confirmationRequired: g(14), confirmationCompleted: g(15), source: g(16), addedAt: g(17),
  };
}
function brandToRow(b, nowIso) {
  return [
    b.brandName || '', b.websiteUrl || '', normalizeDomain(b.websiteUrl), b.category || '',
    b.country || '', b.positioning || '', b.newsletterSignupUrl || '',
    b.popupSignup === true ? 'Yes' : (b.popupSignup === false ? 'No' : ''),
    b.smsSignup === true ? 'Yes' : (b.smsSignup === false ? 'No' : ''),
    b.blogUrl || '', b.bestsellerUrl || '', b.newArrivalsUrl || '',
    b.subscriptionStatus || 'Not subscribed', b.dateSubscribed || '',
    b.confirmationRequired || '', b.confirmationCompleted || '',
    b.source || 'discovery', nowIso || '',
  ];
}

async function getBrands() {
  await ensureBrandsTab();
  const sheets = sheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId(), range: `${brandsTab()}!A2:R` });
  const rows = res.data.values || [];
  return rows
    .map((r, i) => brandRowToRecord(r, i + 2))
    .filter((b) => (b.brandName || b.domain) && !isOwnBrand(b.domain || b.websiteUrl));
}

/** Append brands, de-duplicated by domain against what's already stored. */
async function appendBrands(list, nowIso) {
  if (!list || !list.length) return { added: 0, skipped: 0, total: (await getBrands()).length };
  const existing = await getBrands();
  const seen = new Set(existing.map((b) => b.domain).filter(Boolean));
  const fresh = [];
  for (const b of list) {
    const d = normalizeDomain(b.websiteUrl);
    if (!d || seen.has(d) || isOwnBrand(d)) continue; // skip dupes + our own brand
    seen.add(d);
    fresh.push(brandToRow(b, nowIso));
  }
  if (fresh.length) {
    await sheetsClient().spreadsheets.values.append({
      spreadsheetId: sheetId(), range: `${brandsTab()}!A:R`,
      valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
      requestBody: { values: fresh },
    });
  }
  return { added: fresh.length, skipped: list.length - fresh.length, total: existing.length + fresh.length };
}

/** Insert the priority seed brands (idempotent via domain dedupe). */
async function seedBrands(nowIso) {
  return appendBrands(SEED_BRANDS.map((b) => ({ ...b, source: 'seed' })), nowIso);
}

const DISCOVERY_CATEGORIES = ['Tea', 'Coffee', 'Functional Coffee', 'Botanicals', 'Adaptogens', 'Wellness Beverages', 'Supplements', 'Superfoods'];
const DISCOVERY_GEOS = ['United States', 'United Kingdom', 'Canada', 'Australia', 'Europe', 'Global DTC Brands'];

/**
 * Ask the LLM waterfall for a batch of real competitor brands, excluding
 * domains already in the DB. Returns parsed brand objects (not yet stored).
 */
async function discoverBrands(opts) {
  opts = opts || {};
  const categories = (opts.categories && opts.categories.length ? opts.categories : DISCOVERY_CATEGORIES);
  const geographies = (opts.geographies && opts.geographies.length ? opts.geographies : DISCOVERY_GEOS);
  const limit = Math.min(Math.max(Number(opts.limit) || 30, 5), 50);

  const existing = await getBrands();
  const excludeDomains = [...new Set([...existing.map((b) => b.domain).filter(Boolean), ...OWN_DOMAINS])];

  const system = 'You are a competitor-intelligence research engine specializing in premium DTC wellness brands (tea, coffee, functional beverages, adaptogens, supplements, superfoods). You only output strict JSON. Use REAL, currently-operating brands with their REAL primary website domains. Never invent brands or fake domains.';
  const user = [
    `Find up to ${limit} high-quality competitor brands similar to VAHDAM and to: Pique, Four Sigmatic, AG1, Everyday Dose, MUD\\WTR, Beam, RYZE. Do NOT include VAHDAM itself (we are VAHDAM — it is not a competitor).`,
    `Categories to cover: ${categories.join(', ')}.`,
    `Geographies: ${geographies.join(', ')}.`,
    excludeDomains.length ? `EXCLUDE these domains already in our database (do not return them): ${excludeDomains.slice(0, 200).join(', ')}.` : '',
    'Return STRICT JSON of the shape: {"brands":[{"brandName":"","websiteUrl":"https://...","category":"","country":"","positioning":"Premium|Mass|Luxury","newsletterSignupUrl":"","popupSignup":true,"smsSignup":false,"blogUrl":"","bestsellerUrl":"","newArrivalsUrl":""}]}',
    'Prefer well-known, real DTC brands. websiteUrl must be the real homepage. If unsure of a sub-URL, leave it as an empty string rather than guessing.',
  ].filter(Boolean).join('\n');

  const res = await callLLM({
    systemPrompt: system,
    userMessage: user,
    responseFormat: { type: 'json_object' },
    maxTokens: 3500,
    temperature: 0.5,
    timeoutMs: 45000,
    stage: 'competitor_discovery',
  });

  let parsed;
  try {
    const txt = (res.text || '').trim().replace(/^```json\s*|\s*```$/g, '');
    parsed = JSON.parse(txt);
  } catch (e) {
    throw new Error('Discovery LLM returned unparseable JSON: ' + (e.message || ''));
  }
  const brands = Array.isArray(parsed) ? parsed : (parsed.brands || []);
  return { brands, provider: res.provider, model: res.model };
}

module.exports = {
  getAllEmails, getEmailHtml, getRawHtml, runSync, ensureHeaderRow,
  sortEmailsByReceivedDesc,
  getBrands, appendBrands, seedBrands, discoverBrands,
  DISCOVERY_CATEGORIES, DISCOVERY_GEOS,
  NONE, NO_SCREENSHOT,
};
