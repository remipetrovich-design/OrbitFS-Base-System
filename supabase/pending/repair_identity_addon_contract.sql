-- OrbitFS core identity, user/group permission, workspace permission, and Add-on Manager contract repair.
-- Additive/idempotent: safe to re-run against rebuilt Base databases.

create extension if not exists pgcrypto;

create table if not exists public.orbitfs_users (
  id text primary key default gen_random_uuid()::text,
  username text not null,
  display_name text not null default '',
  email text,
  password_hash text not null default '',
  role text not null default 'user',
  status text not null default 'active',
  avatar_url text,
  permissions jsonb not null default '{}'::jsonb,
  must_change_pin boolean not null default false,
  ban_reason text,
  login_count integer not null default 0,
  last_login_at timestamptz,
  last_seen_at timestamptz,
  last_ip text,
  last_user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.orbitfs_users
  add column if not exists display_name text not null default '',
  add column if not exists email text,
  add column if not exists password_hash text not null default '',
  add column if not exists role text not null default 'user',
  add column if not exists status text not null default 'active',
  add column if not exists avatar_url text,
  add column if not exists permissions jsonb not null default '{}'::jsonb,
  add column if not exists must_change_pin boolean not null default false,
  add column if not exists ban_reason text,
  add column if not exists login_count integer not null default 0,
  add column if not exists last_login_at timestamptz,
  add column if not exists last_seen_at timestamptz,
  add column if not exists last_ip text,
  add column if not exists last_user_agent text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists ux_orbitfs_users_username_lower
  on public.orbitfs_users(lower(username));
create unique index if not exists ux_orbitfs_users_email_lower
  on public.orbitfs_users(lower(email)) where email is not null and btrim(email) <> '';

create table if not exists public.orbitfs_groups (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  description text not null default '',
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.orbitfs_groups
  add column if not exists description text not null default '',
  add column if not exists permissions jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists ux_orbitfs_groups_name_lower
  on public.orbitfs_groups(lower(name));

create table if not exists public.orbitfs_group_members (
  group_id text not null references public.orbitfs_groups(id) on delete cascade,
  user_id text not null references public.orbitfs_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id,user_id)
);

alter table public.orbitfs_group_members
  add column if not exists created_at timestamptz not null default now();

create unique index if not exists ux_orbitfs_group_members_group_user
  on public.orbitfs_group_members(group_id,user_id);
create index if not exists idx_orbitfs_group_members_user
  on public.orbitfs_group_members(user_id);

-- Workspace membership and workspace-scoped permissions.
create table if not exists public.orbitfs_workspace_members (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null references public.orbitfs_workspaces(id) on delete cascade,
  user_id text not null references public.orbitfs_users(id) on delete cascade,
  role text not null default 'viewer',
  mcp_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,user_id)
);

