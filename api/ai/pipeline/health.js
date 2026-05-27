'use strict';
// ════════════════════════════════════════════════════════════════════════════
// /api/ai/pipeline/health  — Pipeline health check (no shared-module deps)
//
// Called by the frontend before starting the pipeline to verify:
//   1. The endpoint is reachable (not 404 → deployment issue)
//   2. At least one LLM provider key is configured
//   3. Full 4-provider cascade status: OpenAI → Anthropic → Gemini → Grok/xAI
// ════════════════════════════════════════════════════════════════════════════

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // ── Provider key detection ────────────────────────────────────────────────
  const openaiKey1    = !!process.env.OPENAI_API_KEY;
  const openaiKey2    = !!process.env.OPENAI_API_KEY_2;
  const openaiKey3    = !!process.env.OPENAI_API_KEY_3;
  const anthropicKey  = !!process.env.ANTHROPIC_API_KEY;
  const geminiKey     = !!process.env.GEMINI_API_KEY;
  const grokKey       = !!process.env.XAI_API_KEY;

  const openaiKeyCount = [openaiKey1, openaiKey2, openaiKey3].filter(Boolean).length;
  const hasOpenAI      = openaiKeyCount > 0;
  const hasAnthropic   = anthropicKey;
  const hasGemini      = geminiKey;
  const hasGrok        = grokKey;
  const hasProvider    = hasOpenAI || hasAnthropic || hasGemini || hasGrok;

  // ── Model info (code defaults match image.js and pipeline/images.js) ──────
  const imageModel = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2 (default)';
  const textModel  = process.env.OPENAI_TEXT_MODEL  || 'gpt-4o-mini (default)';

  // ── Provider cascade description ──────────────────────────────────────────
  const activeTiers = [];
  if (hasOpenAI)     activeTiers.push('OpenAI (' + openaiKeyCount + ' key' + (openaiKeyCount > 1 ? 's' : '') + ')');
  if (hasAnthropic)  activeTiers.push('Anthropic/Claude');
  if (hasGemini)     activeTiers.push('Gemini');
  if (hasGrok)       activeTiers.push('Grok/xAI');

  const providerDesc = activeTiers.length > 0
    ? activeTiers.join(' → ')
    : 'None configured';

  // ── Checks object ─────────────────────────────────────────────────────────
  const checks = {
    endpoint_reachable:    true,
    // Tier 1 — OpenAI
    openai_key_set:        openaiKey1,
    openai_key_2_set:      openaiKey2,
    openai_key_3_set:      openaiKey3,
    openai_keys_total:     openaiKeyCount,
    // Tier 2 — Anthropic (Claude)
    anthropic_key_set:     hasAnthropic,
    // Tier 3 — Gemini
    gemini_key_set:        hasGemini,
    // Tier 4 — Grok (xAI)
    grok_key_set:          hasGrok,
    // Summary
    provider_tiers_active: activeTiers.length,
    at_least_one_provider: hasProvider,
    image_model:           hasOpenAI ? imageModel : 'Pollinations FLUX (free — no OpenAI key)',
    text_model:            textModel,
    node_version:          process.version,
    timestamp:             new Date().toISOString()
  };

  // ── Warnings ──────────────────────────────────────────────────────────────
  const warnings = [];

  if (!hasProvider) {
    warnings.push('CRITICAL: No AI provider keys configured. Set at least GEMINI_API_KEY (free) or OPENAI_API_KEY in Vercel env.');
  }
  if (!hasOpenAI) {
    warnings.push('OPENAI_API_KEY not set — image generation will use Pollinations FLUX (free fallback). Text cascade starts at Anthropic/Gemini/Grok.');
  } else if (openaiKeyCount === 1) {
    warnings.push('Only 1 OpenAI key configured. Add OPENAI_API_KEY_2 and OPENAI_API_KEY_3 as backups for quota resilience.');
  }
  if (!hasAnthropic) {
    warnings.push('ANTHROPIC_API_KEY not set — Tier 2 (Claude) unavailable. Pipeline falls directly from OpenAI to Gemini on quota/rate-limit.');
  }
  if (!hasGemini) {
    warnings.push('GEMINI_API_KEY not set — Tier 3 (Gemini) unavailable. Add free key at aistudio.google.com/app/apikey.');
  }
  if (!hasGrok) {
    warnings.push('XAI_API_KEY not set — Tier 4 (Grok) unavailable. Add at console.x.ai for final fallback coverage.');
  }

  return res.status(200).json({
    ok: hasProvider,
    stage: 'health',
    checks,
    warnings,
    verdict: hasProvider
      ? 'Pipeline ready · ' + providerDesc
      : 'BLOCKED: No LLM provider configured. Set at least GEMINI_API_KEY (free) or OPENAI_API_KEY.'
  });
};
