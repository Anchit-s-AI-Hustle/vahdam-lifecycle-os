'use strict';

/**
 * GET /api/competitor/emails
 * Returns all competitor email rows for the Benchmarking dashboard.
 */

const { getAllEmails } = require('../_shared/competitor-sheets');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }
  try {
    const emails = await getAllEmails();
    res.status(200).json({ ok: true, emails });
  } catch (err) {
    console.error('[api/competitor/emails] failed:', err);
    res.status(500).json({ ok: false, emails: [], error: err.message });
  }
};
