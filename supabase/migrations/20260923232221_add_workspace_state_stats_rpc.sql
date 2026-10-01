-- OrbitFS Base migration 20260923232221: add_workspace_state_stats_rpc
-- Exported from the authoritative V1-vercel-base Supabase migration history.

create or replace function public.orbitfs_workspace_state_stats(p_workspace_id text)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with library as (
    select state
    from public.orbitfs_library_state
    where workspace_id=p_workspace_id
    limit 1
  ),
  profile as (
    select state
    from public.orbitfs_profile_state
    where workspace_id=p_workspace_id
    limit 1
  )
  select jsonb_build_object(
    'libraryBytes', coalesce((select octet_length(state::text) from library),0),
    'profileBytes', coalesce((select octet_length(state::text) from profile),0),
    'files', coalesce((select case when jsonb_typeof(state->'items')='array' then jsonb_array_length(state->'items') else 0 end from library),0),
    'folders', coalesce((select case when jsonb_typeof(state->'collections')='array' then jsonb_array_length(state->'collections') else 0 end from library),0),
    'libraryItems', coalesce((select case when jsonb_typeof(state->'items')='array' then jsonb_array_length(state->'items') else 0 end from library),0),
    'libraryCollections', coalesce((select case when jsonb_typeof(state->'collections')='array' then jsonb_array_length(state->'collections') else 0 end from library),0),
    'libraryRecords', coalesce((select case when jsonb_typeof(state->'records')='array' then jsonb_array_length(state->'records') else 0 end from library),0),
    'libraryEvents', coalesce((select case when jsonb_typeof(state->'events')='array' then jsonb_array_length(state->'events') else 0 end from library),0)
  )
$$;

revoke all on function public.orbitfs_workspace_state_stats(text) from public,anon,authenticated;
grant execute on function public.orbitfs_workspace_state_stats(text) to service_role;
notify pgrst,'reload schema';
