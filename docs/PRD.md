# VAHDAM Lifecycle OS — Product Requirements Document

**Status:** Draft v0.1 · **Owner:** Anchit Tandon · **Last updated:** 2026-06-04

---

## 1. Vision

A single internal workspace for VAHDAM's retention + acquisition growth team that closes the
loop from **insight → plan → creative → competitive intelligence**, with everything running
inside one application instead of a scatter of separate tools and tabs.

> Read your data → see what competitors are doing → plan the calendar → write the email or ad →
> ship the landing page. One app, one design system, one login.

## 2. Problem statement

Today the work is spread across disconnected projects (a dashboard here, a mailer studio there,
a separately-deployed competitor hub, ad-hoc spreadsheets for paid campaigns). The team:

- re-derives the same context in every tool,
- has no single place to navigate between features,
- can't see competitor activity (email **and** ads) alongside their own plan,
- has no shared, brand-locked knowledge base to train creative generation, and
- relies on fragile, manual data syncs.

**Lifecycle OS** consolidates these into one Vercel-hosted app with a persistent left-hand
navigation, a consistent dark design system, and shared data/AI services.

## 3. Goals & non-goals

**Goals**
- One app, one nav, one design language across every feature.
- Each feature reachable in ≤2 clicks; a quick **Preview** and a full **View in Detail** for each.
- Competitor intelligence covering **both mailers and ads**.
- Near-real-time competitor mail capture.
- A reusable **design/style knowledge base** that feeds campaign creation.
- Stay within Vercel Hobby limits where possible; have a clear path to Pro when not.

**Non-goals (for now)**
- Becoming the system of record for sends (ESP stays the source of truth for delivery).
- Replacing the ad platforms' native managers — we plan/brief, we don't buy media in-app.
- Public/multi-tenant use — this is an internal tool for the growth team.

## 4. Personas

| Persona | Needs |
|---|---|
| **Retention manager** | Read RFM/cohort analysis, plan the 30-day calendar, trigger mailers. |
| **Creative / copy** | Brand-locked mailer + ad copy generation, the design knowledge base. |
| **Growth / paid lead** | Plan Google/Meta campaigns + landing pages on one calendar. |
| **Competitive analyst** | Browse competitor mailers + ads, track promo cadence and creative. |

## 5. Architecture

### 5.1 Shape
- **Primary app** (`vahdam-lifecycle-os`, this repo): static HTML pages + Vercel serverless
  functions under `/api`, deployed on Vercel. Shared chrome injected by `auth.js`.
- **Competitor Intelligence Hub** (`competitor-intelligence-hub/`, Next.js): owns the email
  sync engine + Google Sheets/Drive storage; currently a **separate Vercel deploy**, read by the
  main app cross-origin. **Planned: merge into the primary app** (see §10).
- **Shared services:** `/api/ai/*` (6-provider LLM waterfall), `/api/calendar/*`, Supabase
  (auth + profiles), Google Sheets/Drive (competitor storage).

### 5.2 Navigation & UX system
- **Double-layer left navigation** (in `auth.js`, injected on every page):
  - *Tier 1* — top-level features always visible: Home · Data Analysis · Competitor
    Benchmarking · Marketing Mailers · Ad Campaigns.
  - *Tier 2* — each feature's sub-sections shown beneath it (e.g. Competitor → Mailers/Ads;
    Ad Campaigns → Calendar/Google/Meta/Landing). Active feature + sub-section highlighted.
  - Off-canvas drawer + hamburger on mobile.
- **Preview / View-in-Detail pattern:** every feature offers a quick **Preview** (popup modal
  with a live iframe) and **View in Detail** (full page). No more half-views.
- **Design system:** dark theme — `#0a1410` bg, forest `#004A2B`, gold `#AB8743`, cream
  `#FBF5EA`; Lora (headings) + Inter (body). Brand voice + palette per the style guide.

### 5.3 Constraints
- **Vercel Hobby caps a project at 12 Serverless Functions.** The primary app sits at 11.
  Consolidating heavier backends requires consolidating endpoints into catch-all functions or
  upgrading to Pro.
- LLM/image providers run as a waterfall (OpenAI → Anthropic → Gemini → Grok → Groq → Cerebras)
  with quota/billing fallbacks; image gen Gemini → OpenAI → Pollinations.

## 6. Feature specs

### 6.1 Data Analysis (`/dashboard.html`)
RFM segmentation, cohort retention, channel mix, cross-sell, send-time behavior, strategic
insights, export (CSV/colour-preserving XLSX).
- **Data sources:** synthetic seed · **upload CSV/XLSX** (with *append-to-current* or replace)
  · **Link a database** (JSON/REST endpoint or Supabase REST) — when linked, analysis is
  **scoped to that database only** until reset.
