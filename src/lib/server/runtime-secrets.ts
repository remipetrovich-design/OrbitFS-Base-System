import { createHmac } from 'node:crypto';
import { env } from '$env/dynamic/private';

function configured(name: 'ORBITFS_DB_SECRET' | 'ORBITFS_ENGINE_SECRET' | 'SUPABASE_SECRET_KEY') {
	return String(env[name] || '').trim();
}

function derived(label: string) {
	const root = configured('SUPABASE_SECRET_KEY');
	if (!root) return '';
	return createHmac('sha256', root).update(`orbitfs:${label}:v1`).digest('base64url');
}

export function vercelCredentialEncryptionSecret() {
	return configured('ORBITFS_DB_SECRET') || derived('vercel-credential-encryption');
}

export function engineSharedSecret() {
	return configured('ORBITFS_ENGINE_SECRET') || configured('ORBITFS_DB_SECRET') || derived('engine-host-shared-secret');
}

export function engineDatabaseCredentials() {
	const configuredSecret = configured('ORBITFS_DB_SECRET');
	const serviceKey = configured('SUPABASE_SECRET_KEY');
	const dbSecret = configuredSecret || derived('database-runtime-secret');
	if (dbSecret) return { mode: 'server-secret' as const, dbSecret, serviceKey, derived: !configuredSecret };
	return { mode: 'missing' as const, dbSecret: '', serviceKey, derived: false };
}
