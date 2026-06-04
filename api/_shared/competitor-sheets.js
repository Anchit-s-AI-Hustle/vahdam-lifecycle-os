'use strict';

/**
 * Shared Google Sheets reader for the Competitor Benchmarking dashboard.
 *
 * Reads the same sheet that the Competitor Intelligence Hub sync engine writes
 * to (a separate Vercel project ingests the emails; this project only READS).
 * Auth is a Google service account shared on the sheet as a viewer/editor.
 *
 * Required env vars (set on this Vercel project):
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL
 *   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY   (literal \n escapes are normalized)
 *   GOOGLE_SHEET_ID
 *   GOOGLE_SHEET_TAB                     (defaults to "Emails")
 */

const { google } = require('googleapis');

let _sheets = null;

function sheetsClient() {
  if (_sheets) return _sheets;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!email || !key) {
    throw new Error(
      'Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY'
    );
  }
  key = key.replace(/\\n/g, '\n').replace(/^["']|["']$/g, '');
  const auth = new google.auth.JWT({
    email,
    key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  _sheets = google.sheets({ version: 'v4', auth });
  return _sheets;
}

function sheetId() {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error('Missing GOOGLE_SHEET_ID');
  return id;
}

function sheetTab() {
  return process.env.GOOGLE_SHEET_TAB || 'Emails';
}

/** Map a sheet row (cols A–J) to an email record keyed by 1-based row number. */
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
    promoCodes: get(6) || 'None',
    screenshotUrl: get(7) || 'None',
    inlineImageUrls: get(8) || 'None',
    attachmentUrls: get(9) || 'None',
  };
}

/** Read all data rows (newest first). Returns [] if the tab doesn't exist yet. */
async function getAllEmails() {
  const sheets = sheetsClient();
  let res;
  try {
    res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId(),
      range: `${sheetTab()}!A2:J`,
    });
  } catch (err) {
    const msg = (err && err.message) || '';
    if (/Unable to parse range/i.test(msg)) return [];
    throw err;
  }
  const rows = res.data.values || [];
  return rows
    .map((row, i) => rowToRecord(row, i + 2))
    .filter((r) => r.senderEmail || r.subject || r.brand !== 'Unknown')
    .reverse();
}

/** Read the raw HTML (column K) for one row. */
async function getEmailHtml(rowNumber) {
  const n = Number(rowNumber);
  if (!Number.isInteger(n) || n < 2) return '';
  const sheets = sheetsClient();
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId(),
      range: `${sheetTab()}!K${n}`,
    });
    return (res.data.values && res.data.values[0] && res.data.values[0][0]) || '';
  } catch (e) {
    return '';
  }
}

module.exports = { getAllEmails, getEmailHtml };
