# VAHDAM Smart Brain MVP

This repo now includes a working, DB-linked Smart Brain for VAHDAM Lifecycle OS. It stops before live platform push: generated objects are platform-ready for Google, Meta, TikTok, Klaviyo, and WebEngage, but every object is marked `push_status: not_integrated_phase_2`.

## Persistent rolling plan (the daily loop)

The brain keeps a durable tentative **15-day calendar** in `smart_calendar_entries`
(one row per date+market, stable id `cal_<date>_<market>`), implemented in
`api/_shared/smart-brain-plan.js` and reviewed daily:

1. **Vercel Cron** (03:30 UTC, `vercel.json` → `/api/cron/smart-brain` →
   `/api/calendar?action=smart-brain-cron`, protected by `CRON_SECRET`) calls
   `syncDaily()`.
2. `syncDaily()` re-runs KB → Analysis → Competitor Benchmarking on the latest
   data, regenerates the window, then **diff-updates** the stored plan:
   - `approved`/`final` entries are never touched (human decisions are locked),
   - `tentative` entries are updated only on material change (cohort, hero
     product, objective, channels, confidence ±5pts) with a `change_log` entry,
   - `rejected` entries are re-planned,
   - new days are appended so the window stays 15 days ahead; past tentative
     days are `archived`.
3. The **Smart Brain console** (`/brain` → `smart-brain.html`) shows the plan,
   the change feed, and per-entry **Approve / Reject** buttons.
4. **Approve** generates the full funnel for that slot — LLM-written copy via
   the 6-provider waterfall (template fallback) for the mailer, Meta/Google/
   TikTok ads, and a landing page — persisted to `smart_generated_campaigns`,
   mirrored into `ads_generated` + `landing_pages_generated` (so the Ads and
   Landing Pages dashboards list them), and the landing page is served at
   **`/lp/<campaign_id>`**.
5. **Reject** stores feedback in `smart_feedback`; the slot regenerates on the
   next daily sync with feedback applied.

### Plan API

```http
GET  /api/calendar?action=smart-brain-plan          # current rolling plan
POST /api/calendar?action=smart-brain-sync-daily    # manual daily review  { "days": 15 }
GET  /api/calendar?action=smart-brain-cron          # cron entrypoint (Bearer CRON_SECRET)
POST /api/calendar?action=smart-brain-approve       # { "id": "cal_2026-06-12_us", "reviewer": "..." }
POST /api/calendar?action=smart-brain-reject        # { "id": "...", "notes": "...", "reviewer": "..." }
GET  /lp/:campaignId                                # hosted generated landing page
```

Without Supabase env vars everything still runs statelessly against local CSV
samples (plan preview + inline-entry approval), so the MVP stays demonstrable.

## Service boundaries

| Service | File | Responsibility |
|---|---|---|
| Knowledge Base | `lib/smart-brain/services.js` | Ingests catalog, assets, campaigns, campaign-assets, metrics, users, and orders from the linked DB and indexes own campaigns with assets, hooks, formats, and creative-level rollups. |
| Data Analysis | `lib/smart-brain/services.js` | Builds cohorts, applies performance thresholds to own campaign history, scores products, summarizes MVT results, and emits daily insights. |
| Competitor Benchmarking | `lib/smart-brain/services.js` | Reads only the separate `smart_competitor_campaigns` stream and produces isolated channel/hook benchmarks. |
| Calendar Intelligence | `lib/smart-brain/services.js` | Creates a 15-day rolling plan by market/cohort/channel using own winners, seasonal moments, competitor context, feedback, and MVT plans. |
| Generation | `lib/smart-brain/services.js` | Produces HTML mailers, platform ad specs, landing pages, retargeting, similar-audience logic, and full-funnel campaign objects. |
| Human Review | `lib/smart-brain/services.js` | Enforces human verification for every campaign and a hard weekly recalibration checklist. |