create table if not exists public.orbitfs_file_permissions (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null references public.orbitfs_workspaces(id) on delete cascade,
  path_prefix text not null default '',
  principal_type text not null default 'role',
  principal_id text not null default 'viewer',
  can_view boolean not null default false,
  can_edit boolean not null default false,
  can_download boolean not null default false,
  can_move boolean not null default false,
  can_delete boolean not null default false,
  can_create boolean not null default false,
  can_share boolean not null default false,
  can_manage_permissions boolean not null default false,
  inherit boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.orbitfs_workspace_members
  add column if not exists role text not null default 'viewer',
  add column if not exists mcp_enabled boolean not null default false,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists ux_orbitfs_workspace_members_workspace_user
  on public.orbitfs_workspace_members(workspace_id,user_id);
create index if not exists idx_orbitfs_workspace_members_user
  on public.orbitfs_workspace_members(user_id);

alter table public.orbitfs_file_permissions
  add column if not exists path_prefix text not null default '',
  add column if not exists principal_type text not null default 'role',
  add column if not exists principal_id text not null default 'viewer',
  add column if not exists can_view boolean not null default false,
  add column if not exists can_edit boolean not null default false,
  add column if not exists can_download boolean not null default false,
  add column if not exists can_move boolean not null default false,
  add column if not exists can_delete boolean not null default false,
  add column if not exists can_create boolean not null default false,
  add column if not exists can_share boolean not null default false,
  add column if not exists can_manage_permissions boolean not null default false,
  add column if not exists inherit boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists ux_orbitfs_file_permissions_principal_path
  on public.orbitfs_file_permissions(workspace_id,path_prefix,principal_type,principal_id);
create index if not exists idx_orbitfs_file_permissions_workspace
  on public.orbitfs_file_permissions(workspace_id);

-- Session persistence used by authentication and Users session administration.
create table if not exists public.orbitfs_sessions (
  id text primary key default gen_random_uuid()::text,
  user_id text not null references public.orbitfs_users(id) on delete cascade,
  token_hash text not null,
  user_agent text,
  ip_address text,
  expires_at timestamptz not null,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.orbitfs_sessions
  add column if not exists token_hash text,
  add column if not exists user_agent text,
  add column if not exists ip_address text,
  add column if not exists expires_at timestamptz,
  add column if not exists last_seen_at timestamptz,
  add column if not exists created_at timestamptz not null default now();

create unique index if not exists ux_orbitfs_sessions_token_hash
  on public.orbitfs_sessions(token_hash);
create index if not exists idx_orbitfs_sessions_user
  on public.orbitfs_sessions(user_id);
create index if not exists idx_orbitfs_sessions_expires
  on public.orbitfs_sessions(expires_at);

-- Registration queue backing the Users / registration settings surface.
create table if not exists public.orbitfs_registration_requests (
  id text primary key default gen_random_uuid()::text,
  username text not null,
  email text,
  credential_hash text not null,
  credential_type text not null default 'password',
  status text not null default 'pending',
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text references public.orbitfs_users(id) on delete set null,
  created_user_id text references public.orbitfs_users(id) on delete set null
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
  on public.orbitfs_registration_requests(status,requested_at);
create index if not exists idx_orbitfs_registration_requests_username_lower
  on public.orbitfs_registration_requests(lower(username));

-- Add-on Manager persistence contract.
create table if not exists public.orbitfs_addons (
  id text primary key,
  name text not null,
  description text not null default '',
  version text not null default '',
  license_component text,
  available boolean not null default true,
  installed boolean not null default false,
  attached boolean not null default false,
  configured boolean not null default false,
  status text not null default 'registered',
  deployment_url text,
  transport_path text,
  source_ref text,
  config jsonb not null default '{}'::jsonb,
  manifest jsonb not null default '{}'::jsonb,
  runtime jsonb not null default '{}'::jsonb,
  installed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.orbitfs_addons
  add column if not exists name text not null default '',
  add column if not exists description text not null default '',
  add column if not exists version text not null default '',
  add column if not exists license_component text,
  add column if not exists available boolean not null default true,
  add column if not exists installed boolean not null default false,
  add column if not exists attached boolean not null default false,
  add column if not exists configured boolean not null default false,
  add column if not exists status text not null default 'registered',
  add column if not exists deployment_url text,
  add column if not exists transport_path text,
  add column if not exists source_ref text,
  add column if not exists config jsonb not null default '{}'::jsonb,
  add column if not exists manifest jsonb not null default '{}'::jsonb,
  add column if not exists runtime jsonb not null default '{}'::jsonb,
  add column if not exists installed_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists ux_orbitfs_addons_license_component
  on public.orbitfs_addons(license_component)
  where license_component is not null and btrim(license_component) <> '';

-- These tables are server-owned. Browser roles do not need direct table access.
do $$
declare t text;
begin
  foreach t in array array[
    'orbitfs_users','orbitfs_groups','orbitfs_group_members','orbitfs_workspace_members',
    'orbitfs_file_permissions','orbitfs_registration_requests','orbitfs_sessions','orbitfs_addons'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from anon, authenticated',t);
    execute format('grant select,insert,update,delete on table public.%I to service_role',t);
  end loop;
end $$;

notify pgrst,'reload schema';
