-- ═══════════════════════════════════════════════════════════════════════════
-- Seed: brand_kit (from official PDF) + market_config (7 markets)
-- Truth source: Brand style guide.pdf — only 4 official colours, 2 fonts.
-- ═══════════════════════════════════════════════════════════════════════════

-- BRAND KIT (singleton row) --------------------------------------------------
INSERT INTO public.vahdam_brand_kit (id, palette, typography, voice, footer_blocks, guide_pdf_url)
VALUES (
  1,
  -- Official 4-colour palette (from PDF page 11)
  '{
    "primary": "#004A2B",
    "accent":  "#AB8743",
    "bg":      "#FBF5EA",
    "text":    "#171717"
  }'::jsonb,
  -- Official typography (from PDF pages 3-10)
  '{
    "primary": {
      "family": "Lao MN",
      "stack":  "''Lao MN'', Georgia, ''Times New Roman'', serif",
      "usage":  ["headings","sub-heading","titles","hero text"],
      "weights": ["regular","bold"]
    },
    "secondary": {
      "family": "Proxima Nova",
      "stack":  "''Proxima Nova'', ''Helvetica Neue'', Arial, sans-serif",
      "usage":  ["body","paragraph","captions","buttons","footer","labels","nav"],
      "weights": ["thin","light","regular","medium","semibold","bold","extrabold","black"]
    }
  }'::jsonb,
  -- Voice
  '{
    "tone": "Premium, warm, story-led, ethical sourcing. VAHDAM® is disrupting the 200-year-old supply chain of tea.",
    "tagline": "We Care for You, our Farmers & the Environment.",
    "dos": [
      "Lead with farmer / origin story",
      "Cite single-estate or single-garden provenance",
      "Mention freshness window (garden-to-cup)",
      "Use the ® mark on first VAHDAM mention",
      "Premium, considered language — never shouty"
    ],
    "donts": [
      "Generic marketing fluff",
      "Aggressive CAPS sale-shouting",
      "Dilute the ® mark",
      "Use unofficial colours (only #004A2B / #AB8743 / #FBF5EA / #171717)",
      "Use fonts other than Lao MN (headings) or Proxima Nova (body)"
    ]
  }'::jsonb,
  -- Footer blocks
  '{
    "legal":   "VAHDAM India Pvt. Ltd., New Delhi, India",
    "contact": { "email": "hello@vahdam.com" },
    "social": [
      { "platform": "instagram", "url": "https://www.instagram.com/vahdamteas/" },
      { "platform": "facebook",  "url": "https://www.facebook.com/vahdamteas/" },
      { "platform": "x",         "url": "https://twitter.com/vahdamteas" }
    ],
    "links": {
      "unsubscribe":    "/pages/unsubscribe",
      "privacy_policy": "/pages/privacy-policy",
      "shipping":       "/pages/shipping-policy",
      "returns":        "/pages/returns-and-refunds"
    }
  }'::jsonb,
  null
)
ON CONFLICT (id) DO UPDATE SET
  palette        = EXCLUDED.palette,
  typography     = EXCLUDED.typography,
  voice          = EXCLUDED.voice,
  footer_blocks  = EXCLUDED.footer_blocks,
  updated_at     = now();

-- MARKET CONFIG (7 markets) --------------------------------------------------
INSERT INTO public.vahdam_market_config
  (market, display_name, flag, base_url, currency, currency_symbol, shipping_note, language, collections, featured_heroes)
