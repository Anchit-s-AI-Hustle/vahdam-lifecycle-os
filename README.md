# VAHDAM Lifecycle OS

**Data Analysis + Marketing Calendar + Mailer Creator** — one workflow, three stages, deployable as a single Vercel project.

Forked from [`marketing_mailers__html_architect`](https://github.com/Anchit-s-AI-Hustle/marketing_mailers__html_architect) so the original Mailer Studio stays untouched in production. This repo adds the retention dashboard + calendar generator on top.

---

## The pipeline

```
┌───────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  Stage 01     │    │  Stage 02        │    │  Stage 03        │
│  Data         │──▶ │  Marketing       │──▶ │  Mailer Studio   │
│  Analysis     │    │  Calendar        │    │  (4 variants)    │
│  /dashboard   │    │  /calendar       │    │  /studio         │
└───────────────┘    └──────────────────┘    └──────────────────┘
```

### Stage 01 — Data Analysis (`/dashboard.html`)
- Upload CSV / XLSX (campaigns, customers, orders, products) or run on synthetic seed
- Computes 9 RFM segments, channel mix, retention cohorts, cross-sell affinity
- 10 auto-generated strategic insights (severity-ranked)
- Exports any view as CSV
- Source: ported from `vahdam_dtc_data_engine/reports/retention-intelligence.html`

### Stage 02 — Marketing Calendar (`/calendar.html`)
- Reads the analytics state from localStorage (or generates a seed if missing)
- POSTs to `/api/calendar/generate` which returns a 30-day plan
- Plan is segment-aware, festival-aware, capacity-guarded
- Each calendar entry is one-click → buildable into 4 mailer variants
- Festivals data: `data/festivals.json` (US / UK / Global, ~70 cultural moments)

### Stage 03 — Mailer Studio (`/studio`)
- The original `vahdam_mailer_architect_v34.html`
- Now produces **4 variants** per send:
  - **A** — Image · Hero (close-up product photography)
  - **B** — Image · Lifestyle (wide editorial scene)
  - **T1** — Text · Editorial (no images, full editorial layout)
  - **T2** — Text · Founder note (warm, personal, one-CTA)
- Cascade unchanged: OpenAI → Anthropic → Gemini → xAI → Groq → Cerebras

---

## New API endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/calendar/generate` | Body: `{ days, markets, capacity_per_market_per_week, analytics }`. Returns a 30-day plan with per-send segment, archetype, content type, hero SKU, subject hint, festival, rationale. |
| `POST /api/calendar/trigger-mailer` | Body: `{ entry }` (one calendar row). Runs strategy stage via the LLM cascade, returns 4 variants (A / B / T1 / T2). Does **not** send. |

---

## Deploy (2 commands once GitHub repo exists)

```bash
# 1. Push this directory to a new GitHub repo
gh repo create Anchit-s-AI-Hustle/vahdam-lifecycle-os --public --source=. --remote=origin --push

# 2. Import to Vercel via dashboard, OR:
vercel link --yes
vercel --prod

# 3. Copy env vars from the original mailer project:
vercel link --yes --project marketing-mailers-html-architect
vercel env pull /tmp/mailer.env --environment=production
# then re-link to this project and bulk-add:
vercel link --yes --project vahdam-lifecycle-os
cat /tmp/mailer.env | while IFS='=' read -r k v; do
  [ -z "$k" ] && continue
  v="${v%\"}"; v="${v#\"}"
  printf '%s' "$v" | vercel env add "$k" production --force
done
vercel --prod
```

---

## Brand + voice constraints

All inherited from the parent repo (see `CLAUDE.md`):
- Palette: `#004A2B` forest green · `#AB8743` gold · `#171717` ink · `#FBF5EA` cream
- Type: Lao MN (headings) + Proxima Nova (body)
- Banned phrases enforced: "wellness journey", "transform", "liquid gold", "LIMITED TIME", "hurry", "don't miss out"

---

## What's NOT included yet

- **Automatic send**. Calendar rows currently produce HTML variants — they don't fire emails. Adding a send queue (Klaviyo flow trigger / Postmark / SendGrid) is the next phase.
- **Image variants A & B** when triggered from the calendar UI: the brief is generated but the actual image render runs in the Mailer Studio. Inline image rendering from the calendar is a small extra wire-up.
