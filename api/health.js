// ════════════════════════════════════════════════════════════════════════════
// /api/health — Health check endpoint
// Returns environment status without exposing secret values. Used for:
//   - Uptime monitoring (Pingdom, UptimeRobot, etc.)
//   - Deploy verification (which env vars are wired)
//   - Provider availability check (which AI provider is active)
// Always returns 200 OK so monitoring services can detect "endpoint exists" vs
// "endpoint broken". The body indicates whether providers are configured.
// ════════════════════════════════════════════════════════════════════════════

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasGemini = !!process.env.GEMINI_API_KEY;
  const hasSupabase = !!(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);

  // Pick the active text provider per the same waterfall as /api/ai/generate
  const activeTextProvider = hasOpenAI ? 'openai' : (hasGemini ? 'gemini' : 'none');
  // Image provider: OpenAI if key, else Pollinations (free, no auth required)
  const activeImageProvider = hasOpenAI ? 'openai-gpt-image-1' : 'pollinations-flux';

  res.status(200).json({
    ok: true,
    build: 'audit-additions-v83',
    ts: new Date().toISOString(),
    region: process.env.VERCEL_REGION || 'unknown',
    env: process.env.VERCEL_ENV || 'unknown',
    providers: {
      text: {
        active: activeTextProvider,
        openai_configured: hasOpenAI,
        gemini_configured: hasGemini,
        text_model: process.env.OPENAI_TEXT_MODEL || process.env.GEMINI_TEXT_MODEL || 'default'
      },
      image: {
        active: activeImageProvider,
        openai_configured: hasOpenAI,
        pollinations_available: true, // always — no auth
        image_model: hasOpenAI ? (process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1') : 'flux'
      },
      storage: {
        supabase_configured: hasSupabase
      }
    },
    fallback_chain: {
      text: 'openai → gemini → client_heuristic',
      image: 'openai → pollinations'
    }
  });
};
