-- OrbitFS Base migration 20260923113654: secure_orbitfs_server_tables_rls
-- Exported from the authoritative V1-vercel-base Supabase migration history.

ALTER TABLE public.orbitfs_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orbitfs_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orbitfs_workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orbitfs_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orbitfs_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orbitfs_license ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orbitfs_addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orbitfs_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orbitfs_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orbitfs_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orbitfs_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orbitfs_file_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orbitfs_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orbitfs_registration_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orbitfs_workspace_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orbitfs_profile_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orbitfs_library_state ENABLE ROW LEVEL SECURITY;

-- The Base application performs privileged server-side setup with the Supabase
-- service role. Keep all browser/anon access denied by default.
REVOKE ALL ON public.orbitfs_users FROM anon, authenticated;
REVOKE ALL ON public.orbitfs_workspaces FROM anon, authenticated;
REVOKE ALL ON public.orbitfs_workspace_members FROM anon, authenticated;
REVOKE ALL ON public.orbitfs_files FROM anon, authenticated;
REVOKE ALL ON public.orbitfs_settings FROM anon, authenticated;
REVOKE ALL ON public.orbitfs_license FROM anon, authenticated;
REVOKE ALL ON public.orbitfs_addons FROM anon, authenticated;
REVOKE ALL ON public.orbitfs_audit_log FROM anon, authenticated;
REVOKE ALL ON public.orbitfs_sessions FROM anon, authenticated;
REVOKE ALL ON public.orbitfs_groups FROM anon, authenticated;
REVOKE ALL ON public.orbitfs_group_members FROM anon, authenticated;
REVOKE ALL ON public.orbitfs_file_permissions FROM anon, authenticated;
REVOKE ALL ON public.orbitfs_notifications FROM anon, authenticated;
REVOKE ALL ON public.orbitfs_registration_requests FROM anon, authenticated;
REVOKE ALL ON public.orbitfs_workspace_requests FROM anon, authenticated;
REVOKE ALL ON public.orbitfs_profile_state FROM anon, authenticated;
REVOKE ALL ON public.orbitfs_library_state FROM anon, authenticated;
