-- OrbitFS workspace contract repair for the rebuilt Supabase database.

alter table public.orbitfs_workspaces
  add column if not exists trash_limit_bytes bigint not null default 209715200,
  add column if not exists offline_message text not null default '',
  add column if not exists suspension_reason text not null default '',
  add column if not exists auto_delete_immune boolean not null default false,
  add column if not exists drive_state text not null default 'online',
  add column if not exists apex_system_enabled boolean not null default true;

update public.orbitfs_workspaces
set auto_delete_immune = delete_protected
where delete_protected = true and auto_delete_immune = false;

update public.orbitfs_workspaces
set drive_state = case when status = 'active' then 'online' else 'offline' end
where drive_state is null or drive_state not in ('online','offline');

alter table public.orbitfs_file_permissions
  add column if not exists inherit boolean not null default true;

alter table public.orbitfs_workspace_requests
  add column if not exists decided_at timestamptz;

alter table public.orbitfs_notifications
  add column if not exists body text not null default '',
  add column if not exists level text not null default 'info',
  add column if not exists read_at timestamptz;

alter table public.orbitfs_notifications alter column user_id drop not null;

update public.orbitfs_notifications
set body = message
where body = '' and coalesce(message,'') <> '';

update public.orbitfs_notifications
set level = case when type in ('info','success','warning','error','critical') then type else 'info' end
where level = 'info' and coalesce(type,'') <> '';

update public.orbitfs_notifications
set read_at = created_at
where read = true and read_at is null;

create table if not exists public.orbitfs_workspace_messages (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null references public.orbitfs_workspaces(id) on delete cascade,
  title text not null,
  message text not null,
  severity text not null default 'info',
  created_by text references public.orbitfs_users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.orbitfs_workspace_messages enable row level security;
revoke all on table public.orbitfs_workspace_messages from anon, authenticated;
grant select, insert, update, delete on table public.orbitfs_workspace_messages to service_role;

create index if not exists idx_orbitfs_workspaces_owner_status on public.orbitfs_workspaces(owner_id, status);
create index if not exists idx_orbitfs_workspaces_main_status on public.orbitfs_workspaces(is_main, status);
create index if not exists idx_orbitfs_workspace_members_workspace on public.orbitfs_workspace_members(workspace_id);
create index if not exists idx_orbitfs_workspace_requests_type_status on public.orbitfs_workspace_requests(request_type, status, created_at desc);
create index if not exists idx_orbitfs_workspace_messages_workspace_created on public.orbitfs_workspace_messages(workspace_id, created_at desc);

grant select, insert, update, delete on table public.orbitfs_workspaces to service_role;
grant select, insert, update, delete on table public.orbitfs_workspace_members to service_role;
grant select, insert, update, delete on table public.orbitfs_workspace_requests to service_role;
grant select, insert, update, delete on table public.orbitfs_file_permissions to service_role;
grant select, insert, update, delete on table public.orbitfs_notifications to service_role;
grant select, insert, update, delete on table public.orbitfs_settings to service_role;
