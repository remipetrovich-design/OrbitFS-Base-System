-- Keep the relational profile projection synchronized with the canonical
-- workspace profile state. Profile data remains owned by orbitfs_profile_state;
-- orbitfs_profiles is a compatibility/query projection for older panel APIs.

alter table public.orbitfs_profile_state
  add column if not exists created_at timestamptz not null default now();

create or replace function public.sync_orbitfs_profiles_projection()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.orbitfs_profiles where workspace_id = new.workspace_id;

  insert into public.orbitfs_profiles (
    id, workspace_id, name, type, status, classification, restricted, srestricted,
    fields, sections, editor_ids, viewer_ids, version, created_by, updated_by,
    deleted_at, created_at, updated_at
  )
  select
    coalesce(nullif(p->>'id',''), gen_random_uuid()::text),
    new.workspace_id,
    coalesce(nullif(p->>'name',''), 'Untitled profile'),
    coalesce(nullif(p->>'type',''), 'person'),
    coalesce(nullif(p->>'status',''), 'active'),
    coalesce(nullif(p->>'classification',''), 'standard'),
    coalesce((p->>'restricted')::boolean, false),
    coalesce((p->>'srestricted')::boolean, false),
    case when jsonb_typeof(p->'fields')='object' then p->'fields' else '{}'::jsonb end,
    case when jsonb_typeof(p->'sections')='array' then p->'sections' else '[]'::jsonb end,
    case when jsonb_typeof(p->'editorIds')='array' then p->'editorIds' else '[]'::jsonb end,
    case when jsonb_typeof(p->'viewerIds')='array' then p->'viewerIds' else '[]'::jsonb end,
    greatest(1, coalesce((p->>'version')::integer, 1)),
    nullif(p->>'createdBy',''),
    nullif(p->>'updatedBy',''),
    case when p->>'deletedAt' is null or p->>'deletedAt'='' then null else (p->>'deletedAt')::timestamptz end,
    coalesce((p->>'createdAt')::timestamptz, new.created_at),
    coalesce((p->>'updatedAt')::timestamptz, new.updated_at)
  from jsonb_array_elements(
    case when jsonb_typeof(new.state->'profiles')='array' then new.state->'profiles' else '[]'::jsonb end
  ) p
  where coalesce((p->>'deletedAt')::text,'') = '';

  return new;
end;
$$;

drop trigger if exists orbitfs_profile_state_projection on public.orbitfs_profile_state;
create trigger orbitfs_profile_state_projection
after insert or update of state, workspace_id
on public.orbitfs_profile_state
for each row execute function public.sync_orbitfs_profiles_projection();

revoke all on function public.sync_orbitfs_profiles_projection() from public;
revoke all on function public.sync_orbitfs_profiles_projection() from anon;
revoke all on function public.sync_orbitfs_profiles_projection() from authenticated;

-- Backfill the projection from the current canonical state.
delete from public.orbitfs_profiles;
insert into public.orbitfs_profiles (
  id, workspace_id, name, type, status, classification, restricted, srestricted,
  fields, sections, editor_ids, viewer_ids, version, created_by, updated_by,
  deleted_at, created_at, updated_at
)
select
  coalesce(nullif(p->>'id',''), gen_random_uuid()::text),
  s.workspace_id,
  coalesce(nullif(p->>'name',''), 'Untitled profile'),
  coalesce(nullif(p->>'type',''), 'person'),
  coalesce(nullif(p->>'status',''), 'active'),
  coalesce(nullif(p->>'classification',''), 'standard'),
  coalesce((p->>'restricted')::boolean, false),
  coalesce((p->>'srestricted')::boolean, false),
  case when jsonb_typeof(p->'fields')='object' then p->'fields' else '{}'::jsonb end,
  case when jsonb_typeof(p->'sections')='array' then p->'sections' else '[]'::jsonb end,
  case when jsonb_typeof(p->'editorIds')='array' then p->'editorIds' else '[]'::jsonb end,
  case when jsonb_typeof(p->'viewerIds')='array' then p->'viewerIds' else '[]'::jsonb end,
  greatest(1, coalesce((p->>'version')::integer, 1)),
  nullif(p->>'createdBy',''),
  nullif(p->>'updatedBy',''),
  case when p->>'deletedAt' is null or p->>'deletedAt'='' then null else (p->>'deletedAt')::timestamptz end,
  coalesce((p->>'createdAt')::timestamptz, s.updated_at),
  coalesce((p->>'updatedAt')::timestamptz, s.updated_at)
from public.orbitfs_profile_state s
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(s.state->'profiles')='array' then s.state->'profiles' else '[]'::jsonb end
) p
where coalesce((p->>'deletedAt')::text,'') = '';
