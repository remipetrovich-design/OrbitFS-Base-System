-- OrbitFS Base migration 20260929070700: engine_update_runtime_contract
-- Base-owned runtime contract for restricted Engine database access and
-- immutable forward-only Engine/Update migrations.

create table if not exists public.orbitfs_schema_migrations (
  migration_id text primary key,
  source_file text not null,
  component text not null,
  sha256 text not null,
  release_id text,
  release_version text,
  applied_at timestamptz not null default now(),
  constraint orbitfs_schema_migration_id_valid
    check (migration_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'),
  constraint orbitfs_schema_migration_component_valid
    check (component in ('shared','apex','mcp','studio')),
  constraint orbitfs_schema_migration_sha_valid
    check (sha256 ~ '^[a-f0-9]{64}$')
);

alter table public.orbitfs_schema_migrations enable row level security;
revoke all on table public.orbitfs_schema_migrations from public, anon, authenticated;
grant select, insert, update, delete on table public.orbitfs_schema_migrations to service_role;

create table if not exists private.orbitfs_runtime_secrets (
  secret_sha256 text primary key,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  constraint orbitfs_runtime_secret_sha_valid
    check (secret_sha256 ~ '^[a-f0-9]{64}$')
);

insert into private.orbitfs_runtime_secrets(secret_sha256, created_at, expires_at)
select secret_sha256, coalesce(updated_at, now()), now() + interval '24 hours'
from private.orbitfs_runtime_secret
where id = true
on conflict(secret_sha256) do nothing;

revoke all on table private.orbitfs_runtime_secrets from public, anon, authenticated;

create or replace function private.orbitfs_server_secret_valid()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private, extensions
as $$
  select exists (
    select 1
    from private.orbitfs_runtime_secrets s
    where (s.expires_at is null or s.expires_at > now())
      and s.secret_sha256 = encode(
        extensions.digest(
          coalesce(current_setting('request.headers', true)::json ->> 'x-orbitfs-secret', ''),
          'sha256'
        ),
        'hex'
      )
  );
$$;

revoke all on function private.orbitfs_server_secret_valid() from public;
grant execute on function private.orbitfs_server_secret_valid() to anon, authenticated;

create or replace function public.orbitfs_set_runtime_secret(
  p_secret_sha256 text,
  p_previous_grace_seconds integer default 3600
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  grace_seconds integer := greatest(
    60,
    least(coalesce(p_previous_grace_seconds, 3600), 86400)
  );
begin
  if coalesce(p_secret_sha256, '') !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid OrbitFS runtime secret digest'
      using errcode = '22023';
  end if;

  update private.orbitfs_runtime_secrets
  set expires_at = least(
    coalesce(expires_at, now() + make_interval(secs => grace_seconds)),
    now() + make_interval(secs => grace_seconds)
  )
  where secret_sha256 <> p_secret_sha256
    and (
      expires_at is null
      or expires_at > now() + make_interval(secs => grace_seconds)
    );

  insert into private.orbitfs_runtime_secrets(secret_sha256, created_at, expires_at)
  values(p_secret_sha256, now(), null)
  on conflict(secret_sha256) do update
    set expires_at = null;

  delete from private.orbitfs_runtime_secrets
  where expires_at is not null
    and expires_at <= now() - interval '1 day';

  return true;
end;
$$;

revoke all on function public.orbitfs_set_runtime_secret(text, integer)
  from public, anon, authenticated;
grant execute on function public.orbitfs_set_runtime_secret(text, integer)
  to service_role;

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
    '\m(drop[[:space:]]+(table|schema)|truncate[[:space:]]+(table[[:space:]]+)?|alter[[:space:]]+table[[:space:][:print:]]{0,300}drop[[:space:]]+column)\M'
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
