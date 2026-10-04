-- OrbitFS Base migration 20261004020000: repair_engine_migration_executor_regex
-- Repairs the Engine/update migration executor shipped by 20260929070700.
-- PostgreSQL rejects repetition bounds above 255; the previous {0,300}
-- destructive-operation guard therefore failed before component SQL executed.
-- The replacement remains fail-closed without using an invalid repetition bound.

create or replace function public.orbitfs_apply_update_migration(
  p_migration_id text,
  p_source_file text,
  p_component text,
  p_sha256 text,
  p_source_sql text,
  p_statements text[],
  p_release_id text default null,
  p_release_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  existing public.orbitfs_schema_migrations%rowtype;
  statement text;
  source_digest text;
begin
  if coalesce(p_migration_id, '') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' then
    raise exception 'Invalid OrbitFS migration id'
      using errcode = '22023';
  end if;

  if p_component not in ('shared','apex','mcp','studio') then
    raise exception 'Invalid OrbitFS migration component'
      using errcode = '22023';
  end if;

  if coalesce(p_source_file, '') !~
    '^supabase/migrations/(shared|apex|mcp|studio)/[0-9]{14}_[A-Za-z0-9._-]+[.]sql$'
  then
    raise exception 'Invalid OrbitFS migration source file'
      using errcode = '22023';
  end if;

  if split_part(p_source_file, '/', 3) <> p_component then
    raise exception 'OrbitFS migration component/source mismatch'
      using errcode = '22023';
  end if;

  if coalesce(p_sha256, '') !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid OrbitFS migration SHA-256'
      using errcode = '22023';
  end if;

  if octet_length(coalesce(p_source_sql, '')) < 1
     or octet_length(p_source_sql) > 2097152
  then
    raise exception 'OrbitFS migration source size is invalid'
      using errcode = '22023';
  end if;

  if coalesce(array_length(p_statements, 1), 0) < 1
     or array_length(p_statements, 1) > 1000
  then
    raise exception 'OrbitFS migration statement list is invalid'
      using errcode = '22023';
  end if;

  source_digest := encode(
    extensions.digest(convert_to(p_source_sql, 'UTF8'), 'sha256'),
    'hex'
  );

  if source_digest <> lower(p_sha256) then
    raise exception 'OrbitFS migration source checksum mismatch'
      using errcode = '22023';
  end if;

  if p_source_sql ~* '\m(begin|commit|rollback)[[:space:]]*;' then
    raise exception 'OrbitFS migration contains explicit transaction control'
      using errcode = '22023';
  end if;

  if p_source_sql ~*
    '\m(drop[[:space:]]+(table|schema)|truncate[[:space:]]+(table[[:space:]]+)?|alter[[:space:]]+table[[:space:][:print:]]*drop[[:space:]]+column)\M'
  then
    raise exception 'OrbitFS migration contains a destructive operation'
      using errcode = '22023';
  end if;

  select *
  into existing
  from public.orbitfs_schema_migrations
  where migration_id = p_migration_id
  for update;

  if found then
    if lower(existing.sha256) <> lower(p_sha256)
       or existing.source_file <> p_source_file
       or existing.component <> p_component
    then
      raise exception 'Published OrbitFS migration identity/checksum conflict: %', p_migration_id
        using errcode = '23505';
    end if;

    return jsonb_build_object(
      'ok', true,
      'applied', false,
      'alreadyApplied', true,
      'migrationId', p_migration_id
    );
  end if;

  foreach statement in array p_statements loop
    if btrim(coalesce(statement, '')) <> '' then
      execute statement;
    end if;
  end loop;

  insert into public.orbitfs_schema_migrations(
    migration_id,
    source_file,
    component,
    sha256,
    release_id,
    release_version,
    applied_at
  )
  values(
    p_migration_id,
    p_source_file,
    p_component,
    lower(p_sha256),
    nullif(p_release_id, ''),
    nullif(p_release_version, ''),
    now()
  );

  return jsonb_build_object(
    'ok', true,
    'applied', true,
    'alreadyApplied', false,
    'migrationId', p_migration_id
  );
end;
$$;

revoke all on function public.orbitfs_apply_update_migration(
  text, text, text, text, text, text[], text, text
) from public, anon, authenticated;
grant execute on function public.orbitfs_apply_update_migration(
  text, text, text, text, text, text[], text, text
) to service_role;

notify pgrst, 'reload schema';
