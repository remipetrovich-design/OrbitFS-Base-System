-- OrbitFS Base migration 20260923185111: repair_library_contract
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
