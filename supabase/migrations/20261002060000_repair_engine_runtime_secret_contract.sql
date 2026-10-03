-- OrbitFS Base migration 20261002060000: repair_engine_runtime_secret_contract
-- Repairs installations that previously received the older one-argument
-- orbitfs_set_runtime_secret function. This is additive/idempotent and keeps
-- the older overload available for compatibility.

create table if not exists private.orbitfs_runtime_secrets (
  secret_sha256 text primary key,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  constraint orbitfs_runtime_secret_sha_valid
    check (secret_sha256 ~ '^[a-f0-9]{64}$')
);

revoke all on table private.orbitfs_runtime_secrets from public, anon, authenticated;

do $$
begin
  if to_regclass('private.orbitfs_runtime_secret') is not null then
    insert into private.orbitfs_runtime_secrets(secret_sha256, created_at, expires_at)
    select secret_sha256, coalesce(updated_at, now()), now() + interval '24 hours'
    from private.orbitfs_runtime_secret
    where id = true
    on conflict(secret_sha256) do nothing;
  end if;
end
$$;

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

notify pgrst, 'reload schema';
