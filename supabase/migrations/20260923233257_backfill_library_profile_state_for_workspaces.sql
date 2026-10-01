-- OrbitFS Base migration 20260923233257: backfill_library_profile_state_for_workspaces
-- Exported from the authoritative V1-vercel-base Supabase migration history.

with fallback_user as (
  select id from public.orbitfs_users where status='active' order by created_at limit 1
)
insert into public.orbitfs_library_state(workspace_id,state,updated_at)
select
  w.id,
  jsonb_build_object(
    'version',9,'workspaceId',w.id,
    'items','[]'::jsonb,'collections','[]'::jsonb,'groups','[]'::jsonb,'categories','[]'::jsonb,
    'links','[]'::jsonb,'usage','[]'::jsonb,'sections','[]'::jsonb,'events','[]'::jsonb,
    'sourceHistory','[]'::jsonb,'autoLinks','[]'::jsonb,'entities','[]'::jsonb,'entityMentions','[]'::jsonb,
    'facts','[]'::jsonb,'factRelations','[]'::jsonb,'records','[]'::jsonb,'changeRequests','[]'::jsonb,
    'settings',jsonb_build_object(
      'freshnessMs',30000,'maxFreshRefresh',100,'ingestMaxItems',1000,'ingestBatch',100,
      'autoIndexKnowledge',true,'retrievalLimit',12,'retrievalMaxChars',12000,
      'analysisMaxItems',250,'analysisMaxCharacters',1500000
    ),
    'createdAt',now(),'updatedAt',now()
  ),
  now()
from public.orbitfs_workspaces w
where w.status <> 'archived'
and not exists(select 1 from public.orbitfs_library_state s where s.workspace_id=w.id);

with fallback_user as (
  select id from public.orbitfs_users where status='active' order by created_at limit 1
)
insert into public.orbitfs_profile_state(workspace_id,user_id,state,created_at,updated_at)
select
  w.id,
  coalesce(w.owner_id,w.created_by,(select id from fallback_user)),
  jsonb_build_object(
    'version',2,'enabled',false,
    'settings',jsonb_build_object(
      'startupMode','summary','loadUserSlots',true,'loadWorkspaceProfiles','[]'::jsonb,
      'maxProfiles',20,'maxProfileSizeBytes',52428800,'maxTotalProfileStorageBytes',0
    ),
    'roleOverrides','{}'::jsonb,'memberOverrides','{}'::jsonb,'profileTypes','[]'::jsonb,
    'profiles','[]'::jsonb,'profileBundles','[]'::jsonb,'userSlots','{}'::jsonb,
    'profileEditRequests','[]'::jsonb,'audit','[]'::jsonb
  ),
  now(),now()
from public.orbitfs_workspaces w
where w.status <> 'archived'
and not exists(select 1 from public.orbitfs_profile_state s where s.workspace_id=w.id);
