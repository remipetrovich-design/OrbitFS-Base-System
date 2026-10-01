-- OrbitFS Base migration 20260923072442: orbitfs_base_core_schema
-- Exported from the authoritative V1-vercel-base Supabase migration history.

create extension if not exists pgcrypto;

create table if not exists public.orbitfs_users (
 id text primary key default gen_random_uuid()::text,
 username text not null unique,
 display_name text not null default '',
 email text,
 password_hash text not null,
 role text not null default 'user',
 status text not null default 'active',
 avatar_url text,
 permissions jsonb not null default '{}'::jsonb,
 must_change_pin boolean not null default false,
 ban_reason text,
 login_count integer not null default 0,
 last_login_at timestamptz,
 last_seen_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index if not exists orbitfs_users_email_uidx on public.orbitfs_users(lower(email)) where email is not null;

create table if not exists public.orbitfs_workspaces (
 id text primary key default gen_random_uuid()::text,
 name text not null,
 slug text not null unique,
 description text not null default '',
 status text not null default 'active',
 visibility text not null default 'private',
 is_main boolean not null default false,
 delete_protected boolean not null default false,
 storage_quota_bytes bigint not null default 5368709120,
 created_by text,
 owner_id text,
 mcp_system_enabled boolean not null default true,
 mcp_ui_enabled boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table if not exists public.orbitfs_workspace_members (
 id text primary key default gen_random_uuid()::text,
 workspace_id text not null references public.orbitfs_workspaces(id) on delete cascade,
 user_id text not null references public.orbitfs_users(id) on delete cascade,
 role text not null default 'viewer',
 mcp_enabled boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(workspace_id,user_id)
);

create table if not exists public.orbitfs_files (
 id text primary key default gen_random_uuid()::text,
 workspace_id text not null references public.orbitfs_workspaces(id) on delete cascade,
 parent_id text,
 name text not null,
 path text not null,
 kind text not null default 'file',
 mime_type text,
 content_text text not null default '',
 storage_path text,
 size_bytes bigint not null default 0,
 created_by text,
 deleted_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(workspace_id,path)
);

create table if not exists public.orbitfs_settings (
 id text primary key default gen_random_uuid()::text,
 scope_type text not null,
 scope_id text not null default '',
 key text not null,
 value jsonb not null default '{}'::jsonb,
 updated_at timestamptz not null default now(),
 unique(scope_type,scope_id,key)
);

create table if not exists public.orbitfs_license (
 id text primary key,
 license_key text,
 status text not null default 'unconfigured',
 plan text,
 licensed_to text,
 expires_at timestamptz,
 metadata jsonb not null default '{}'::jsonb,
 updated_at timestamptz not null default now(),
 created_at timestamptz not null default now()
);

create table if not exists public.orbitfs_addons (
 id text primary key,
 name text not null default '',
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
 updated_at timestamptz not null default now()
);

create table if not exists public.orbitfs_audit_log (
 id text primary key default gen_random_uuid()::text,
 actor_user_id text,
 workspace_id text,
 action text not null,
 target_type text,
 target_id text,
 details jsonb not null default '{}'::jsonb,
 ip_address text,
 user_agent text,
 created_at timestamptz not null default now()
);

create table if not exists public.orbitfs_sessions (
 id text primary key default gen_random_uuid()::text,
 user_id text not null references public.orbitfs_users(id) on delete cascade,
 token_hash text not null unique,
 user_agent text,
 ip_address text,
 expires_at timestamptz not null,
 last_seen_at timestamptz,
 created_at timestamptz not null default now()
);

create table if not exists public.orbitfs_groups (
 id text primary key default gen_random_uuid()::text,
 name text not null,
 description text not null default '',
 permissions jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.orbitfs_group_members (
 id text primary key default gen_random_uuid()::text,
 group_id text not null references public.orbitfs_groups(id) on delete cascade,
 user_id text not null references public.orbitfs_users(id) on delete cascade,
 created_at timestamptz not null default now(),
 unique(group_id,user_id)
);

create table if not exists public.orbitfs_file_permissions (
 id text primary key default gen_random_uuid()::text,
 workspace_id text not null references public.orbitfs_workspaces(id) on delete cascade,
 path_prefix text not null default '',
 principal_type text not null,
 principal_id text not null,
 can_view boolean not null default false,
 can_edit boolean not null default false,
 can_download boolean not null default false,
 can_move boolean not null default false,
 can_delete boolean not null default false,
 can_create boolean not null default false,
 can_share boolean not null default false,
 can_manage_permissions boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table if not exists public.orbitfs_notifications (
 id text primary key default gen_random_uuid()::text,
 user_id text not null references public.orbitfs_users(id) on delete cascade,
 type text not null default 'system',
 title text not null default '',
 message text not null default '',
 read boolean not null default false,
 metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);

create table if not exists public.orbitfs_registration_requests (
 id text primary key default gen_random_uuid()::text,
 username text not null,
 email text,
 display_name text,
 status text not null default 'pending',
 created_user_id text,
 decided_at timestamptz,
 decided_by text,
 metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table if not exists public.orbitfs_workspace_requests (
 id text primary key default gen_random_uuid()::text,
 workspace_id text references public.orbitfs_workspaces(id) on delete cascade,
 requested_by_id text,
 target_user_id text,
 decided_by_id text,
 type text,
 status text not null default 'pending',
 payload jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table if not exists public.orbitfs_profile_state (
 id text primary key default gen_random_uuid()::text,
 workspace_id text not null references public.orbitfs_workspaces(id) on delete cascade,
 user_id text,
 state jsonb not null default '{}'::jsonb,
 updated_at timestamptz not null default now(),
 unique(workspace_id,user_id)
);

create table if not exists public.orbitfs_library_state (
 id text primary key default gen_random_uuid()::text,
 workspace_id text not null references public.orbitfs_workspaces(id) on delete cascade,
 state jsonb not null default '{}'::jsonb,
 updated_at timestamptz not null default now(),
 unique(workspace_id)
);

create index if not exists orbitfs_sessions_user_id_idx on public.orbitfs_sessions(user_id);
create index if not exists orbitfs_files_workspace_parent_active_idx on public.orbitfs_files(workspace_id,parent_id,kind,name) where deleted_at is null;
create index if not exists orbitfs_audit_log_actor_user_id_idx on public.orbitfs_audit_log(actor_user_id);
create index if not exists orbitfs_workspaces_created_by_idx on public.orbitfs_workspaces(created_by);
create index if not exists orbitfs_workspaces_owner_id_idx on public.orbitfs_workspaces(owner_id);
create index if not exists orbitfs_group_members_user_id_idx on public.orbitfs_group_members(user_id);

alter table public.orbitfs_users enable row level security;
alter table public.orbitfs_workspaces enable row level security;
alter table public.orbitfs_workspace_members enable row level security;
alter table public.orbitfs_files enable row level security;
alter table public.orbitfs_settings enable row level security;
alter table public.orbitfs_license enable row level security;
alter table public.orbitfs_addons enable row level security;
alter table public.orbitfs_audit_log enable row level security;
alter table public.orbitfs_sessions enable row level security;
alter table public.orbitfs_groups enable row level security;
alter table public.orbitfs_group_members enable row level security;
alter table public.orbitfs_file_permissions enable row level security;
alter table public.orbitfs_notifications enable row level security;
alter table public.orbitfs_registration_requests enable row level security;
alter table public.orbitfs_workspace_requests enable row level security;
alter table public.orbitfs_profile_state enable row level security;
alter table public.orbitfs_library_state enable row level security;
