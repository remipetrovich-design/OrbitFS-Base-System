-- OrbitFS Base migration 20261002070000: repair_runtime_secret_table_access
-- Forward-only repair for the Shared Engine runtime database contract.
--
-- The Engine intentionally runs with the customer Supabase publishable key plus
-- ORBITFS_DB_SECRET. PostgreSQL table privileges must therefore allow the
-- anon/authenticated roles to reach RLS; row access remains gated by the
-- x-orbitfs-secret policy. The service-role key stays in the Panel/Base only.

-- The probe is a one-row RLS-protected table instead of a privileged public
-- RPC. A correct x-orbitfs-secret reveals the sentinel row; a missing/invalid
-- secret reveals no rows. This tests the exact Data API/RLS path used by the
-- Shared Engine without exposing a SECURITY DEFINER function to anon.
drop function if exists public.orbitfs_runtime_access_probe();

create table if not exists public.orbitfs_runtime_secret_probe (
  probe_key text primary key,
  contract_version integer not null default 1,
  constraint orbitfs_runtime_secret_probe_key_check check (probe_key = 'runtime'),
  constraint orbitfs_runtime_secret_probe_version_check check (contract_version = 1)
);

insert into public.orbitfs_runtime_secret_probe(probe_key,contract_version)
values ('runtime',1)
on conflict (probe_key) do update
set contract_version=excluded.contract_version;

alter table public.orbitfs_runtime_secret_probe enable row level security;
drop policy if exists "orbitfs runtime secret probe" on public.orbitfs_runtime_secret_probe;
create policy "orbitfs runtime secret probe"
  on public.orbitfs_runtime_secret_probe
  for select
  to anon, authenticated
  using (private.orbitfs_server_secret_valid());

