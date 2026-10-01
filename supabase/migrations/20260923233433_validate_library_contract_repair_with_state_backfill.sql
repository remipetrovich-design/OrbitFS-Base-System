-- OrbitFS Base migration 20260923233433: validate_library_contract_repair_with_state_backfill
-- Exported from the authoritative V1-vercel-base Supabase migration history.

-- OrbitFS Library/MCP context dependency repair for rebuilt Supabase database.

create table if not exists public.mcp_workspace_preset_bundles (
  workspace_id text not null references public.orbitfs_workspaces(id) on delete cascade,
  preset text not null,
  bundle_id text not null references public.mcp_context_bundles(id) on delete cascade,
  required_flag boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (workspace_id, preset, bundle_id),
  constraint mcp_workspace_preset_bundles_preset_check
    check (preset in ('low','medium','high','custom1','custom2'))
);

alter table public.mcp_workspace_preset_bundles enable row level security;
revoke all on table public.mcp_workspace_preset_bundles from anon, authenticated;
grant select, insert, update, delete on table public.mcp_workspace_preset_bundles to service_role;

create index if not exists idx_mcp_workspace_preset_bundles_workspace_preset_sort
  on public.mcp_workspace_preset_bundles(workspace_id, preset, sort_order);
create index if not exists idx_mcp_workspace_preset_bundles_bundle
  on public.mcp_workspace_preset_bundles(bundle_id);

grant select, insert, update, delete on table public.orbitfs_library_state to service_role;
grant select, insert, update, delete on table public.orbitfs_profile_state to service_role;
grant select, insert, update, delete on table public.orbitfs_profiles to service_role;
grant select, insert, update, delete on table public.studio_documents to service_role;
grant select, insert, update, delete on table public.orbitfs_settings to service_role;
grant select, insert, update, delete on table public.orbitfs_addons to service_role;
grant select, insert, update, delete on table public.mcp_context_bundles to service_role;
grant select, insert, update, delete on table public.mcp_context_bundle_entries to service_role;
grant select, insert, update, delete on table public.mcp_context_bundle_dependencies to service_role;
grant select, insert, update, delete on table public.mcp_project_context_bundles to service_role;
grant select, insert, update, delete on table public.mcp_project_preset_bundles to service_role;
grant select, insert, update, delete on table public.mcp_projects to service_role;


-- Current Base Library/Profile/MCP/Studio contract hardening.

alter table public.orbitfs_profile_state
  add column if not exists created_at timestamptz not null default now();

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

create unique index if not exists ux_mcp_context_bundles_workspace_name
  on public.mcp_context_bundles(workspace_id,name);
create unique index if not exists ux_mcp_context_bundle_dependencies_pair
  on public.mcp_context_bundle_dependencies(bundle_id,depends_on_bundle_id);
create unique index if not exists ux_mcp_project_preset_bundles_assignment
  on public.mcp_project_preset_bundles(project_id,preset,bundle_id);
create index if not exists idx_mcp_workspace_presets_project
  on public.mcp_workspace_presets(project_id);

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

grant select,insert,update,delete on table public.mcp_workspace_default_items to service_role;
grant select,insert,update,delete on table public.mcp_workspace_preset_items to service_role;
grant select,insert,update,delete on table public.mcp_project_preset_items to service_role;
grant select,insert,update,delete on table public.mcp_workspace_preset_metadata to service_role;
grant select,insert,update,delete on table public.mcp_project_preset_metadata to service_role;
grant select,insert,update,delete on table public.studio_shares to service_role;

notify pgrst,'reload schema';


-- Studio analysis feeds reviewable Library/Profile knowledge proposals.
create table if not exists public.studio_analysis_sources (
  id text primary key default gen_random_uuid()::text,
  run_id text not null references public.studio_analysis_runs(id) on delete cascade,
  workspace_id text not null references public.orbitfs_workspaces(id) on delete cascade,
  source_key text not null,
  source_type text not null,
  provider text not null,
  source_ref text,
  item_id text,
  profile_id text,
  title text not null default '',
  source_hash text not null default '',
  source_updated_at timestamptz,
  metadata_json jsonb not null default '{}'::jsonb,
  status text not null default 'ready',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(run_id,source_key)
);

alter table public.studio_analysis_sources enable row level security;
revoke all on table public.studio_analysis_sources from anon, authenticated;
grant select,insert,update,delete on table public.studio_analysis_sources to service_role;

alter table public.studio_analysis_records
  add column if not exists record_key text,
  add column if not exists body text,
  add column if not exists date_start text,
  add column if not exists content_hash text;

create index if not exists idx_studio_analysis_sources_run on public.studio_analysis_sources(run_id);
create index if not exists idx_studio_analysis_sources_workspace on public.studio_analysis_sources(workspace_id);
create unique index if not exists ux_studio_analysis_records_run_record_key
  on public.studio_analysis_records(run_id,record_key)
  where record_key is not null;

grant select,insert,update,delete on table public.studio_analysis_records to service_role;
notify pgrst,'reload schema';


-- Backfill canonical Library/Profile state for every existing workspace.
insert into public.orbitfs_library_state(workspace_id,state,updated_at)
select
  w.id,
  jsonb_build_object(
    'version',9,'workspaceId',w.id,
    'items','[]'::jsonb,'collections','[]'::jsonb,'groups','[]'::jsonb,'categories','[]'::jsonb,
    'links','[]'::jsonb,'usage','[]'::jsonb,'sections','[]'::jsonb,'events','[]'::jsonb,
    'sourceHistory','[]'::jsonb,'autoLinks','[]'::jsonb,'entities','[]'::jsonb,'entityMentions','[]'::jsonb,
    'facts','[]'::jsonb,'factRelations','[]'::jsonb,'records','[]'::jsonb,'changeRequests','[]'::jsonb,
    'settings',jsonb_build_object(
      'freshnessMs',30000,'maxFreshRefresh',100,'ingestMaxItems',1000,'ingestBatch',100,
      'autoIndexKnowledge',true,'retrievalLimit',12,'retrievalMaxChars',12000,
      'analysisMaxItems',250,'analysisMaxCharacters',1500000
    ),
    'createdAt',now(),'updatedAt',now()
  ),
  now()
from public.orbitfs_workspaces w
where w.status <> 'archived'
and not exists(select 1 from public.orbitfs_library_state state_row where state_row.workspace_id=w.id);

with fallback_user as (
  select id from public.orbitfs_users where status='active' order by created_at limit 1
)
insert into public.orbitfs_profile_state(workspace_id,user_id,state,created_at,updated_at)
select
  w.id,
  coalesce(w.owner_id,w.created_by,(select id from fallback_user)),
  jsonb_build_object(
    'version',2,'enabled',false,
    'settings',jsonb_build_object(
      'startupMode','summary','loadUserSlots',true,'loadWorkspaceProfiles','[]'::jsonb,
      'maxProfiles',20,'maxProfileSizeBytes',52428800,'maxTotalProfileStorageBytes',0
    ),
    'roleOverrides','{}'::jsonb,'memberOverrides','{}'::jsonb,'profileTypes','[]'::jsonb,
    'profiles','[]'::jsonb,'profileBundles','[]'::jsonb,'userSlots','{}'::jsonb,
    'profileEditRequests','[]'::jsonb,'audit','[]'::jsonb
  ),
  now(),now()
from public.orbitfs_workspaces w
where w.status <> 'archived'
and not exists(select 1 from public.orbitfs_profile_state state_row where state_row.workspace_id=w.id);

notify pgrst,'reload schema';
