# VAHDAM Mailer Studio — Project Memory (CLAUDE.md)

## Architecture
- **Single-file SPA**: `vahdam_mailer_architect_v34.html` (~7700+ lines) — all UI, logic, templates
- **Vercel serverless API**: `api/ai/generate.js` (text), `api/ai/image.js` (images), `api/ai/pipeline/` (multi-stage)
- **Shared LLM caller**: `api/_shared/llm.js` — 6-provider waterfall with de-duplication
- **Deployment**: Vercel at https://vahdam-marketing-mailers-architect.vercel.app/
- **5-step wizard**: Brief → Products → Generation → Review & Refine → Final HTML

## Provider Waterfall (text)
OpenAI (gpt-4o-mini) → Anthropic (claude-3-5-haiku) → Gemini (gemini-2.0-flash) → Grok (grok-3-mini-fast) → Groq → Cerebras

## Provider Waterfall (images)
Gemini native (gemini-2.5-flash-image → gemini-3.1-flash-image-preview → gemini-3-pro-image-preview) → Gemini Imagen (imagen-4.0-generate-001 → imagen-4.0-fast-generate-001) → OpenAI (gpt-image-2 → gpt-image-1) → Pollinations (flux-pro → flux-realism → flux)

## Key Files
| File | Purpose |
|------|---------|
| `vahdam_mailer_architect_v34.html` | **Production SPA** — UI + concept engine + email builders |
| `api/ai/generate.js` | Text generation: create_brief, concepts, mailer_full, suggested_prompts |
| `api/ai/image.js` | Image generation: Gemini-first cascade → OpenAI → Pollinations |
| `api/_shared/llm.js` | Shared 6-provider LLM caller used by pipeline stages |
| `api/ai/pipeline/*.js` | Multi-stage pipeline: strategy → variant → images → html → score |
| `api/health.js` | Top-level health check for uptime monitors |
| `vercel.json` | Deployment config: functions, rewrites (`/` → v34), headers |
| `.env.example` | Environment variable documentation (no real values) |

## Product Catalogs
- US: 173 active products (from `products_export_usa.csv`)
- UK: 101 active products (from `products_export_uk.csv`)
- Global: 102 active products (from `products_export_global.csv`)
- Built at deploy time via `scripts/build-catalog.js` → `data/catalog/products_{region}.json`

## Market-Specific Store URLs (VERIFIED)
- US → www.vahdamteas.com | UK → uk.vahdamteas.com | IN → www.vahdamindia.com
- EU → eu.vahdamteas.com | AU → au.vahdamteas.com | Global/ME → www.vahdamteas.com
- PDP pattern: `{base}/products/{handle}` — handle from catalog JSON `h` field
- Collection pattern: `{base}/collections/{slug}` — mapped via `heroMap` in `collectionUrl()`

## Brand Constants (Style Guide is the source of truth — `Brand style guide.pdf`)
- **Palette (ONLY these four)**: `#004A2B` forest green · `#AB8743` gold · `#171717` near-black · `#FBF5EA` cream
- **Typography (STRICT — page 3 of style guide explicitly forbids any other font for emailers)**:
  - Primary (headings/subheadings/titles): **LAO MN** Regular & Bold — fallback `'Lao MN','Cormorant Garamond',Georgia,serif`
  - Secondary (body/paragraphs): **Proxima Nova** full family — fallback `'Proxima Nova','Helvetica Neue',Arial,sans-serif`
- ⚠️ Do NOT introduce off-palette tints (`#0f2a1c`, `#d4873a`, `#fdf6e8`, `#1a3a28`, `#1a1a1a`, `#faf8f4`) or Cormorant/DM Sans as the *primary* family — they were drift, now removed.
- **BANNED phrases**: wellness journey, transform, liquid gold, game-changer, LIMITED TIME (caps), hurry, don't miss out, last chance, while supplies last
- **PREFERRED**: ritual, restore, balance, origin, single-estate, hand-picked, steep, heritage, crafted
- **VAHDAM packaging**: deep forest-green, warm cream, terracotta, or pink/magenta depending on SKU — gold botanical label

## Layout Archetypes (11)
hero-led-editorial | product-grid-conversion | storytelling-narrative | single-product-spotlight | gift-bundle-showcase | ritual-journey | comparison-discovery | founder-note | editorial-trend-roundup | limited-drop-countdown | subscription-anchor

## Two-Variant System
- **Variant A**: Editorial Hero — split layout with product photography
- **Variant B**: Narrative Story — full-width editorial approach
- Forced structural divergence via `_alternateArchetypeForVariantB()`

## Step 1 UI Flow (Campaign Brief)
1. Campaign Description textarea with "Create Brief with AI" (LLM-powered) + "Enhance with AI" (heuristic)
2. Suggested Campaign Prompts accordion
3. Target Market multi-select chips (US, UK, IN, Global, ME, AU, EU)
4. Campaign Type chips (Auto, Sale, Launch, Seasonal, Bestseller, Gift, Discovery, Routine, Brand Story)

## Step 4 Features (Review & Refine)
- Content Preview tab — structured preview showing subject line, hero, products with real images/prices/ratings
- Claude AI tab, ChatGPT tab, Upload tab
- Content audit checklist (9 checks with pass/warn indicators)

