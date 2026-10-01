-- OrbitFS Base migration 20260923133536: orbitfs_base_initialize_workspace_state
-- Exported from the authoritative V1-vercel-base Supabase migration history.

do $$
declare w text; u text;
begin
 select id into w from public.orbitfs_workspaces where is_main=true order by created_at limit 1;
 select id into u from public.orbitfs_users where status='active' order by created_at limit 1;
 if w is not null then
  insert into public.orbitfs_library_state(workspace_id,state,updated_at)
  values(w,jsonb_build_object('version',9,'workspaceId',w,'items','[]'::jsonb,'collections','[]'::jsonb,'groups','[]'::jsonb,'categories','[]'::jsonb,'links','[]'::jsonb,'usage','[]'::jsonb,'sections','[]'::jsonb,'events','[]'::jsonb,'sourceHistory','[]'::jsonb,'autoLinks','[]'::jsonb,'entities','[]'::jsonb,'entityMentions','[]'::jsonb,'facts','[]'::jsonb,'factRelations','[]'::jsonb,'records','[]'::jsonb,'changeRequests','[]'::jsonb,'settings',jsonb_build_object('freshnessMs',30000,'maxFreshRefresh',100,'ingestMaxItems',1000,'ingestBatch',100,'autoIndexKnowledge',true,'retrievalLimit',12,'retrievalMaxChars',12000,'analysisMaxItems',250,'analysisMaxCharacters',1500000),'createdAt',now(),'updatedAt',now()),now())
  on conflict(workspace_id) do nothing;
  if u is not null then
   insert into public.orbitfs_profile_state(workspace_id,user_id,state,updated_at)
   values(w,u,jsonb_build_object('version',2,'enabled',false,'settings',jsonb_build_object('startupMode','summary','loadUserSlots',true,'loadWorkspaceProfiles','[]'::jsonb,'maxProfiles',20,'maxProfileSizeBytes',52428800,'maxTotalProfileStorageBytes',0),'roleOverrides','{}'::jsonb,'memberOverrides','{}'::jsonb,'profileTypes','[]'::jsonb,'profiles','[]'::jsonb,'profileBundles','[]'::jsonb,'userSlots','{}'::jsonb,'profileEditRequests','[]'::jsonb,'audit','[]'::jsonb),now())
   on conflict(workspace_id,user_id) do nothing;
  end if;
 end if;
end $$;
