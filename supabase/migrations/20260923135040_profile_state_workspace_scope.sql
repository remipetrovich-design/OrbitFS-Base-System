-- OrbitFS Base migration 20260923135040: profile_state_workspace_scope
-- Exported from the authoritative V1-vercel-base Supabase migration history.

-- Profile state is workspace-scoped canonical state. It contains all profiles,
-- bundles, permissions and user-slot mappings for the workspace, so there must
-- be exactly one canonical state row per workspace.
do $$
declare keep_id text;
begin
  for keep_id in
    select id from public.orbitfs_profile_state
    where workspace_id in (
      select workspace_id from public.orbitfs_profile_state
      group by workspace_id having count(*) > 1
    )
    order by updated_at desc
  loop
    -- no-op loop body; duplicates are handled below
    null;
  end loop;

  delete from public.orbitfs_profile_state a
  using public.orbitfs_profile_state b
  where a.workspace_id=b.workspace_id
    and a.updated_at < b.updated_at;

  delete from public.orbitfs_profile_state a
  using public.orbitfs_profile_state b
  where a.workspace_id=b.workspace_id
    and a.updated_at=b.updated_at
    and a.id < b.id;
end $$;

alter table public.orbitfs_profile_state
  drop constraint if exists orbitfs_profile_state_workspace_id_user_id_key;

alter table public.orbitfs_profile_state
  add constraint orbitfs_profile_state_workspace_id_key unique (workspace_id);
