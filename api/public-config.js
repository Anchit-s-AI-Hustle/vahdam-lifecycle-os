'use strict';

/**
 * /api/public-config
 *
 * Returns the PUBLIC config the front-end needs: Supabase URL + anon key.
 * Never include service-role keys, OpenAI keys, etc. here.
 * Cached for 5 minutes at the CDN.
 */

module.exports = function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  // Health mode — /api/health rewrites here as ?health=1. Returns provider
  // status (no secrets) for uptime monitors + deploy verification. Always 200.
  if (req.query && (req.query.health !== undefined)) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    const hasOpenAI = !!process.env.OPENAI_API_KEY;
    const hasGemini = !!process.env.GEMINI_API_KEY;
    const hasSupabase = !!(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
    return res.status(200).json({
      ok: true,
      build: 'lifecycle-os',
      ts: new Date().toISOString(),
      region: process.env.VERCEL_REGION || 'unknown',
      env: process.env.VERCEL_ENV || 'unknown',
      providers: {
        text: { active: hasOpenAI ? 'openai' : (hasGemini ? 'gemini' : 'none'), openai_configured: hasOpenAI, gemini_configured: hasGemini },
        image: { active: hasOpenAI ? 'openai' : 'pollinations', pollinations_available: true },
        storage: { supabase_configured: hasSupabase },
      },
    });
  }

  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  res.status(200).json({
    supabase: {
      url:      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      anonKey:  process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
    },
    app: {
      name: 'VAHDAM Lifecycle OS',
      version: '1.0.0',
      regions: ['US', 'UK', 'Global', 'IN'],
    },
  });
};
