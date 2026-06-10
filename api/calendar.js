<<<<<<< HEAD
=======
'use strict';

/**
 * /api/calendar — single-function router for calendar generation,
 * mailer triggering, and Smart Brain actions.
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
 *   ?action=smart-brain-*   → GET/POST: Smart Brain health/schema/daily run/
 *                              generation/feedback/recalibration, multiplexed
 *                              here to avoid adding a 13th Vercel function
 */

const generate = require('./_shared/calendar-generate.js');
const triggerMailer = require('./_shared/calendar-trigger.js');
const { runDailySmartBrain, smartConfig, schemaAssumptions, GenerationService, SmartBrainDbAdapter } = require('../lib/smart-brain/services.js');

function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (_) { return {}; } }
  return req.body;
}

async function smartBrain(req, res, smartAction) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const body = readBody(req);
  try {
    if (smartAction === 'health') {
      const config = smartConfig(body.config || {});
      const db = new SmartBrainDbAdapter(config);
      return res.status(200).json({ ok: true, service: 'vahdam-smart-brain', db_linked: db.connected, modules: ['knowledge_base', 'analysis', 'competitor_benchmarking', 'calendar_intelligence', 'generation', 'human_review'], live_platform_push: false });
    }

    if (smartAction === 'schema') return res.status(200).json({ ok: true, ...schemaAssumptions(smartConfig(body.config || {})) });

    if (smartAction === 'run-daily' || smartAction === 'daily') {
      if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
      const result = await runDailySmartBrain({ config: body.config || {}, startDate: body.start_date, days: body.days, persist: body.persist === true });
      return res.status(200).json(result);
    }

    if (smartAction === 'generate-slot') {
      if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
      if (!body.entry) return res.status(400).json({ ok: false, error: 'entry is required' });
      const campaign = new GenerationService(smartConfig(body.config || {})).generate(body.entry);
      return res.status(200).json({ ok: true, campaign });
    }

    if (smartAction === 'feedback') {
      if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
      const config = smartConfig(body.config || {});
      const db = new SmartBrainDbAdapter(config);
      const feedback = { target_type: body.target_type || 'calendar_entry', target_id: body.target_id, verdict: body.verdict || 'comment', notes: body.notes || '', reviewer: body.reviewer || null, created_at: new Date().toISOString() };
      const persistence = await db.insert(config.tableNames.feedback, [feedback]);
      return res.status(200).json({ ok: true, feedback, persistence, applied_to_future_generation: true });
    }

    if (smartAction === 'weekly-recalibration' || smartAction === 'recalibrate') {
      if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
      const result = await runDailySmartBrain({ config: body.config || {}, startDate: body.start_date, days: body.days || 15, persist: body.persist === true });
      result.weekly_recalibration = { completed_at: new Date().toISOString(), human_reviewer: body.reviewer || 'unassigned', decisions: body.decisions || [], next_required_by_days: 7 };
      return res.status(200).json(result);
    }

    return res.status(400).json({ ok: false, error: 'Unknown Smart Brain action. Use smart-brain-health|smart-brain-schema|smart-brain-run-daily|smart-brain-generate-slot|smart-brain-feedback|smart-brain-weekly-recalibration' });
  } catch (err) {
    console.error('[api/calendar smart-brain]', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

module.exports = async function handler(req, res) {
  const action = (req.query?.action || '').toLowerCase();
  if (action === 'generate') return generate(req, res);
  if (action === 'trigger-mailer' || action === 'triggermailer') return triggerMailer(req, res);
  if (action.startsWith('smart-brain-')) return smartBrain(req, res, action.replace('smart-brain-', ''));
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.status(400).json({ ok: false, error: 'Use ?action=generate, ?action=trigger-mailer, or ?action=smart-brain-run-daily' });
};
>>>>>>> acdfe52a6c4ed835673c3b9e52cbe06da0f33c4b
