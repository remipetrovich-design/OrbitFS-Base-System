import { env } from '$env/dynamic/private';
import { getSupabaseAdmin } from '$lib/server/supabase';

const ACTIVE_RELEASE_KEY = 'updates.active_release';

function objectValue(value: unknown): Record<string, any> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function clean(value: unknown) {
	return String(value ?? '').trim();
}

function cleanSha256(value: unknown) {
	const normalized = clean(value).toLowerCase();
	return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

async function readStoredActiveRelease() {
	const db = getSupabaseAdmin();
	const result = await db
		.from('orbitfs_settings')
		.select('value')
		.eq('scope_type', 'global')
		.eq('scope_id', '')
		.eq('key', ACTIVE_RELEASE_KEY)
		.maybeSingle();
	if (result.error) throw result.error;
	return objectValue(result.data?.value);
}

export async function resolveInstalledBaseVersion() {
	const configured = clean(env.ORBITFS_APP_VERSION || env.ORBITFS_PANEL_RELEASE_VERSION);
	if (configured) return configured;
	const current = await readStoredActiveRelease();
	return clean(current.panelVersion || current.base?.version || current.version) || null;
}

export async function syncBaseRuntimeReleaseIdentity() {
	const version = clean(env.ORBITFS_APP_VERSION || env.ORBITFS_PANEL_RELEASE_VERSION);
	if (!version) return readStoredActiveRelease();

	const channel = clean(env.ORBITFS_RELEASE_CHANNEL || 'stable').toLowerCase() || 'stable';
	const suppliedReleaseId = clean(env.ORBITFS_BASE_RELEASE_ID) || null;
	const suppliedSourceCommit = clean(env.ORBITFS_BASE_SOURCE_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA) || null;
	const suppliedSha256 = cleanSha256(env.ORBITFS_BASE_RELEASE_SHA256);
	const schemaVersion = clean(env.ORBITFS_SCHEMA_VERSION) || null;
	const deploymentId = clean(process.env.VERCEL_DEPLOYMENT_ID) || null;
	const stamp = new Date().toISOString();

	const db = getSupabaseAdmin();
	const current = await readStoredActiveRelease();
	const currentVersion = clean(current.panelVersion || current.version);
	const sameVersion = currentVersion === version;
	const baseCurrent = objectValue(current.base);

	const releaseId = suppliedReleaseId || (sameVersion ? clean(baseCurrent.releaseId || current.releaseId) || null : null);
	const sourceCommit = suppliedSourceCommit || (sameVersion ? clean(baseCurrent.sourceCommit || current.panelCommit) || null : null);
	const sha256 = suppliedSha256 || (sameVersion ? cleanSha256(baseCurrent.sha256) : null);

	const unchanged =
		sameVersion &&
		clean(baseCurrent.channel || current.releaseChannel || 'stable').toLowerCase() === channel &&
		clean(baseCurrent.releaseId) === clean(releaseId) &&
		clean(baseCurrent.sourceCommit) === clean(sourceCommit) &&
		clean(baseCurrent.sha256).toLowerCase() === clean(sha256).toLowerCase() &&
		clean(baseCurrent.deploymentId) === clean(deploymentId) &&
		clean(current.schemaVersion) === clean(schemaVersion);

	if (unchanged) return current;

	const activatedAt = sameVersion && clean(current.activatedAt) ? current.activatedAt : stamp;
	const base = {
		version,
		releaseId,
		channel,
		sourceCommit,
		sha256,
		deploymentId,
		observedAt: stamp,
		source: 'runtime-environment'
	};

	const record = {
		...current,
		version,
		panelVersion: version,
		releaseId,
		schemaVersion,
		panelCommit: sourceCommit,
		releaseChannel: channel,
		activatedAt,
		base
	};

	const saved = await db.from('orbitfs_settings').upsert({
		scope_type: 'global',
		scope_id: '',
		key: ACTIVE_RELEASE_KEY,
		value: record,
		updated_at: stamp
	}, { onConflict: 'scope_type,scope_id,key' });
	if (saved.error) throw saved.error;
	return record;
}
