'use strict';

/**
 * GET /api/competitor/email-html?id=<rowNumber>
 * Returns the raw HTML (column K) for one email — lazy-loaded by the modal.
 */

const { getEmailHtml } = require('../_shared/competitor-sheets');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'private, max-age=300');
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }
  const id = (req.query && req.query.id) || '';
  const n = Number(id);
  if (!Number.isInteger(n) || n < 2) {
    res.status(400).json({ ok: false, html: '', error: 'Invalid id' });
    return;
  }
  try {
    const html = await getEmailHtml(n);
    res.status(200).json({ ok: true, html });
  } catch (err) {
    console.error('[api/competitor/email-html] failed:', err);
    res.status(500).json({ ok: false, html: '', error: err.message });
  }
};
