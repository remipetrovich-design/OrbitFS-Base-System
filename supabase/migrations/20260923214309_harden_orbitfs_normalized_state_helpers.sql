-- OrbitFS Base migration 20260923214309: harden_orbitfs_normalized_state_helpers
-- Exported from the authoritative V1-vercel-base Supabase migration history.

alter function public.orbitfs_library_object_id(jsonb,integer) set search_path = public;
alter function public.orbitfs_mcp_context_item_key(jsonb,integer) set search_path = public;
notify pgrst, 'reload schema';