The Smart Brain is multiplexed through the existing `api/calendar.js` serverless function to keep the Vercel Hobby deployment under the 12-function cap.

## API

### Health

```http
GET /api/calendar?action=smart-brain-health
```

Returns module availability and whether Supabase DB env vars are linked.

### Schema contract

```http
GET /api/calendar?action=smart-brain-schema
```

Returns expected table names and columns.

### Daily automated review + generation

```http
POST /api/calendar?action=smart-brain-run-daily
Content-Type: application/json

{
  "days": 15,
  "start_date": "2026-06-09",
  "persist": false,
  "config": {
    "markets": ["US", "UK"]
  }
}
```

Returns:

- `kb`: indexed own catalog/assets/campaign library.
- `analysis`: cohorts, own campaign winners, benchmarks, daily insights.
- `competitorBenchmarks`: isolated real-time competitive stream summary.
- `calendar`: rolling 15-day calendar with human-review status.
- `campaigns`: final ready-to-deploy assets and platform-ready schemas.
- `review`: daily automation summary and weekly recalibration policy.

If Supabase env vars are missing, the endpoint runs against local CSV samples so the MVP remains demonstrable. In production, provide the linked DB via `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` or the `SMART_BRAIN_*` equivalents.

### Generate one approved slot

```http
POST /api/calendar?action=smart-brain-generate-slot
Content-Type: application/json

{ "entry": { ...calendarEntry } }
```

### Capture human feedback

```http
POST /api/calendar?action=smart-brain-feedback
Content-Type: application/json

{
  "target_type": "calendar_entry",
  "target_id": "cal_xxx",
  "verdict": "approved_with_changes",
  "notes": "Use gift bundle proof instead of discount framing."
}
```

The feedback is written to `smart_feedback` when DB env vars are configured and is read on future calendar generations.

### Weekly recalibration

```http
POST /api/calendar?action=smart-brain-weekly-recalibration
Content-Type: application/json

{
  "reviewer": "Lifecycle Lead",
  "days": 15,
  "decisions": ["raise Meta ROAS threshold", "pause At-Risk discount tests"]
}
```

Runs the same daily brain plus records the human recalibration context in the response.

## Schema assumptions

The migration `supabase/migrations/20260609_smart_brain.sql` documents the assumed linked DB shape. The critical separation is:

- Own data: `smart_products`, `smart_assets`, `smart_campaigns`, `smart_campaign_assets`, `smart_campaign_metrics`, `smart_users`, `smart_orders`, `smart_events`, `smart_mvt_results`, `smart_feedback`.
- Competitive stream: `smart_competitor_campaigns` only.

Competitive data informs calendar and creative decisions through `competitorContext`, but never qualifies own campaign-library winners.

## Daily operating loop

1. Scheduler calls `POST /api/calendar?action=smart-brain-run-daily` for a 15-day window.
2. Knowledge Base re-indexes own DB data and campaign assets.
3. Analysis rebuilds cohorts, product scores, thresholds, and MVT learnings.
4. Competitor Benchmarking pulls the separate competitive stream.
5. Calendar Intelligence regenerates the tentative rolling calendar.
6. Generation creates all campaign assets and platform-ready schemas.
7. Review keeps every campaign in a human-verification state before final launch.

## Weekly human loop

1. Lifecycle owner calls `POST /api/calendar?action=smart-brain-weekly-recalibration`.
2. Reviewer checks calendar, cohorts, thresholds, competitive usage, and generated assets.
3. Reviewer records decisions and/or granular feedback through `action=feedback`.
4. The next daily run applies the updated feedback and any config changes.

## Phase 2 integration contract

Phase 2 platform push can consume the `platform_ready` object on each generated campaign:

- `google_ads[]`
- `meta_ads[]`
- `tiktok_ads[]`
- `lifecycle_messaging[]`

No refactor is needed: replace `push_status: not_integrated_phase_2` with a connector result after sending to the external platform.
