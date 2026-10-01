-- OrbitFS Base migration 20260923113703: lock_down_rls_auto_enable_rpc
-- Exported from the authoritative V1-vercel-base Supabase migration history.

REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon, authenticated;
