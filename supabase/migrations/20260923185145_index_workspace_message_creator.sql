-- OrbitFS Base migration 20260923185145: index_workspace_message_creator
-- Exported from the authoritative V1-vercel-base Supabase migration history.

create index if not exists idx_orbitfs_workspace_messages_created_by on public.orbitfs_workspace_messages(created_by);
