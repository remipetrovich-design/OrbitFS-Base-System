-- OrbitFS Base migration 20260923232811: repair_library_profile_bundle_studio_contract
-- Exported from the authoritative V1-vercel-base Supabase migration history.

-- Repair the Library/Profile/MCP bundle/Studio contract used by current OrbitFS Base.

-- Canonical profile state is one row per workspace and the projection trigger
-- needs created_at as a fallback timestamp.
alter table public.orbitfs_profile_state
  add column if not exists created_at timestamptz not null default now();

-- MCP workspace startup/default/preset state used by mcp-workspace-state-legacy.ts.
alter table public.mcp_workspace_default_items
  add column if not exists missing boolean not null default false;

alter table public.mcp_workspace_preset_items
  add column if not exists item_type text not null default 'file';

alter table public.mcp_project_preset_items
  add column if not exists item_type text not null default 'file';

alter table public.mcp_workspace_preset_metadata
  add column if not exists updated_by_user_id text;

alter table public.mcp_project_preset_metadata
  add column if not exists updated_by_user_id text;

create table if not exists public.mcp_workspace_presets (
  workspace_id text not null references public.orbitfs_workspaces(id) on delete cascade,
  preset text not null,
  project_id text references public.mcp_projects(id) on delete set null,
  updated_by_user_id text,
  updated_at timestamptz not null default now(),
  primary key (workspace_id,preset),
  constraint mcp_workspace_presets_preset_check
    check (preset in ('low','medium','high','custom1','custom2'))
);

alter table public.mcp_workspace_presets enable row level security;
revoke all on table public.mcp_workspace_presets from anon, authenticated;
grant select,insert,update,delete on table public.mcp_workspace_presets to service_role;

-- Logical integrity for bundles and assignments.
create unique index if not exists ux_mcp_context_bundles_workspace_name
  on public.mcp_context_bundles(workspace_id,name);

create unique index if not exists ux_mcp_context_bundle_dependencies_pair
  on public.mcp_context_bundle_dependencies(bundle_id,depends_on_bundle_id);

create unique index if not exists ux_mcp_project_preset_bundles_assignment
  on public.mcp_project_preset_bundles(project_id,preset,bundle_id);

create index if not exists idx_mcp_workspace_presets_project
  on public.mcp_workspace_presets(project_id);

-- Studio is part of the knowledge/proposal surface and current Base code expects
-- these fields/settings even though the rebuild schema omitted them.
create table if not exists public.studio_settings (
  workspace_id text primary key,
  settings_json jsonb not null default '{}'::jsonb,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.studio_settings enable row level security;
revoke all on table public.studio_settings from anon, authenticated;
grant select,insert,update,delete on table public.studio_settings to service_role;

alter table public.studio_documents
  add column if not exists finalized_at timestamptz,
  add column if not exists archived_at timestamptz;

alter table public.studio_shares
  add column if not exists shared_by_user_id text;

grant select,insert,update,delete on table public.orbitfs_profile_state to service_role;
grant select,insert,update,delete on table public.mcp_workspace_default_items to service_role;
grant select,insert,update,delete on table public.mcp_workspace_preset_items to service_role;
grant select,insert,update,delete on table public.mcp_project_preset_items to service_role;
grant select,insert,update,delete on table public.mcp_workspace_preset_metadata to service_role;
grant select,insert,update,delete on table public.mcp_project_preset_metadata to service_role;
grant select,insert,update,delete on table public.studio_documents to service_role;
grant select,insert,update,delete on table public.studio_shares to service_role;

notify pgrst,'reload schema';
