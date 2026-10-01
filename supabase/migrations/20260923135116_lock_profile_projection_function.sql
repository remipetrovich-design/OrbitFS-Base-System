-- OrbitFS Base migration 20260923135116: lock_profile_projection_function
-- Exported from the authoritative V1-vercel-base Supabase migration history.

revoke all on function public.sync_orbitfs_profiles_projection() from public; revoke all on function public.sync_orbitfs_profiles_projection() from anon; revoke all on function public.sync_orbitfs_profiles_projection() from authenticated;
