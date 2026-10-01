-- OrbitFS Base migration 20260923131920: orbitfs_rebuild_module_persistence
-- Exported from the authoritative V1-vercel-base Supabase migration history.

-- OrbitFS Base module persistence reconstruction.
-- Canonical content lives in orbitfs_library_state; orbitfs_files remains legacy compatibility only.

create extension if not exists pgcrypto;

alter table public.orbitfs_users add column if not exists last_ip text;
alter table public.orbitfs_users add column if not exists last_user_agent text;

alter table public.orbitfs_workspace_members add constraint orbitfs_workspace_members_workspace_user_key unique (workspace_id,user_id);
alter table public.orbitfs_settings add constraint orbitfs_settings_scope_key_key unique (scope_type,scope_id,key);
alter table public.orbitfs_workspace_requests add column if not exists request_type text;
update public.orbitfs_workspace_requests set request_type=coalesce(request_type,type,'') where request_type is null;
alter table public.orbitfs_workspace_requests add column if not exists requested_by text;
alter table public.orbitfs_workspace_requests add column if not exists decided_by text;

create table if not exists public.orbitfs_profiles (
 id text primary key default gen_random_uuid()::text,
 workspace_id text not null references public.orbitfs_workspaces(id) on delete cascade,
 name text not null,
 type text not null default 'person',
 status text not null default 'active',
 classification text not null default 'standard',
 restricted boolean not null default false,
 srestricted boolean not null default false,
 fields jsonb not null default '{}'::jsonb,
 sections jsonb not null default '[]'::jsonb,
 editor_ids jsonb not null default '[]'::jsonb,
 viewer_ids jsonb not null default '[]'::jsonb,
 version integer not null default 1,
 created_by text,
 updated_by text,
 deleted_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table if not exists public.mcp_projects (
 id text primary key default gen_random_uuid()::text,
 workspace_id text not null references public.orbitfs_workspaces(id) on delete cascade,
 name text not null,
 description text not null default '',
 created_by_user_id text,
 created_by_username text,
 config jsonb not null default '{}'::jsonb,
 status text not null default 'active',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table if not exists public.mcp_project_items (
 id text primary key default gen_random_uuid()::text,
 project_id text not null references public.mcp_projects(id) on delete cascade,
 item_type text not null default 'file',
 item_path text not null default '',
 missing boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table if not exists public.mcp_context_bundles (
 id text primary key default gen_random_uuid()::text,
 workspace_id text not null references public.orbitfs_workspaces(id) on delete cascade,
 name text not null,
 description text not null default '',
 version integer not null default 1,
 enabled boolean not null default true,
 created_by_user_id text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table if not exists public.mcp_context_bundle_entries (
 id text primary key default gen_random_uuid()::text,
 bundle_id text not null references public.mcp_context_bundles(id) on delete cascade,
 entry_type text not null default 'file',
 item_path text not null default '',
 attachment_type text not null default 'path',
 profile_id text,
 profile_name text,
 knowledge_item_id text,
 knowledge_item_name text,
 load_mode text,
 recursive_flag boolean not null default false,
 required_flag boolean not null default true,
 priority integer not null default 100,
 sort_order integer not null default 0,
 created_at timestamptz not null default now()
);

create table if not exists public.mcp_context_bundle_dependencies (
 id text primary key default gen_random_uuid()::text,
 bundle_id text not null references public.mcp_context_bundles(id) on delete cascade,
 depends_on_bundle_id text not null references public.mcp_context_bundles(id) on delete cascade,
 required_flag boolean not null default true,
 sort_order integer not null default 0,
 created_at timestamptz not null default now()
);

create table if not exists public.mcp_project_context_bundles (
 id text primary key default gen_random_uuid()::text,
 project_id text not null references public.mcp_projects(id) on delete cascade,
 bundle_id text not null references public.mcp_context_bundles(id) on delete cascade,
 required_flag boolean not null default true,
 sort_order integer not null default 0,
 created_at timestamptz not null default now(),
 unique(project_id,bundle_id)
);

create table if not exists public.mcp_workspace_startup (
 workspace_id text primary key references public.orbitfs_workspaces(id) on delete cascade,
 strength text not null default 'medium',
 instructions text not null default '',
 ai_behaviour text not null default '',
 updated_by_user_id text,
 updated_at timestamptz not null default now()
);

create table if not exists public.mcp_workspace_startup_projects (
 id text primary key default gen_random_uuid()::text,
 workspace_id text not null references public.orbitfs_workspaces(id) on delete cascade,
 project_id text not null references public.mcp_projects(id) on delete cascade,
 sort_order integer not null default 0,
 unique(workspace_id,project_id)
);

create table if not exists public.mcp_workspace_default_profiles (
 id text primary key default gen_random_uuid()::text,
 workspace_id text not null references public.orbitfs_workspaces(id) on delete cascade,
 profile_id text not null,
 sort_order integer not null default 0,
 unique(workspace_id,profile_id)
);
create table if not exists public.mcp_workspace_default_profile_bundles (
 id text primary key default gen_random_uuid()::text,
 workspace_id text not null references public.orbitfs_workspaces(id) on delete cascade,
 profile_bundle_id text not null,
 sort_order integer not null default 0,
 unique(workspace_id,profile_bundle_id)
);
create table if not exists public.mcp_workspace_default_items (
 id text primary key default gen_random_uuid()::text,
 workspace_id text not null references public.orbitfs_workspaces(id) on delete cascade,
 item_type text not null default 'file',
 item_path text not null default '',
 recursive_flag boolean not null default false,
 sort_order integer not null default 0
);
create table if not exists public.mcp_workspace_preset_items (
 id text primary key default gen_random_uuid()::text,
 workspace_id text not null references public.orbitfs_workspaces(id) on delete cascade,
 preset text not null,
 item_path text not null default '',
 recursive_flag boolean not null default false,
 sort_order integer not null default 0
);
create table if not exists public.mcp_workspace_preset_profiles (
 id text primary key default gen_random_uuid()::text,
 workspace_id text not null references public.orbitfs_workspaces(id) on delete cascade,
 preset text not null,
 profile_id text not null,
 sort_order integer not null default 0
);
create table if not exists public.mcp_workspace_preset_profile_bundles (
 id text primary key default gen_random_uuid()::text,
 workspace_id text not null references public.orbitfs_workspaces(id) on delete cascade,
 preset text not null,
 profile_bundle_id text not null,
 sort_order integer not null default 0
);
create table if not exists public.mcp_workspace_preset_metadata (
 id text primary key default gen_random_uuid()::text,
 workspace_id text not null references public.orbitfs_workspaces(id) on delete cascade,
 preset text not null,
 display_name text,
 description text,
 metadata jsonb not null default '{}'::jsonb,
 updated_at timestamptz not null default now(),
 unique(workspace_id,preset)
);

create table if not exists public.mcp_project_preset_items (
 id text primary key default gen_random_uuid()::text,
 project_id text not null references public.mcp_projects(id) on delete cascade,
 preset text not null,
 item_path text not null default '',
 recursive_flag boolean not null default false,
 sort_order integer not null default 0
);
create table if not exists public.mcp_project_preset_profiles (
 id text primary key default gen_random_uuid()::text,
 project_id text not null references public.mcp_projects(id) on delete cascade,
 preset text not null,
 profile_id text not null,
 sort_order integer not null default 0
);
create table if not exists public.mcp_project_preset_profile_bundles (
 id text primary key default gen_random_uuid()::text,
 project_id text not null references public.mcp_projects(id) on delete cascade,
 preset text not null,
 profile_bundle_id text not null,
 sort_order integer not null default 0
);
create table if not exists public.mcp_project_preset_metadata (
 id text primary key default gen_random_uuid()::text,
 project_id text not null references public.mcp_projects(id) on delete cascade,
 preset text not null,
 display_name text,
 description text,
 metadata jsonb not null default '{}'::jsonb,
 updated_at timestamptz not null default now(),
 unique(project_id,preset)
);
create table if not exists public.mcp_project_preset_bundles (
 id text primary key default gen_random_uuid()::text,
 project_id text not null references public.mcp_projects(id) on delete cascade,
 preset text not null,
 bundle_id text not null references public.mcp_context_bundles(id) on delete cascade,
 required_flag boolean not null default true,
 sort_order integer not null default 0
);

create table if not exists public.mcp_clients (
 id text primary key,
 client_name text not null default '',
 user_id text,
 status text not null default 'active',
 metadata jsonb not null default '{}'::jsonb,
 redirect_uris jsonb not null default '[]'::jsonb,
 workspace_ids jsonb not null default '[]'::jsonb,
 permissions jsonb not null default '{}'::jsonb,
 last_seen_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table if not exists public.mcp_sessions (
 id text primary key default gen_random_uuid()::text,
 client_id text not null,
 user_id text,
 username text,
 status text not null default 'active',
 workspace_ids jsonb not null default '[]'::jsonb,
 metadata jsonb not null default '{}'::jsonb,
 last_seen_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table if not exists public.mcp_active_contexts (
 id text primary key default gen_random_uuid()::text,
 user_id text not null,
 client_id text,
 workspace_id text not null references public.orbitfs_workspaces(id) on delete cascade,
 context_key text not null,
 receipt jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table if not exists public.mcp_oauth_clients (
 client_id text primary key,
 client_name text not null default '',
 redirect_uris jsonb not null default '[]'::jsonb,
 scope text not null default 'orbitfs:read',
 client_uri text,
 logo_uri text,
 application_type text,
 token_endpoint_auth_method text,
 registration_access_token_hash text,
 metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table if not exists public.mcp_oauth_codes (
 code_hash text primary key,
 client_id text not null,
 user_id text not null,
 redirect_uri text not null,
 scope text not null,
 resource text not null,
 code_challenge text not null,
 code_challenge_method text not null default 'S256',
 expires_at timestamptz not null,
 consumed_at timestamptz
);

create table if not exists public.mcp_oauth_tokens (
 access_token_hash text primary key,
 refresh_token_hash text,
 client_id text not null,
 user_id text not null,
 scope text not null,
 resource text not null,
 expires_at timestamptz not null,
 refresh_expires_at timestamptz,
 revoked_at timestamptz,
 last_used_at timestamptz,
 created_at timestamptz not null default now()
);

create table if not exists public.mcp_audit_log (
 id text primary key default gen_random_uuid()::text,
 scope_id text not null default 'public',
 actor_user_id text,
 event_type text not null,
 details jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);

create table if not exists public.studio_documents (
 id text primary key default gen_random_uuid()::text,
 workspace_id text not null references public.orbitfs_workspaces(id) on delete cascade,
 kind text not null default 'document',
 subtype text not null default 'general',
 title text not null,
 status text not null default 'draft',
 content_format text not null default 'md',
 content_text text not null default '',
 summary text,
 entry_date text,
 current_revision integer not null default 1,
 owner_user_id text,
 created_by_user_id text,
 created_by text,
 visibility text not null default 'private',
 profile_ids jsonb not null default '[]'::jsonb,
 save_location text not null default '',
 metadata_json jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table if not exists public.studio_revisions (
 id text primary key default gen_random_uuid()::text,
 document_id text not null references public.studio_documents(id) on delete cascade,
 revision_no integer not null,
 content_text text not null default '',
 content_hash text not null default '',
 change_note text not null default '',
 created_by text,
 created_at timestamptz not null default now(),
 unique(document_id,revision_no)
);

create table if not exists public.studio_shares (
 id text primary key default gen_random_uuid()::text,
 workspace_id text not null references public.orbitfs_workspaces(id) on delete cascade,
 document_id text not null references public.studio_documents(id) on delete cascade,
 user_id text not null,
 permission text not null default 'read',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(document_id,user_id)
);

create table if not exists public.studio_analysis_runs (
 id text primary key default gen_random_uuid()::text,
 workspace_id text not null references public.orbitfs_workspaces(id) on delete cascade,
 scope_type text not null default 'workspace',
 scope_json jsonb not null default '{}'::jsonb,
 status text not null default 'running',
 phase text not null default 'inventory',
 progress integer not null default 0,
 created_by_user_id text,
 created_by text,
 started_at timestamptz,
 completed_at timestamptz,
 source_count integer not null default 0,
 record_count integer not null default 0,
 finding_count integer not null default 0,
 summary_json jsonb not null default '{}'::jsonb,
 provider_json jsonb not null default '{}'::jsonb,
 error_text text,
 updated_at timestamptz not null default now(),
 created_at timestamptz not null default now()
);

create table if not exists public.studio_analysis_records (
 id text primary key default gen_random_uuid()::text,
 run_id text not null references public.studio_analysis_runs(id) on delete cascade,
 source_id text,
 source_type text,
 title text,
 content_text text,
 entry_date text,
 record_type text,
 profile_id text,
 metadata_json jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);

create table if not exists public.studio_analysis_findings (
 id text primary key default gen_random_uuid()::text,
 run_id text not null references public.studio_analysis_runs(id) on delete cascade,
 record_id text references public.studio_analysis_records(id) on delete cascade,
 finding_type text not null default 'review',
 target_system text,
 target_item_id text,
 target_section_id text,
 confidence numeric not null default 0,
 score_json jsonb not null default '{}'::jsonb,
 explanation text not null default '',
 target_json jsonb,
 proposal_json jsonb,
 status text not null default 'candidate',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

alter table public.orbitfs_profiles enable row level security;
alter table public.mcp_projects enable row level security;
alter table public.mcp_project_items enable row level security;
alter table public.mcp_context_bundles enable row level security;
alter table public.mcp_context_bundle_entries enable row level security;
alter table public.mcp_context_bundle_dependencies enable row level security;
alter table public.mcp_project_context_bundles enable row level security;
alter table public.mcp_workspace_startup enable row level security;
alter table public.mcp_workspace_startup_projects enable row level security;
alter table public.mcp_workspace_default_profiles enable row level security;
alter table public.mcp_workspace_default_profile_bundles enable row level security;
alter table public.mcp_workspace_default_items enable row level security;
alter table public.mcp_workspace_preset_items enable row level security;
alter table public.mcp_workspace_preset_profiles enable row level security;
alter table public.mcp_workspace_preset_profile_bundles enable row level security;
alter table public.mcp_workspace_preset_metadata enable row level security;
alter table public.mcp_project_preset_items enable row level security;
alter table public.mcp_project_preset_profiles enable row level security;
alter table public.mcp_project_preset_profile_bundles enable row level security;
alter table public.mcp_project_preset_metadata enable row level security;
alter table public.mcp_project_preset_bundles enable row level security;
alter table public.mcp_clients enable row level security;
alter table public.mcp_sessions enable row level security;
alter table public.mcp_active_contexts enable row level security;
alter table public.mcp_oauth_clients enable row level security;
alter table public.mcp_oauth_codes enable row level security;
alter table public.mcp_oauth_tokens enable row level security;
alter table public.mcp_audit_log enable row level security;
alter table public.studio_documents enable row level security;
alter table public.studio_revisions enable row level security;
alter table public.studio_shares enable row level security;
alter table public.studio_analysis_runs enable row level security;
alter table public.studio_analysis_records enable row level security;
alter table public.studio_analysis_findings enable row level security;

do $$ declare t text; begin
 foreach t in array array[
 'orbitfs_profiles','mcp_projects','mcp_project_items','mcp_context_bundles','mcp_context_bundle_entries',
 'mcp_context_bundle_dependencies','mcp_project_context_bundles','mcp_workspace_startup','mcp_workspace_startup_projects',
 'mcp_workspace_default_profiles','mcp_workspace_default_profile_bundles','mcp_workspace_default_items',
 'mcp_workspace_preset_items','mcp_workspace_preset_profiles','mcp_workspace_preset_profile_bundles','mcp_workspace_preset_metadata',
 'mcp_project_preset_items','mcp_project_preset_profiles','mcp_project_preset_profile_bundles','mcp_project_preset_metadata',
 'mcp_project_preset_bundles','mcp_clients','mcp_sessions','mcp_active_contexts','mcp_oauth_clients','mcp_oauth_codes',
 'mcp_oauth_tokens','mcp_audit_log','studio_documents','studio_revisions','studio_shares','studio_analysis_runs',
 'studio_analysis_records','studio_analysis_findings'
 ] loop
  execute format('grant all on table public.%I to service_role',t);
 end loop; end $$;

create index if not exists idx_orbitfs_profiles_workspace on public.orbitfs_profiles(workspace_id);
create index if not exists idx_mcp_projects_workspace on public.mcp_projects(workspace_id);
create index if not exists idx_mcp_project_items_project on public.mcp_project_items(project_id);
create index if not exists idx_mcp_context_bundles_workspace on public.mcp_context_bundles(workspace_id);
create index if not exists idx_mcp_context_bundle_entries_bundle on public.mcp_context_bundle_entries(bundle_id);
create index if not exists idx_mcp_project_context_bundles_project on public.mcp_project_context_bundles(project_id);
create index if not exists idx_mcp_workspace_startup_projects_workspace on public.mcp_workspace_startup_projects(workspace_id);
create index if not exists idx_mcp_active_contexts_workspace on public.mcp_active_contexts(workspace_id);
create index if not exists idx_studio_documents_workspace on public.studio_documents(workspace_id);
create index if not exists idx_studio_revisions_document on public.studio_revisions(document_id);
create index if not exists idx_studio_shares_workspace_user on public.studio_shares(workspace_id,user_id);
create index if not exists idx_studio_analysis_runs_workspace on public.studio_analysis_runs(workspace_id);
create index if not exists idx_studio_analysis_findings_run on public.studio_analysis_findings(run_id);