create or replace function public.orbitfs_repair_runtime_access(
  p_table_prefixes text[],
  p_excluded_tables text[] default array['orbitfs_schema_migrations','orbitfs_runtime_secret_probe']::text[],
  p_public_read_tables text[] default array['orbitfs_addons']::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  table_name text;
  sequence_name text;
  matched_tables text[] := array[]::text[];
  prefixes text[] := coalesce(p_table_prefixes, array[]::text[]);
  excluded text[] := coalesce(p_excluded_tables, array[]::text[]);
  public_read text[] := coalesce(p_public_read_tables, array[]::text[]);
begin
  if coalesce(array_length(prefixes, 1), 0) < 1
     or array_length(prefixes, 1) > 16
  then
    raise exception 'OrbitFS runtime access table prefixes are missing or invalid'
      using errcode = '22023';
  end if;

  if exists (
    select 1 from unnest(prefixes) value
    where value !~ '^[a-z_][a-z0-9_]*$'
  ) then
    raise exception 'OrbitFS runtime access contains an invalid table prefix'
      using errcode = '22023';
  end if;

  if exists (
    select 1 from unnest(excluded) value
    where value !~ '^[a-z_][a-z0-9_]*$'
  ) or exists (
    select 1 from unnest(public_read) value
    where value !~ '^[a-z_][a-z0-9_]*$'
  ) then
    raise exception 'OrbitFS runtime access contains an invalid table name'
      using errcode = '22023';
  end if;

  if to_regprocedure('private.orbitfs_server_secret_valid()') is null then
    raise exception 'OrbitFS runtime secret validator is missing'
      using errcode = '55000';
  end if;

  for table_name in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r','p')
      and exists (
        select 1
        from unnest(prefixes) prefix
        where c.relname like prefix || '%'
      )
      and not (c.relname = any(excluded))
    order by c.relname
  loop
    matched_tables := array_append(matched_tables, table_name);

    execute format('alter table public.%I enable row level security', table_name);

    -- Remove the legacy policy and any earlier deployer-generated read policy so
    -- this function is the single canonical database-side repair primitive.
    execute format('drop policy if exists "orbitfs server secret access" on public.%I', table_name);
    execute format('drop policy if exists %I on public.%I', 'orbitfs_runtime_read_' || table_name, table_name);
    execute format('drop policy if exists "orbitfs runtime public read" on public.%I', table_name);
    execute format('drop policy if exists "orbitfs runtime secret access" on public.%I', table_name);
    execute format('drop policy if exists "orbitfs runtime secret access insert" on public.%I', table_name);
    execute format('drop policy if exists "orbitfs runtime secret access update" on public.%I', table_name);
    execute format('drop policy if exists "orbitfs runtime secret access delete" on public.%I', table_name);
    execute format('drop policy if exists "orbitfs runtime secret required" on public.%I', table_name);
    execute format('drop policy if exists "orbitfs runtime secret required insert" on public.%I', table_name);
    execute format('drop policy if exists "orbitfs runtime secret required update" on public.%I', table_name);
    execute format('drop policy if exists "orbitfs runtime secret required delete" on public.%I', table_name);

    -- A permissive policy is required for the restricted runtime path to have
    -- candidate rows. Restrictive policies prevent unrelated permissive
    -- policies from bypassing the server-secret requirement.
    if table_name = any(public_read) then
      -- Public catalog reads stay public. Mutations still require the runtime
      -- secret and do not add a second permissive SELECT policy.
      execute format(
        'create policy "orbitfs runtime public read" on public.%I as permissive for select to anon, authenticated using (true)',
        table_name
      );
      execute format(
        'create policy "orbitfs runtime secret access insert" on public.%I as permissive for insert to anon, authenticated with check (private.orbitfs_server_secret_valid())',
        table_name
      );
      execute format(
        'create policy "orbitfs runtime secret access update" on public.%I as permissive for update to anon, authenticated using (private.orbitfs_server_secret_valid()) with check (private.orbitfs_server_secret_valid())',
        table_name
      );
      execute format(
        'create policy "orbitfs runtime secret access delete" on public.%I as permissive for delete to anon, authenticated using (private.orbitfs_server_secret_valid())',
        table_name
      );
      execute format(
        'create policy "orbitfs runtime secret required insert" on public.%I as restrictive for insert to anon, authenticated with check (private.orbitfs_server_secret_valid())',
        table_name
      );
      execute format(
        'create policy "orbitfs runtime secret required update" on public.%I as restrictive for update to anon, authenticated using (private.orbitfs_server_secret_valid()) with check (private.orbitfs_server_secret_valid())',
        table_name
      );
      execute format(
        'create policy "orbitfs runtime secret required delete" on public.%I as restrictive for delete to anon, authenticated using (private.orbitfs_server_secret_valid())',
        table_name
      );
    else
      execute format(
        'create policy "orbitfs runtime secret access" on public.%I as permissive for all to anon, authenticated using (private.orbitfs_server_secret_valid()) with check (private.orbitfs_server_secret_valid())',
        table_name
      );
      execute format(
        'create policy "orbitfs runtime secret required" on public.%I as restrictive for all to anon, authenticated using (private.orbitfs_server_secret_valid()) with check (private.orbitfs_server_secret_valid())',
        table_name
      );
    end if;

    -- Grants only allow the request to reach RLS. They do not bypass the
    -- server-secret policies above.
    execute format(
      'grant select, insert, update, delete on table public.%I to anon, authenticated',
      table_name
    );
    execute format(
      'grant all privileges on table public.%I to service_role',
      table_name
    );
  end loop;

  -- Grant only sequences owned by runtime tables, rather than every sequence in
  -- the customer database.
  for sequence_name in
    select distinct seq.relname
    from pg_class seq
    join pg_namespace sn on sn.oid = seq.relnamespace
    join pg_depend d on d.objid = seq.oid and d.deptype in ('a','i')
    join pg_class tbl on tbl.oid = d.refobjid
    join pg_namespace tn on tn.oid = tbl.relnamespace
    where sn.nspname = 'public'
      and tn.nspname = 'public'
      and seq.relkind = 'S'
      and exists (
        select 1
        from unnest(prefixes) prefix
        where tbl.relname like prefix || '%'
      )
      and not (tbl.relname = any(excluded))
  loop
    execute format(
      'grant usage, select on sequence public.%I to anon, authenticated',
      sequence_name
    );
    execute format(
      'grant all privileges on sequence public.%I to service_role',
      sequence_name
    );
  end loop;

  return jsonb_build_object(
    'ok', true,
    'contractVersion', 1,
    'tableCount', coalesce(array_length(matched_tables, 1), 0),
    'tables', matched_tables
  );
end;
$$;

revoke all on function public.orbitfs_repair_runtime_access(text[], text[], text[])
  from public, anon, authenticated;
grant execute on function public.orbitfs_repair_runtime_access(text[], text[], text[])
  to service_role;

revoke all on table public.orbitfs_runtime_secret_probe from anon, authenticated;
grant select on table public.orbitfs_runtime_secret_probe to anon, authenticated;
grant all privileges on table public.orbitfs_runtime_secret_probe to service_role;

-- Fresh installs and Base upgrades leave the database correct even before the
-- customer deployer performs its independent live verification.
select public.orbitfs_repair_runtime_access(
  array['orbitfs_','mcp_','studio_','apex_']::text[],
  array['orbitfs_schema_migrations','orbitfs_runtime_secret_probe']::text[],
  array['orbitfs_addons']::text[]
);

notify pgrst, 'reload schema';
