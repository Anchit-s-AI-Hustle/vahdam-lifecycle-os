'use strict';

/**
 * /api/calendar — single-function router for calendar generation +
 * mailer triggering.
 *
 * Consolidated to keep us under Vercel Hobby's 12-function limit. The
 * actual handlers still live in api/_shared/ (underscore prefix excludes
 * them from Vercel's function scan), so all the existing logic is intact
 * — this file only dispatches.
 *
 * Routes:
 *   ?action=generate         → POST: build a 30-day calendar
 *   ?action=trigger-mailer   → POST: feed one calendar row into the
 *                              /api/ai/pipeline stages to produce HTML
 */

const generate = require('./_shared/calendar-generate.js');
const triggerMailer = require('./_shared/calendar-trigger.js');

module.exports = async function handler(req, res) {
  const action = (req.query?.action || '').toLowerCase();
  if (action === 'generate') return generate(req, res);
  if (action === 'trigger-mailer' || action === 'triggermailer') return triggerMailer(req, res);
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.status(400).json({ ok: false, error: 'Use ?action=generate or ?action=trigger-mailer' });
};
