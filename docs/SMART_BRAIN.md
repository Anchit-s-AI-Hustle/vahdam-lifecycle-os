# VAHDAM Smart Brain MVP

This repo now includes a working, DB-linked Smart Brain for VAHDAM Lifecycle OS. It stops before live platform push: generated objects are platform-ready for Google, Meta, TikTok, Klaviyo, and WebEngage, but every object is marked `push_status: not_integrated_phase_2`.

## Service boundaries

| Service | File | Responsibility |
|---|---|---|
| Knowledge Base | `lib/smart-brain/services.js` | Ingests catalog, assets, campaigns, campaign-assets, metrics, users, and orders from the linked DB and indexes own campaigns with assets, hooks, formats, and creative-level rollups. |
| Data Analysis | `lib/smart-brain/services.js` | Builds cohorts, applies performance thresholds to own campaign history, scores products, summarizes MVT results, and emits daily insights. |
| Competitor Benchmarking | `lib/smart-brain/services.js` | Reads only the separate `smart_competitor_campaigns` stream and produces isolated channel/hook benchmarks. |
| Calendar Intelligence | `lib/smart-brain/services.js` | Creates a 15-day rolling plan by market/cohort/channel using own winners, seasonal moments, competitor context, feedback, and MVT plans. |
| Generation | `lib/smart-brain/services.js` | Produces HTML mailers, platform ad specs, landing pages, retargeting, similar-audience logic, and full-funnel campaign objects. |
| Human Review | `lib/smart-brain/services.js` | Enforces human verification for every campaign and a hard weekly recalibration checklist. |

<<<<<<< HEAD
The single serverless entrypoint is `api/smart-brain.js`.
=======
The Smart Brain is multiplexed through the existing `api/calendar.js` serverless function to keep the Vercel Hobby deployment under the 12-function cap.
>>>>>>> acdfe52a6c4ed835673c3b9e52cbe06da0f33c4b

## API

### Health

```http
<<<<<<< HEAD
GET /api/smart-brain?action=health
=======
GET /api/calendar?action=smart-brain-health
>>>>>>> acdfe52a6c4ed835673c3b9e52cbe06da0f33c4b
```

Returns module availability and whether Supabase DB env vars are linked.

### Schema contract

```http
<<<<<<< HEAD
GET /api/smart-brain?action=schema
=======
GET /api/calendar?action=smart-brain-schema
>>>>>>> acdfe52a6c4ed835673c3b9e52cbe06da0f33c4b
```

Returns expected table names and columns.

### Daily automated review + generation

```http
<<<<<<< HEAD
POST /api/smart-brain?action=run-daily
=======
POST /api/calendar?action=smart-brain-run-daily
>>>>>>> acdfe52a6c4ed835673c3b9e52cbe06da0f33c4b
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
<<<<<<< HEAD
POST /api/smart-brain?action=generate-slot
=======
POST /api/calendar?action=smart-brain-generate-slot
>>>>>>> acdfe52a6c4ed835673c3b9e52cbe06da0f33c4b
Content-Type: application/json

{ "entry": { ...calendarEntry } }
```

### Capture human feedback

```http
<<<<<<< HEAD
POST /api/smart-brain?action=feedback
=======
POST /api/calendar?action=smart-brain-feedback
>>>>>>> acdfe52a6c4ed835673c3b9e52cbe06da0f33c4b
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
<<<<<<< HEAD
POST /api/smart-brain?action=weekly-recalibration
=======
POST /api/calendar?action=smart-brain-weekly-recalibration
>>>>>>> acdfe52a6c4ed835673c3b9e52cbe06da0f33c4b
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

<<<<<<< HEAD
1. Scheduler calls `POST /api/smart-brain?action=run-daily` for a 15-day window.
=======
1. Scheduler calls `POST /api/calendar?action=smart-brain-run-daily` for a 15-day window.
>>>>>>> acdfe52a6c4ed835673c3b9e52cbe06da0f33c4b
2. Knowledge Base re-indexes own DB data and campaign assets.
3. Analysis rebuilds cohorts, product scores, thresholds, and MVT learnings.
4. Competitor Benchmarking pulls the separate competitive stream.
5. Calendar Intelligence regenerates the tentative rolling calendar.
6. Generation creates all campaign assets and platform-ready schemas.
7. Review keeps every campaign in a human-verification state before final launch.

## Weekly human loop

<<<<<<< HEAD
1. Lifecycle owner calls `POST /api/smart-brain?action=weekly-recalibration`.
=======
1. Lifecycle owner calls `POST /api/calendar?action=smart-brain-weekly-recalibration`.
>>>>>>> acdfe52a6c4ed835673c3b9e52cbe06da0f33c4b
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