- *Future:* saved data-source connections; scheduled refresh; warehouse connectors (BigQuery/
  Snowflake) via a server proxy (browser can't hold warehouse creds).

### 6.2 Competitor Benchmarking (`/competitor-benchmarking.html`)
Two sub-sections (Tier-2 nav + in-page tabs):
- **Mailers** — every competitor email captured automatically: brand, subject, promo codes,
  **full HTML + screenshot + attachments stored per mail**. Live polling (45s), newest-first,
  Preview popup + View-in-Detail full page.
- **Ads** — browse competitor ads from **free public libraries**: Meta Ad Library, Google Ads
  Transparency Center, TikTok Creative Center, deep-linked per tracked brand + region. Tracked
  brand list is editable/persisted. *Future:* automated capture + storage of ad creatives
  (mirroring the mailer pipeline).

### 6.3 Marketing Mailers
- **Calendar** (`/calendar.html`) — 30-day plan: segment × market × day, festival-weighted,
  send-time tuned, one-click → build.
- **Mailers / Studio** (`/studio`) — the 6-LLM cascade: two types, two variants each,
  brand-locked, 11 archetypes, score + audit + export HTML.

### 6.4 Ad Campaigns (`/ad-campaigns.html`)
Tabs: **Calendar** (cross-channel scheduling) · **Google Ads** · **Meta Ads** · **Landing
Pages** (brand-styled builder + HTML preview). AI copy drafting via `/api/ai/generate`.
localStorage-backed today; *future:* server persistence + platform export.

## 7. Data & sync strategy

### 7.1 Competitor mail capture (current)
Gmail **IMAP** (`imapflow`) fetches UNSEEN mail → extract → upload assets + screenshot to Drive
→ append row to Google Sheet. Read API: `/api/emails` (+ `/api/emails/:id` for full HTML).

### 7.2 Near-real-time (implemented)
- *Frontend:* dashboard polls `/api/emails` every 45s, live-updates, pauses when hidden.
- *Backend:* `/api/emails` opportunistically kicks a **throttled background sync** via Next
  `after()` — so an open dashboard keeps mail flowing without an external cron.

### 7.3 Sync options going forward
| Option | Latency | Notes |
|---|---|---|
| Poll + opportunistic sync (now) | ~45–60s while open | no external infra |
| External 1-min cron (cron-job.org) | ~1 min | works when nobody's looking; off-platform (Hobby cron = daily) |
| **Gmail API push** (`watch` + Pub/Sub → webhook) | instant | best; needs GCP Pub/Sub + OAuth/service-account + 7-day watch renewal |
| **Claude Gmail connector via scheduled routine** | minutes | simplest to stand up; an agent on a cron reads Gmail + writes to the hub. *Not* a server process — runs as a scheduled Claude agent. Good for low volume / bootstrap. |

> Decision (current): keep poll+opportunistic for in-session freshness; stand up the **Claude
> connector scheduled routine** as the simple always-on path; graduate to **Gmail API push** if
> volume/latency demand it.

## 8. Future problems & mitigations

### 8.1 Cron monitoring of 50+ websites across regions (for fresh mailers)
**Problem:** to keep mailers current we must regularly subscribe to / pull from 50+ competitor
sources across regions; a single inbox + single cron won't scale and will hit blocks/limits.

**Risks & mitigations**
- **Throughput / function timeouts:** 50 sources × screenshot rendering can blow past the 60s
  function limit and the Hobby 12-function cap. → Split into a **queue + worker** model: a
  scheduler enqueues sources; a worker processes N per invocation; idempotent, resumable. Move
  heavy rendering off the request path.
- **Inbox-based capture doesn't cover sites that don't email:** for site-published mailers/promos
  use a **headless-browser crawler** (Playwright) on a schedule per source.
- **Anti-bot / rate limits / IP blocks:** stagger schedules, rotate user-agents, respect
  robots/ToS, back off on 429s, regionalize via proxies where lawful. Never hammer.
- **Regionalization:** per-source `region` + locale; schedule in the source's timezone; store
  region on every captured artifact for filtering.
- **Cost & platform limits:** screenshots + storage + LLM tagging at 50× scale cost real money
  and exceed Hobby/Drive quotas → see §8.4. Likely triggers **Vercel Pro + dedicated storage**.
- **Legal/ToS:** scraping has ToS/copyright considerations; store for internal benchmarking only,
  attribute sources, and keep a takedown path. Confirm with legal before scaling.

### 8.2 Design & style knowledge base (to train/seed campaign creation)
**Problem:** we want a structured, growing library of designs/styles (ours + best-in-class) that
can be referenced and used to train/seed campaign generation.

**Proposed model**
- **Schema per asset:** source, brand, channel (email/ad/LP), region, archetype/layout,
  palette, typography, hero pattern, copy angle, offer mechanic, performance (if known), tags,
  and the stored artifact (HTML + screenshot + extracted structure).
- **Ingestion:** feed from Competitor Benchmarking (mailers + ads) + our own Studio outputs +
  curated uploads. Auto-tag with the LLM (archetype, palette, tone) on capture.
- **Storage/retrieval:** structured store + **vector embeddings** for "find designs like this";
  expose as a browsable gallery + an API the Studio/Ad builder calls for few-shot examples.
- **Use in generation:** retrieval-augmented prompts — pull k brand-compliant exemplars by
  archetype/market and condition the generator on them; never copy, only learn patterns.
- **Risks:** brand drift (enforce palette/voice guardrails), copyright (internal-only, learn-not-
  copy), tagging quality (human-in-the-loop review queue), embedding/storage cost at scale.

### 8.3 Competitor Ads expansion (Meta Ad Library + free sources)
**Problem:** the Ads section currently deep-links to free libraries; we want stored, searchable
ad creatives like we have for mailers.
- **Meta Ad Library API:** free but the public API is largely limited to political/issue ads;
  full commercial coverage is via the web UI (no official bulk API). → Combine **deep links**
  (now) with a **headless crawler** for commercial ads where ToS allows; treat Meta's API as
  partial coverage.
- **Other free sources:** Google Ads Transparency Center, TikTok Creative Center, brand social
  pages. Each has different access + structure → per-source adapters with a common ad schema.
- **Storage:** mirror the mailer pipeline (creative image/video + landing URL + copy + first/last
  seen + region) into the same knowledge base (§8.2).

### 8.4 Cross-cutting platform risks
- **Vercel Hobby 12-function cap:** merging the hub + crawlers will exceed it. → Consolidate
  endpoints into catch-all routes and/or move to **Vercel Pro**. Decide before the hub merge.
- **Storage quota:** service-account Drive has no quota on personal Google accounts (already a
  known issue → HCTI screenshot fallback). At 50× scale, move artifacts to **Vercel Blob / S3 /
  R2** with a CDN.
- **Secrets & auth:** never ship keys to the browser; all provider/DB/crawler creds stay server-
  side. Add per-user roles if access widens.
- **Observability:** add sync run logs, success/error counts, freshness ("last captured" per
  source), and alerting on failures — otherwise "sync not working" is invisible until noticed.
- **Dedupe & data quality:** robust keys (sender|subject|date for mail; advertiser|creative-hash
  for ads); normalize regions/brands.
- **Gmail watch renewal:** if we adopt push, the `watch` expires every 7 days — needs a renewal
  cron + alert.

## 9. Success metrics
- Time-to-first-insight and time-to-build-a-mailer (down).
- % of campaigns created with knowledge-base exemplars.
- Competitor coverage: # sources, # ads + mailers captured/week, capture freshness.
- Sync reliability: % successful runs, median capture latency.
- Adoption: weekly active growth-team users, features used per session.

## 10. Roadmap

**Phase 0 — Consolidation (done / in progress)**
- ✅ Unified left-hand double-layer nav across all pages.
- ✅ Preview / View-in-Detail pattern; consistent dark design system.
- ✅ Competitor Benchmarking restyle + Mailers/Ads sections.
- ✅ Data Analysis: upload-append + link-database (scoped).
- ✅ Ad Campaigns (Calendar/Google/Meta/Landing) scaffold.
- ✅ Near-real-time mail sync (poll + opportunistic background sync).

**Phase 1 — True single app**
- Merge `competitor-intelligence-hub` into this repo (consolidate functions ≤12 or move to Pro);
  retire the separate deployment.
- Stand up the chosen always-on mail sync (connector routine and/or Gmail push).

**Phase 2 — Scale competitor intelligence**
- Queue+worker crawler for 50+ sources across regions (mailers + ads).
- Move artifact storage to Blob/S3/R2 + CDN; add observability + alerting.

**Phase 3 — Knowledge base & RAG creation**
- Design/style schema + auto-tagging + embeddings + gallery.
- Retrieval-augmented generation wired into Studio + Ad builder.

**Phase 4 — Server persistence & platform export**
- Move Ad Campaigns / Landing Pages off localStorage to server storage.
- Export briefs/creatives to Google/Meta where APIs allow.

## 11. Open questions
- Do we move to **Vercel Pro** now (unblocks the hub merge + crawlers) or keep optimizing within Hobby?
- Which Gmail auth model for push — **service account + domain delegation** or an **OAuth refresh token** on the capture inbox?
- Storage target for scale — **Vercel Blob**, **S3**, or **Cloudflare R2**?
- What's the canonical list of the **50+ competitor sources** and their regions?
- Legal sign-off scope for crawling/storing competitor creatives.
