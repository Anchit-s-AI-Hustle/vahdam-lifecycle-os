'use strict';

const { runDailySmartBrain, smartConfig, schemaAssumptions, GenerationService, SmartBrainDbAdapter } = require('../lib/smart-brain/services.js');

function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (_) { return {}; } }
  return req.body;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const action = String(req.query?.action || 'health').toLowerCase();
  const body = readBody(req);

  try {
    if (action === 'health') {
      const config = smartConfig(body.config || {});
      const db = new SmartBrainDbAdapter(config);
      return res.status(200).json({ ok: true, service: 'vahdam-smart-brain', db_linked: db.connected, modules: ['knowledge_base', 'analysis', 'competitor_benchmarking', 'calendar_intelligence', 'generation', 'human_review'], live_platform_push: false });
    }

    if (action === 'schema') return res.status(200).json({ ok: true, ...schemaAssumptions(smartConfig(body.config || {})) });

    if (action === 'run-daily' || action === 'daily') {
      if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
      const result = await runDailySmartBrain({ config: body.config || {}, startDate: body.start_date, days: body.days, persist: body.persist === true });
      return res.status(200).json(result);
    }

    if (action === 'generate-slot') {
      if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
      if (!body.entry) return res.status(400).json({ ok: false, error: 'entry is required' });
      const campaign = new GenerationService(smartConfig(body.config || {})).generate(body.entry);
      return res.status(200).json({ ok: true, campaign });
    }

    if (action === 'feedback') {
      if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
      const config = smartConfig(body.config || {});
      const db = new SmartBrainDbAdapter(config);
      const feedback = { target_type: body.target_type || 'calendar_entry', target_id: body.target_id, verdict: body.verdict || 'comment', notes: body.notes || '', created_at: new Date().toISOString() };
      const persistence = await db.insert(config.tableNames.feedback, [feedback]);
      return res.status(200).json({ ok: true, feedback, persistence, applied_to_future_generation: true });
    }

    if (action === 'weekly-recalibration' || action === 'recalibrate') {
      if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
      const result = await runDailySmartBrain({ config: body.config || {}, startDate: body.start_date, days: body.days || 15, persist: body.persist === true });
      result.weekly_recalibration = { completed_at: new Date().toISOString(), human_reviewer: body.reviewer || 'unassigned', decisions: body.decisions || [], next_required_by_days: 7 };
      return res.status(200).json(result);
    }

    return res.status(400).json({ ok: false, error: 'Unknown action. Use health|schema|run-daily|generate-slot|feedback|weekly-recalibration' });
  } catch (err) {
    console.error('[api/smart-brain]', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
