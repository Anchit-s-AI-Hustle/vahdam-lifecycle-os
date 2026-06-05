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

// ── Screenshot (HCTI hosted URL — stored directly, no Drive needed) ──────────
function wrapHtml(rawHtml) {
  if (/<html[\s>]/i.test(rawHtml)) return rawHtml;
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#fff;font-family:Arial,Helvetica,sans-serif;}.__wrap{width:640px;margin:0 auto;}</style></head><body><div class="__wrap">${rawHtml}</div></body></html>`;
}
async function renderScreenshotUrl(html) {
  if (!html || !html.trim()) return null;
  const userId = process.env.HCTI_USER_ID;
  const apiKey = process.env.HCTI_API_KEY;
  if (!userId || !apiKey) return null;
  try {
    const auth = Buffer.from(`${userId}:${apiKey}`).toString('base64');
    const res = await fetch('https://hcti.io/v1/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
      body: JSON.stringify({ html: wrapHtml(html), ms_delay: 500 }),
    });
    if (!res.ok) { console.error('[competitor] HCTI failed', res.status); return null; }
    const data = await res.json();
    return data && data.url ? data.url : null;
  } catch (e) { console.error('[competitor] screenshot error', e.message); return null; }
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

      // Image: HCTI hosted URL (stored directly). Inline/attachment file storage
      // deferred (service-account Drive has no quota on personal accounts; see PRD §8.4).
      let screenshotUrl = NO_SCREENSHOT;
      try {
        const url = await renderScreenshotUrl(fullHtml);
        if (url) screenshotUrl = url;
      } catch (e) { errors.push(`screenshot(${brand}): ${e.message}`); }

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
  return { ok: true, processed: parsedList.length, appended, errors, durationMs: Date.now() - started };
}

module.exports = {
  getAllEmails, getEmailHtml, runSync, ensureHeaderRow,
  NONE, NO_SCREENSHOT,
};
