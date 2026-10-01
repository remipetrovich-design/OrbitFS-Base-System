-- OrbitFS Base migration 20260923115257: orbitfs_restore_server_table_access
-- Exported from the authoritative V1-vercel-base Supabase migration history.

DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['orbitfs_users','orbitfs_workspaces','orbitfs_workspace_members','orbitfs_files','orbitfs_settings','orbitfs_license','orbitfs_addons','orbitfs_audit_log','orbitfs_sessions','orbitfs_groups','orbitfs_group_members','orbitfs_file_permissions','orbitfs_notifications','orbitfs_registration_requests','orbitfs_workspace_requests','orbitfs_profile_state','orbitfs_library_state'] LOOP EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t); END LOOP; END $$;
