-- Production indexes for rebuilt module persistence.
create index if not exists idx_mcp_context_bundle_dependencies_bundle on public.mcp_context_bundle_dependencies(bundle_id);
create index if not exists idx_mcp_context_bundle_dependencies_depends_on on public.mcp_context_bundle_dependencies(depends_on_bundle_id);
create index if not exists idx_mcp_project_context_bundles_bundle on public.mcp_project_context_bundles(bundle_id);
create index if not exists idx_mcp_project_preset_bundles_project on public.mcp_project_preset_bundles(project_id);
create index if not exists idx_mcp_project_preset_bundles_bundle on public.mcp_project_preset_bundles(bundle_id);
create index if not exists idx_mcp_project_preset_items_project on public.mcp_project_preset_items(project_id);
create index if not exists idx_mcp_project_preset_profile_bundles_project on public.mcp_project_preset_profile_bundles(project_id);
create index if not exists idx_mcp_project_preset_profiles_project on public.mcp_project_preset_profiles(project_id);
create index if not exists idx_mcp_workspace_default_items_workspace on public.mcp_workspace_default_items(workspace_id);
create index if not exists idx_mcp_workspace_preset_items_workspace on public.mcp_workspace_preset_items(workspace_id);
create index if not exists idx_mcp_workspace_preset_profile_bundles_workspace on public.mcp_workspace_preset_profile_bundles(workspace_id);
create index if not exists idx_mcp_workspace_preset_profiles_workspace on public.mcp_workspace_preset_profiles(workspace_id);
create index if not exists idx_mcp_workspace_startup_projects_project on public.mcp_workspace_startup_projects(project_id);
create index if not exists idx_orbitfs_file_permissions_workspace on public.orbitfs_file_permissions(workspace_id);
create index if not exists idx_orbitfs_notifications_user on public.orbitfs_notifications(user_id);
create index if not exists idx_orbitfs_workspace_members_user on public.orbitfs_workspace_members(user_id);
create index if not exists idx_orbitfs_workspace_requests_workspace on public.orbitfs_workspace_requests(workspace_id);
create index if not exists idx_studio_analysis_findings_record on public.studio_analysis_findings(record_id);
create index if not exists idx_studio_analysis_records_run on public.studio_analysis_records(run_id);

create index if not exists idx_mcp_workspace_presets_project on public.mcp_workspace_presets(project_id);
create index if not exists idx_studio_analysis_sources_run on public.studio_analysis_sources(run_id);
create index if not exists idx_studio_analysis_sources_workspace on public.studio_analysis_sources(workspace_id);
create unique index if not exists ux_studio_analysis_records_run_record_key
  on public.studio_analysis_records(run_id,record_key) where record_key is not null;
