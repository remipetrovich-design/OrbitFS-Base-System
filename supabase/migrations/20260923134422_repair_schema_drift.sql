-- OrbitFS Base migration 20260923134422: repair_schema_drift
-- Exported from the authoritative V1-vercel-base Supabase migration history.

alter table public.orbitfs_settings drop constraint if exists orbitfs_settings_scope_key_key;
alter table public.orbitfs_workspace_members drop constraint if exists orbitfs_workspace_members_workspace_user_key;
revoke execute on function public.rls_auto_enable() from public;
revoke execute on function public.rls_auto_enable() from anon;
revoke execute on function public.rls_auto_enable() from authenticated;
