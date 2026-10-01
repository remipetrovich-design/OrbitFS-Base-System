-- OrbitFS normalized state RPC compatibility layer.
-- Required by src/lib/server/supabase.ts on current Base.
-- Safe/idempotent for fresh or rebuilt Supabase projects.

create or replace function public.orbitfs_library_object_id(p_payload jsonb, p_position integer)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when jsonb_typeof(p_payload)='object'
      and p_payload ? 'id'
      and nullif(p_payload->>'id','') is not null
      then p_payload->>'id'
    else '__pos:' || p_position::text
  end
$$;

create or replace function public.orbitfs_library_state_get(p_workspace_id text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare v_state jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('orbitfs_library:' || p_workspace_id,0));

  select state into v_state
  from public.orbitfs_library_state
  where workspace_id=p_workspace_id
  limit 1;
  return v_state;
end;
$$;

create or replace function public.orbitfs_library_state_patch(
  p_workspace_id text,
  p_upserts jsonb default '[]'::jsonb,
  p_deletes jsonb default '[]'::jsonb,
  p_meta jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_state jsonb;
  v_bucket text;
  v_bucket_state jsonb;
  v_now text := to_jsonb(now()) #>> '{}';
begin
  select state into v_state
  from public.orbitfs_library_state
  where workspace_id=p_workspace_id
  for update;

  if v_state is null then
    v_state := jsonb_build_object(
      'version',coalesce((p_meta->>'version')::int,9),
      'workspaceId',p_workspace_id,
      'items','[]'::jsonb,'collections','[]'::jsonb,'groups','[]'::jsonb,
      'categories','[]'::jsonb,'links','[]'::jsonb,'usage','[]'::jsonb,
      'sections','[]'::jsonb,'events','[]'::jsonb,'sourceHistory','[]'::jsonb,
      'autoLinks','[]'::jsonb,'entities','[]'::jsonb,'entityMentions','[]'::jsonb,
      'facts','[]'::jsonb,'factRelations','[]'::jsonb,'records','[]'::jsonb,
      'changeRequests','[]'::jsonb,
      'settings',coalesce(p_meta->'settings','{}'::jsonb),
      'createdAt',v_now,'updatedAt',v_now
    );
  end if;

  foreach v_bucket in array array[
    'items','collections','groups','categories','links','usage','sections','events',
    'sourceHistory','autoLinks','entities','entityMentions','facts','factRelations',
    'records','changeRequests'
  ]
  loop
    with existing as (
      select e.value as payload,(e.ordinality-1)::int as position,
             public.orbitfs_library_object_id(e.value,(e.ordinality-1)::int) as object_id
      from jsonb_array_elements(coalesce(v_state->v_bucket,'[]'::jsonb))
           with ordinality as e(value,ordinality)
    ),
    deletes as (
      select d->>'objectId' as object_id
      from jsonb_array_elements(coalesce(p_deletes,'[]'::jsonb)) d
      where d->>'bucket'=v_bucket
    ),
    upserts as (
      select u->'payload' as payload,coalesce((u->>'position')::int,0) as position,
             u->>'objectId' as object_id
      from jsonb_array_elements(coalesce(p_upserts,'[]'::jsonb)) u
      where u->>'bucket'=v_bucket
    ),
    combined as (
      select e.payload,e.position,e.object_id
      from existing e
      where not exists(select 1 from deletes d where d.object_id=e.object_id)
        and not exists(select 1 from upserts u where u.object_id=e.object_id)
      union all
      select u.payload,u.position,u.object_id from upserts u
    )
    select coalesce(jsonb_agg(payload order by position,object_id),'[]'::jsonb)
      into v_bucket_state
    from combined;

    v_state := jsonb_set(v_state,array[v_bucket],v_bucket_state,true);
  end loop;

  v_state := jsonb_set(v_state,'{workspaceId}',to_jsonb(p_workspace_id),true);
  if p_meta ? 'version' then v_state := jsonb_set(v_state,'{version}',p_meta->'version',true); end if;
  if p_meta ? 'settings' then v_state := jsonb_set(v_state,'{settings}',p_meta->'settings',true); end if;
  if not (v_state ? 'createdAt') then v_state := jsonb_set(v_state,'{createdAt}',to_jsonb(v_now),true); end if;
  v_state := jsonb_set(v_state,'{updatedAt}',to_jsonb(v_now),true);

  insert into public.orbitfs_library_state(workspace_id,state,updated_at)
  values(p_workspace_id,v_state,now())
  on conflict(workspace_id) do update
    set state=excluded.state,updated_at=excluded.updated_at;

  return v_state;
end;
$$;

create unique index if not exists ux_mcp_active_contexts_logical_context
  on public.mcp_active_contexts(user_id,client_id,workspace_id,context_key);

create or replace function public.orbitfs_mcp_context_item_key(p_payload jsonb, p_position integer)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when nullif(p_payload->>'knowledgeItemId','') is not null
      then 'knowledge:' || (p_payload->>'knowledgeItemId')
    when nullif(p_payload->>'profileId','') is not null
      then 'profile:' || (p_payload->>'profileId')
    when nullif(trim(both '/' from lower(coalesce(p_payload->>'path',''))),'') is not null
      then 'path:' || trim(both '/' from lower(p_payload->>'path'))
    else 'item:' || p_position::text
  end
$$;

create or replace function public.orbitfs_mcp_context_get(
  p_user_id text,p_client_id text,p_workspace_id text,p_context_key text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare v_receipt jsonb;
begin
  select receipt into v_receipt
  from public.mcp_active_contexts
  where user_id=p_user_id and client_id=p_client_id
    and workspace_id=p_workspace_id and context_key=p_context_key
  order by updated_at desc
  limit 1;
  return v_receipt;
end;
$$;

create or replace function public.orbitfs_mcp_context_patch(
  p_user_id text,p_client_id text,p_workspace_id text,p_context_key text,
  p_header jsonb default '{}'::jsonb,
  p_upserts jsonb default '[]'::jsonb,
  p_deletes jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id text;
  v_receipt jsonb;
  v_files jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'orbitfs_mcp_context:' || coalesce(p_user_id,'') || ':' || coalesce(p_client_id,'') || ':' || coalesce(p_workspace_id,'') || ':' || coalesce(p_context_key,''),
    0
  ));

  select id,receipt into v_id,v_receipt
  from public.mcp_active_contexts
  where user_id=p_user_id and client_id=p_client_id
    and workspace_id=p_workspace_id and context_key=p_context_key
  order by updated_at desc
  limit 1
  for update;

  v_receipt := coalesce(v_receipt,'{}'::jsonb);

  with existing as (
    select e.value as payload,(e.ordinality-1)::int as position,
           public.orbitfs_mcp_context_item_key(e.value,(e.ordinality-1)::int) as item_key
    from jsonb_array_elements(coalesce(v_receipt->'files','[]'::jsonb))
         with ordinality as e(value,ordinality)
  ),
  deletes as (
    select value #>> '{}' as item_key
    from jsonb_array_elements(coalesce(p_deletes,'[]'::jsonb))
  ),
  upserts as (
    select u->'payload' as payload,coalesce((u->>'position')::int,0) as position,
           u->>'itemKey' as item_key
    from jsonb_array_elements(coalesce(p_upserts,'[]'::jsonb)) u
  ),
  combined as (
    select e.payload,e.position,e.item_key
    from existing e
    where not exists(select 1 from deletes d where d.item_key=e.item_key)
      and not exists(select 1 from upserts u where u.item_key=e.item_key)
    union all
    select u.payload,u.position,u.item_key from upserts u
  )
  select coalesce(jsonb_agg(payload order by position,item_key),'[]'::jsonb)
    into v_files
  from combined;

  v_receipt := coalesce(p_header,'{}'::jsonb) || jsonb_build_object('files',v_files);

  if v_id is null then
    insert into public.mcp_active_contexts(
      user_id,client_id,workspace_id,context_key,receipt,created_at,updated_at
    ) values (
      p_user_id,p_client_id,p_workspace_id,p_context_key,v_receipt,now(),now()
    )
    on conflict(user_id,client_id,workspace_id,context_key) do update
      set receipt=excluded.receipt,updated_at=excluded.updated_at
    returning id into v_id;
  else
    update public.mcp_active_contexts set receipt=v_receipt,updated_at=now() where id=v_id;
  end if;

  return v_receipt;
end;
$$;

create or replace function public.orbitfs_mcp_context_clear(
  p_user_id text,p_client_id text,p_workspace_id text,p_context_key text
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  delete from public.mcp_active_contexts
  where user_id=p_user_id and client_id=p_client_id
    and workspace_id=p_workspace_id and context_key=p_context_key;
  return true;
end;
$$;

revoke all on function public.orbitfs_library_object_id(jsonb,integer) from public,anon,authenticated;
revoke all on function public.orbitfs_library_state_get(text) from public,anon,authenticated;
revoke all on function public.orbitfs_library_state_patch(text,jsonb,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.orbitfs_mcp_context_item_key(jsonb,integer) from public,anon,authenticated;
revoke all on function public.orbitfs_mcp_context_get(text,text,text,text) from public,anon,authenticated;
revoke all on function public.orbitfs_mcp_context_patch(text,text,text,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.orbitfs_mcp_context_clear(text,text,text,text) from public,anon,authenticated;

grant execute on function public.orbitfs_library_object_id(jsonb,integer) to service_role;
grant execute on function public.orbitfs_library_state_get(text) to service_role;
grant execute on function public.orbitfs_library_state_patch(text,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.orbitfs_mcp_context_item_key(jsonb,integer) to service_role;
grant execute on function public.orbitfs_mcp_context_get(text,text,text,text) to service_role;
grant execute on function public.orbitfs_mcp_context_patch(text,text,text,text,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.orbitfs_mcp_context_clear(text,text,text,text) to service_role;

notify pgrst,'reload schema';


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
