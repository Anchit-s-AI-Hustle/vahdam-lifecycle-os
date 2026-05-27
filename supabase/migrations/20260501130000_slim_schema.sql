-- ═══════════════════════════════════════════════════════════════════════════
-- VAHDAM Mailer Studio — slim schema (only what the app actually uses)
-- Applied 2026-05-01 13:50 UTC. Drops unused analytics views + catalog table.
-- The app reads/writes these two tables only:
--   • vahdam_campaigns  (saveMailerToDashboard inserts; renderDashboard reads)
--   • vahdam_users      (auth signup upsert)
-- ═══════════════════════════════════════════════════════════════════════════

-- Remove analytics views that no client code references
DROP VIEW  IF EXISTS public.vahdam_campaigns_by_type   CASCADE;
DROP VIEW  IF EXISTS public.vahdam_campaigns_by_user   CASCADE;
DROP VIEW  IF EXISTS public.vahdam_campaigns_by_market CASCADE;
DROP VIEW  IF EXISTS public.vahdam_campaigns_by_regen  CASCADE;

-- Remove catalog snapshots table — no client writes ever happened here
DROP TABLE IF EXISTS public.vahdam_catalog_snapshots CASCADE;

-- Remove legacy duplicate tables (replaced by vahdam_users / vahdam_campaigns)
DROP TABLE IF EXISTS public.app_users        CASCADE;
DROP TABLE IF EXISTS public.campaign_history CASCADE;

-- (vahdam_campaigns and vahdam_users remain unchanged with all their data)
