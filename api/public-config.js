'use strict';

/**
 * /api/public-config
 *
 * Returns the PUBLIC config the front-end needs: Supabase URL + anon key.
 * Never include service-role keys, OpenAI keys, etc. here.
 * Cached for 5 minutes at the CDN.
 */

module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  res.setHeader('Content-Type', 'application/json');
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
