-- OrbitFS Base forward repair: registration request contract.
-- Additive and idempotent for customer databases created from older/incomplete Base schemas.

create extension if not exists pgcrypto;

create table if not exists public.orbitfs_registration_requests (
  id text primary key default gen_random_uuid()::text,
  username text not null,
  email text,
  credential_hash text not null,
  credential_type text not null default 'password',
  status text not null default 'pending',
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text,
  created_user_id text
);

alter table public.orbitfs_registration_requests
  add column if not exists email text,
  add column if not exists credential_hash text,
  add column if not exists credential_type text not null default 'password',
  add column if not exists status text not null default 'pending',
  add column if not exists requested_at timestamptz not null default now(),
  add column if not exists decided_at timestamptz,
  add column if not exists decided_by text,
  add column if not exists created_user_id text;

create index if not exists idx_orbitfs_registration_requests_status_requested
  on public.orbitfs_registration_requests(status, requested_at);

create index if not exists idx_orbitfs_registration_requests_username_lower
  on public.orbitfs_registration_requests(lower(username));

alter table public.orbitfs_registration_requests enable row level security;
revoke all on table public.orbitfs_registration_requests from anon, authenticated;
grant select, insert, update, delete on table public.orbitfs_registration_requests to service_role;

notify pgrst, 'reload schema';
