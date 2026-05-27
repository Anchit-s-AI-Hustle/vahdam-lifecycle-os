-- ═══════════════════════════════════════════════════════════════════════════
-- DB hygiene
-- 1. user_id FK on vahdam_campaigns → vahdam_users(id) (with email backfill)
-- 2. anon DELETE policy on campaigns
-- 3. Trigger that cleans Storage objects when a campaign row is deleted
-- 4. Tighten storage UPDATE (remove anon) — INSERT + SELECT only stay
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. user_id FK --------------------------------------------------------------
ALTER TABLE public.vahdam_campaigns
  ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES public.vahdam_users(id) ON DELETE SET NULL;

-- Backfill from email
UPDATE public.vahdam_campaigns c
   SET user_id = u.id
  FROM public.vahdam_users u
 WHERE c.user_email IS NOT NULL
   AND c.user_email = u.email
   AND c.user_id IS NULL;

CREATE INDEX IF NOT EXISTS vc_user_id_idx ON public.vahdam_campaigns(user_id);

-- 2. DELETE policy ----------------------------------------------------------
DROP POLICY IF EXISTS "anon delete campaigns" ON public.vahdam_campaigns;
CREATE POLICY "anon delete campaigns" ON public.vahdam_campaigns FOR DELETE USING (true);

-- 3. Storage cleanup trigger ------------------------------------------------
-- When a campaign row is deleted, remove any storage objects we hosted for it.
-- Storage objects live as rows in storage.objects keyed by (bucket_id, name).
-- Our hosted URLs look like: https://<proj>.supabase.co/storage/v1/object/public/mailer-assets/<path>
CREATE OR REPLACE FUNCTION public.vahdam_campaign_cleanup_storage()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  url_prefix TEXT := '/storage/v1/object/public/mailer-assets/';
  v_url TEXT;
  v_path TEXT;
  v_key TEXT;
BEGIN
  -- canvas_image_url, thumbnail_url, hero_image_url (only the canvas one is OURS,
  -- but we accept the others if they happen to live in the bucket too)
  FOREACH v_url IN ARRAY ARRAY[OLD.canvas_image_url, OLD.thumbnail_url] LOOP
    IF v_url IS NOT NULL AND v_url <> '' AND position(url_prefix in v_url) > 0 THEN
      v_path := substring(v_url FROM position(url_prefix in v_url) + length(url_prefix));
      DELETE FROM storage.objects WHERE bucket_id='mailer-assets' AND name=v_path;
    END IF;
  END LOOP;
  -- mailer_image_urls is a JSONB matrix {mkt:{A:url,B:url}}
  IF OLD.mailer_image_urls IS NOT NULL THEN
    FOR v_key IN SELECT jsonb_object_keys(OLD.mailer_image_urls) LOOP
      FOR v_url IN SELECT jsonb_path_query_array(OLD.mailer_image_urls -> v_key, '$.*')::jsonb LOOP
        -- skip — handled below via path query directly
      END LOOP;
    END LOOP;
    FOR v_url IN
      SELECT value::text
        FROM jsonb_each(OLD.mailer_image_urls) e1,
             jsonb_each_text(e1.value) e2(k,value)
    LOOP
      IF v_url IS NOT NULL AND v_url <> '' AND position(url_prefix in v_url) > 0 THEN
        v_path := substring(v_url FROM position(url_prefix in v_url) + length(url_prefix));
        DELETE FROM storage.objects WHERE bucket_id='mailer-assets' AND name=v_path;
      END IF;
    END LOOP;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS vahdam_campaigns_cleanup ON public.vahdam_campaigns;
CREATE TRIGGER vahdam_campaigns_cleanup
  AFTER DELETE ON public.vahdam_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.vahdam_campaign_cleanup_storage();

-- 4. Tighten storage policies — drop anon UPDATE (INSERT + SELECT remain) ---
DROP POLICY IF EXISTS "anon update mailer-assets" ON storage.objects;
