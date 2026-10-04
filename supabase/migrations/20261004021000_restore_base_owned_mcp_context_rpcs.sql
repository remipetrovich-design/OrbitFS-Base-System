-- OrbitFS Base migration 20261004021000: restore_base_owned_mcp_context_rpcs
-- Restores Base-owned normalized MCP context helpers for installations created
-- while the fresh-schema component splitter incorrectly removed orbitfs_mcp_*
-- routines. These functions are intentionally Base-owned; MCP owns the backing
-- component tables and grants runtime access in its own migration package.

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

revoke all on function public.orbitfs_mcp_context_item_key(jsonb,integer) from public,anon,authenticated;
revoke all on function public.orbitfs_mcp_context_get(text,text,text,text) from public,anon,authenticated;
revoke all on function public.orbitfs_mcp_context_patch(text,text,text,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.orbitfs_mcp_context_clear(text,text,text,text) from public,anon,authenticated;

grant execute on function public.orbitfs_mcp_context_item_key(jsonb,integer) to service_role;
grant execute on function public.orbitfs_mcp_context_get(text,text,text,text) to service_role;
grant execute on function public.orbitfs_mcp_context_patch(text,text,text,text,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.orbitfs_mcp_context_clear(text,text,text,text) to service_role;

notify pgrst,'reload schema';