VALUES
  ('US',     'United States',  '🇺🇸', 'https://www.vahdam.com',     'USD', '$',  'Free US shipping over $39',         'en',
   '{"chai":"/collections/chai-teas","wellness":"/collections/wellness-teas","gift":"/collections/tea-gift-sets","green":"/collections/green-teas","black":"/collections/black-teas","iced":"/collections/iced-tea","oolong":"/collections/oolong-teas","caffeineFree":"/collections/caffeine-free","bestsellers":"/collections/bestsellers"}'::jsonb,
   '["India''s Original Masala Chai Tea","Turmeric Ginger Herbal Tea","Earl Grey Black Tea","Himalayan Green Tea"]'::jsonb),

  ('UK',     'United Kingdom', '🇬🇧', 'https://www.vahdam.co.uk',   'GBP', '£',  'Free UK shipping over £30',         'en',
   '{"chai":"/collections/chai-teas","wellness":"/collections/wellness-teas","gift":"/collections/tea-gift-sets","green":"/collections/green-teas","black":"/collections/black-teas","iced":"/collections/iced-tea","oolong":"/collections/oolong-teas","caffeineFree":"/collections/caffeine-free","bestsellers":"/collections/bestsellers"}'::jsonb,
   '["India''s Original Masala Chai Tea","Earl Grey Black Tea","Darjeeling First Flush Black Tea","English Breakfast Black Tea"]'::jsonb),

  ('IN',     'India',          '🇮🇳', 'https://www.vahdam.in',      'INR', '₹',  'Free shipping pan India over ₹599', 'en',
   '{"chai":"/collections/chai-teas","wellness":"/collections/wellness-teas","gift":"/collections/tea-gift-sets","green":"/collections/green-teas","black":"/collections/black-teas","iced":"/collections/iced-tea","oolong":"/collections/oolong-teas","caffeineFree":"/collections/caffeine-free","bestsellers":"/collections/bestsellers"}'::jsonb,
   '["India''s Original Masala Chai Tea","Turmeric Ginger Herbal Tea","Cardamom Masala Chai Tea","Tulsi Green Tea"]'::jsonb),

  ('Global', 'Global',         '🌍', 'https://www.vahdam.global',  'USD', '$',  'Worldwide express shipping',        'en',
   '{"chai":"/collections/chai-teas","wellness":"/collections/wellness-teas","gift":"/collections/tea-gift-sets","green":"/collections/green-teas","black":"/collections/black-teas","iced":"/collections/iced-tea","oolong":"/collections/oolong-teas","caffeineFree":"/collections/caffeine-free","bestsellers":"/collections/bestsellers"}'::jsonb,
   '["India''s Original Masala Chai Tea","Turmeric Ginger Herbal Tea","Earl Grey Black Tea","Hibiscus Cranberry Iced Tea"]'::jsonb),

  ('ME',     'Middle East',    '🇦🇪', 'https://www.vahdam.global',  'USD', '$',  'Express shipping to UAE / GCC',     'en',
   '{"chai":"/collections/chai-teas","wellness":"/collections/wellness-teas","gift":"/collections/tea-gift-sets"}'::jsonb,
   '["Cardamom Masala Chai Tea","Saffron Kashmiri Tea","India''s Original Masala Chai Tea"]'::jsonb),

  ('AU',     'Australia',      '🇦🇺', 'https://www.vahdam.global',  'USD', '$',  'Express shipping to Australia',     'en',
   '{"chai":"/collections/chai-teas","wellness":"/collections/wellness-teas","gift":"/collections/tea-gift-sets"}'::jsonb,
   '["India''s Original Masala Chai Tea","Turmeric Ginger Herbal Tea","Earl Grey Black Tea"]'::jsonb),

  ('EU',     'Europe',         '🇪🇺', 'https://www.vahdam.global',  'EUR', '€',  'Express shipping across Europe',    'en',
   '{"chai":"/collections/chai-teas","wellness":"/collections/wellness-teas","gift":"/collections/tea-gift-sets"}'::jsonb,
   '["India''s Original Masala Chai Tea","Earl Grey Black Tea","Darjeeling First Flush Black Tea"]'::jsonb)
ON CONFLICT (market) DO UPDATE SET
  display_name    = EXCLUDED.display_name,
  flag            = EXCLUDED.flag,
  base_url        = EXCLUDED.base_url,
  currency        = EXCLUDED.currency,
  currency_symbol = EXCLUDED.currency_symbol,
  shipping_note   = EXCLUDED.shipping_note,
  collections     = EXCLUDED.collections,
  featured_heroes = EXCLUDED.featured_heroes,
  updated_at      = now();
