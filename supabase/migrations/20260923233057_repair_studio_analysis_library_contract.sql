-- OrbitFS Base migration 20260923233057: repair_studio_analysis_library_contract
-- Exported from the authoritative V1-vercel-base Supabase migration history.

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
