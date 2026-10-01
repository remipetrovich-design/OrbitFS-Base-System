-- OrbitFS Base migration 20260924103842: secure_runtime_secret_rls
-- Keep the private runtime secret inaccessible to normal API roles while
-- preserving the postgres-owned SECURITY DEFINER validator.

alter table private.orbitfs_runtime_secret enable row level security;
revoke all on table private.orbitfs_runtime_secret from anon, authenticated;
