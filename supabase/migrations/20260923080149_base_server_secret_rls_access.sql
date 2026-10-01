-- OrbitFS Base migration 20260923080149: base_server_secret_rls_access
-- Exported from the authoritative V1-vercel-base Supabase migration history.

create schema if not exists private;

create table if not exists private.orbitfs_runtime_secret (
  id boolean primary key default true check (id),
  secret_sha256 text not null,
  updated_at timestamptz not null default now()
);

insert into private.orbitfs_runtime_secret (id, secret_sha256)
values (true, 'f4ff40128b9ee04e16579d08cf288b73194cd7ed296a5751b06a66916d958625')
on conflict (id) do update
set secret_sha256 = excluded.secret_sha256,
    updated_at = now();

create or replace function private.orbitfs_server_secret_valid()
returns boolean
language sql stable security definer
set search_path = pg_catalog, public, private, extensions
as $$
  select exists (
    select 1
    from private.orbitfs_runtime_secret s
    where s.id = true
      and s.secret_sha256 = encode(
        extensions.digest(
          coalesce(current_setting('request.headers', true)::json ->> 'x-orbitfs-secret', ''),
          'sha256'
        ), 'hex'
      )
  );
$$;

revoke all on table private.orbitfs_runtime_secret from public, anon, authenticated;
revoke all on function private.orbitfs_server_secret_valid() from public;
grant execute on function private.orbitfs_server_secret_valid() to anon, authenticated;

do $$
declare t text;
begin
  for t in
    select tablename from pg_tables
    where schemaname='public' and tablename like 'orbitfs_%'
  loop
    execute format('drop policy if exists "orbitfs server secret access" on public.%I', t);
    execute format(
      'create policy "orbitfs server secret access" on public.%I for all to anon, authenticated using (private.orbitfs_server_secret_valid()) with check (private.orbitfs_server_secret_valid())',
      t
    );
  end loop;
end $$;
