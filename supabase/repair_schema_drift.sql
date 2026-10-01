-- Repair schema drift introduced by the module persistence rebuild.
-- Removes duplicate equivalent UNIQUE constraints and closes the unused
-- SECURITY DEFINER event-trigger function to public API execution.

alter table public.orbitfs_settings
  drop constraint if exists orbitfs_settings_scope_key_key;

alter table public.orbitfs_workspace_members
  drop constraint if exists orbitfs_workspace_members_workspace_user_key;

revoke execute on function public.rls_auto_enable() from public;
revoke execute on function public.rls_auto_enable() from anon;
revoke execute on function public.rls_auto_enable() from authenticated;

-- Keep the canonical unique constraints used by application upserts:
-- orbitfs_settings_scope_type_scope_id_key_key
-- orbitfs_workspace_members_workspace_id_user_id_key