## Common Bugs to Watch
1. **Unescaped quotes in JS strings** — apostrophes in single-quoted strings
2. **`const` reassignment** — use `let` when variable will be reassigned later
3. **Gemini model duplication** — env var can duplicate a hardcoded fallback model; always de-duplicate
4. **CORS headers** — every serverless function needs Access-Control-Allow-Origin
5. **Font stack in JS** — never use quoted font names inside JS template strings
6. **OpenAI billing_hard_limit_reached** returns HTTP 400 (not 429/402) — quota detection must include status 400 + billing keywords
7. **Anthropic credit balance too low** also returns HTTP 400 — same pattern
8. **PowerShell BOM corruption** — piping keys via PowerShell `echo` adds UTF-8 BOM (EF BB BF). Use `cmd /c "type file | vercel env add"` or write ASCII bytes explicitly
9. **Gemini Imagen predict API** — only works on paid plans, free tier gets 400 "only available on paid plans"
10. **Gemini native image models** — use `generateContent` with `responseModalities: ['IMAGE','TEXT']`, NOT the standard text-only models

## Environment Variables (Vercel)
Required: `GEMINI_API_KEY` — set via Vercel dashboard (NEVER commit real keys)
Optional: `OPENAI_API_KEY`, `OPENAI_API_KEY_2`, `OPENAI_API_KEY_3`, `ANTHROPIC_API_KEY`, `XAI_API_KEY`
Auto-set: `VERCEL`, `VERCEL_ENV`, `VERCEL_URL`
⚠️ ALL keys are stored in Vercel env vars only — never hardcode in source files

## Provider Status (as of 2026-05-08)
| Provider | Text | Images | Status |
|----------|------|--------|--------|
| Gemini | ✅ primary | ⚠️ quota-limited | Free tier, daily quota resets midnight PT |
| OpenAI | ❌ | ❌ | billing_hard_limit_reached |
| Anthropic | ⚠️ added | N/A | Key added, may have low credits |
| Grok/xAI | ❌ | N/A | No credits |
| Pollinations | N/A | ✅ fallback | Free, unlimited, flux-pro → flux-realism → flux |

## Emotional Copy System (as of 2026-05-08)
- All copy helpers (`heroHeadline`, `subCopy`, `prodShortDesc`, `prodBenefit`, `sectionTitle`, `annBarLine`, `_REVIEW_QUOTES`, pull-quotes) use warm, sensory, emotionally resonant language
- Style: "There is a moment when the right cup of tea does more than warm your hands" — personal, sensory, story-driven
- Avoids generic marketing speak; every line should make the reader feel something
- Testimonials written as tiny personal stories, not product reviews

## Image Generation
### Server-side (gpt-image-2 → Gemini → Pollinations cascade)
- `generateServerImage(variant)` calls `/api/ai/image` with `mode:'design'`
- `buildDesignPromptFromCatalog(market,variant)` builds rich prompt with real catalog data (names, prices, compare_at, discounts, subtitles, tasting notes)
- Currency symbols are region-aware (US→$, UK→£, IN→₹, EU→€, AU→A$)
- Includes variant-specific layout descriptions, brand palette, testimonials, trust signals
- "Generate Variant A/B" buttons in Step 4 Upload tab

### Pollinations fallback
- `buildPollinationsPrompt()` generates SCENE-based prompts (lighting, mood, atmosphere) — NOT email layout specifications
- Variant A = close-up hero product shot, tight crop, studio photography
- Variant B = wide atmospheric lifestyle photograph, storytelling composition, cinematic depth
- Explicit "NO text, NO typography" instruction prevents garbled text in generated images
- Uses `flux-pro` model with `quality=hd` and `enhance=true`
- Image dimensions: 600x900 (product-hero ratio, not full email height)

## Compact HTML Mailers (as of 2026-05-09)
- Both `buildEmail()` (Variant A) and `buildEmailVariantB()` standard paths reduced to ~1200-1500px (two scrolls)
- Variant A: ann bar → logo → hero split (headline left + product image right) → product grid → testimonial strip → offer → trust bar → footer
- Variant B: ann bar → logo → full-width hero → centered headline → vertical product stack → testimonial → offer → trust bar → footer
- Uploaded design paths remain compact: design image + product rows + footer

## Step 2 Selected Products Strip
- Products selected/auto-picked now appear in a dedicated horizontal strip below the catalog grid
- Each card shows image, name, price (with compare_at/discount), subtitle, and a red × remove button
- Strip auto-hides when no products are selected

## API Keys (2026-05-30) — per-project Gemini via gcloud
Each app has its OWN restricted Gemini key (generativelanguage API) minted from its own GCP project, pushed to Vercel (Production+Development), all verified HTTP 200:
- vahdam-lifecycle-os ← GCP vahdam-lifecycle-os
- personal-ai-os ← GCP gen-lang-client-0650981394
- the-third-eye ← GCP jarvis-anchit (GEMINI_API_KEY + VITE_GEMINI_API_KEY)
- music-gen-ai ← GCP soundweave-489519
- hey-yaara ← GCP fluent-anagram-492522-q4
- ai-tele-suite ← GCP ai-telesuite
- th-life-engine ← GCP gen-lang-client-0121882805
- marketing-mailers-html-architect ← GCP gen-lang-client-0878036120
Other providers (OpenAI/Anthropic/xAI/Groq/Cerebras) left as-is (cannot self-generate).
Canonical repos now at ~/dev/anchit-hustle (moved off iCloud which was corrupting git).
