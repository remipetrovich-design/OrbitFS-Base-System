import { createHash, randomUUID } from 'node:crypto';
import { getSupabaseAdmin } from '$lib/server/supabase';
import { getSharedEngineHostState } from '$lib/server/engine-host-state';
import { ensureInstallationIdentity } from '$lib/server/license';

const CHECKPOINTS_KEY = 'updates.checkpoints';
const ACTIVE_RELEASE_KEY = 'updates.active_release';
const MAX_CHECKPOINTS = 20;
const SENSITIVE_KEY = /(secret|token|password|credential|api[_-]?key|private[_-]?key|license[_-]?key)/i;
const SENSITIVE_SETTING_KEYS = new Set(['vercel.connection']);

export type UpdateCheckpoint = {
	format: 'orbitfs-update-checkpoint-v1';
	id: string;
	createdAt: string;
	createdBy: { id: string; username: string };
	reason: string;
	targetVersion: string | null;
	installationId: string;
	activeRelease: Record<string, any> | null;
	panel: {
		environment: string;
		branch: string;
		commit: string | null;
		commitMessage: string | null;
		deploymentUrl: string | null;
		productionUrl: string | null;
	};
	engineHost: Record<string, any>;
	addons: Array<Record<string, any>>;
	safeGlobalSettings: Array<{ key: string; value: unknown; updatedAt: string | null }>;
	fingerprint: string;
};

function objectValue(value: unknown): Record<string, any> | null {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null;
}

function sanitize(value: unknown, depth = 0): unknown {
	if (depth > 8) return '[truncated]';
	if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitize(item, depth + 1));
	if (!value || typeof value !== 'object') return value;
	const output: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
		if (SENSITIVE_KEY.test(key)) {
			output[key] = '[redacted]';
			continue;
		}
		output[key] = sanitize(item, depth + 1);
	}
	return output;
}

async function readGlobalSetting(key: string) {
	const db = getSupabaseAdmin();
	const result = await db.from('orbitfs_settings').select('value').eq('scope_type', 'global').eq('scope_id', '').eq('key', key).maybeSingle();
	if (result.error) throw result.error;
	return result.data?.value ?? null;
}

async function readCheckpointList(): Promise<UpdateCheckpoint[]> {
	const value = await readGlobalSetting(CHECKPOINTS_KEY);
	if (!Array.isArray(value)) return [];
	return value.filter((item: any) => item?.format === 'orbitfs-update-checkpoint-v1' && item?.id);
}

async function safeGlobalSettings() {
	const db = getSupabaseAdmin();
	const result = await db
		.from('orbitfs_settings')
		.select('key,value,updated_at')
		.eq('scope_type', 'global')
		.eq('scope_id', '')
		.limit(250);
	if (result.error) throw result.error;
	return (result.data || [])
		.filter((row: any) => {
			const key = String(row.key || '');
			return key && key !== CHECKPOINTS_KEY && !SENSITIVE_SETTING_KEYS.has(key) && !SENSITIVE_KEY.test(key);
		})
		.map((row: any) => ({ key: String(row.key), value: sanitize(row.value), updatedAt: row.updated_at || null }));
}

async function addonState() {
	const db = getSupabaseAdmin();
	const result = await db
		.from('orbitfs_addons')
		.select('id,name,installed,attached,configured,available,runtime,config,updated_at')
		.order('id', { ascending: true });
	if (result.error) throw result.error;
	return (result.data || []).map((row: any) => ({
		id: String(row.id),
		name: String(row.name || row.id),
		installed: row.installed === true,
		attached: row.attached === true,
		configured: row.configured === true,
		available: row.available !== false,
		runtime: sanitize(row.runtime),
		config: sanitize(row.config),
		updatedAt: row.updated_at || null
	}));
}

function panelDeployment(origin?: string) {
	const vercelUrl = String(process.env.VERCEL_URL || '').trim();
	const production = String(process.env.VERCEL_PROJECT_PRODUCTION_URL || '').trim();
	return {
		environment: process.env.VERCEL_ENV || 'local',
		branch: process.env.VERCEL_GIT_COMMIT_REF || 'main',
		commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
		commitMessage: process.env.VERCEL_GIT_COMMIT_MESSAGE || null,
		deploymentUrl: vercelUrl ? `https://${vercelUrl}` : origin || null,
		productionUrl: production ? `https://${production}` : origin || null
	};
}

export async function listUpdateCheckpoints() {
	return readCheckpointList();
}

export async function createUpdateCheckpoint(input: {
	actor: { id: string; username: string };
	targetVersion?: string | null;
	reason?: string | null;
	origin?: string;
}) {
	const createdAt = new Date().toISOString();
	const [installationId, activeReleaseValue, engineHost, addons, settings] = await Promise.all([
		ensureInstallationIdentity(),
		readGlobalSetting(ACTIVE_RELEASE_KEY),
		getSharedEngineHostState(),
		addonState(),
		safeGlobalSettings()
	]);
	const activeRelease = objectValue(activeReleaseValue);
	const base = {
		format: 'orbitfs-update-checkpoint-v1' as const,
		id: randomUUID(),
		createdAt,
		createdBy: { id: String(input.actor.id), username: String(input.actor.username) },
		reason: String(input.reason || 'pre-update').slice(0, 120),
		targetVersion: String(input.targetVersion || '').trim().slice(0, 64) || null,
		installationId,
		activeRelease,
		panel: panelDeployment(input.origin),
		engineHost: sanitize(engineHost) as Record<string, any>,
		addons,
		safeGlobalSettings: settings
	};
	const fingerprint = createHash('sha256').update(JSON.stringify(base)).digest('hex');
	const checkpoint: UpdateCheckpoint = { ...base, fingerprint };
	const existing = await readCheckpointList();
	const next = [checkpoint, ...existing.filter((item) => item.id !== checkpoint.id)].slice(0, MAX_CHECKPOINTS);
	const db = getSupabaseAdmin();
	const saved = await db.from('orbitfs_settings').upsert({
		scope_type: 'global',
		scope_id: '',
		key: CHECKPOINTS_KEY,
		value: next,
		updated_at: createdAt
	}, { onConflict: 'scope_type,scope_id,key' });
	if (saved.error) throw saved.error;
	return checkpoint;
}

export async function getActiveRelease(): Promise<Record<string, any> | null> {
	const value = await readGlobalSetting(ACTIVE_RELEASE_KEY);
	return objectValue(value);
}

export async function setEngineActiveRelease(value: {
	version: string;
	releaseId: string;
	sha256: string;
	sourceCommit?: string | null;
	components?: string[];
	componentVersions?: Record<string, string | null>;
	fileInventory?: Array<{ file: string; component: string; sha256: string; size: number }>;
	deploymentId?: string | null;
	activatedAt?: string | null;
}) {
	const stamp = value.activatedAt || new Date().toISOString();
	const current = (await getActiveRelease()) || {};
	const engine = {
		version: String(value.version),
		releaseId: String(value.releaseId),
		sha256: String(value.sha256),
		sourceCommit: value.sourceCommit || null,
		components: Array.isArray(value.components) ? value.components : [],
		componentVersions: value.componentVersions && typeof value.componentVersions === 'object' ? value.componentVersions : {},
		fileInventory: Array.isArray(value.fileInventory) ? value.fileInventory : [],
		deploymentId: value.deploymentId || null,
		activatedAt: stamp
	};
	const record = { ...current, version: current.version || null, panelVersion: current.panelVersion || null, engineReleaseVersion: String(value.version), engine };
	const db = getSupabaseAdmin();
	const result = await db.from('orbitfs_settings').upsert({
		scope_type: 'global', scope_id: '', key: ACTIVE_RELEASE_KEY, value: record, updated_at: stamp
	}, { onConflict: 'scope_type,scope_id,key' });
	if (result.error) throw result.error;
	return record;
}

// An Engine uninstall must not leave an active updater baseline pointing at
// a deleted Vercel project. Preserve Base release and historical checkpoints.
export async function clearEngineActiveRelease(expectedReleaseId: string | null) {
	const current = (await getActiveRelease()) || {};
	const installed = String(current.engine?.releaseId || '').trim();
	if (installed && installed !== String(expectedReleaseId || '').trim()) {
		throw Object.assign(new Error('Engine release identity changed during uninstall.'),{status:409,code:'ENGINE_UNINSTALL_RELEASE_CHANGED'});
	}
	const { engine: _engine, ...remaining } = current;
	const stamp = new Date().toISOString();
	const record = { ...remaining, engineReleaseVersion: null };
	const result = await getSupabaseAdmin().from('orbitfs_settings').upsert({
		scope_type:'global', scope_id:'', key:ACTIVE_RELEASE_KEY, value:record, updated_at:stamp
	},{onConflict:'scope_type,scope_id,key'});
	if(result.error) throw result.error;
	return record;
}

export async function setActiveRelease(value: {
	version: string;
	releaseId?: string | null;
	schemaVersion?: string | null;
	components?: string[];
	panelCommit?: string | null;
	engineReleaseVersion?: string | null;
}) {
	const stamp = new Date().toISOString();
	const current = (await getActiveRelease()) || {};
	const record = {
		...current,
		version: String(value.version),
		panelVersion: String(value.version),
		releaseId: value.releaseId || null,
		schemaVersion: value.schemaVersion || null,
		components: Array.isArray(value.components) ? value.components : [],
		panelCommit: value.panelCommit || null,
		engineReleaseVersion: value.engineReleaseVersion || current.engineReleaseVersion || current.engine?.version || null,
		activatedAt: stamp
	};
	const db = getSupabaseAdmin();
	const result = await db.from('orbitfs_settings').upsert({
		scope_type: 'global', scope_id: '', key: ACTIVE_RELEASE_KEY, value: record, updated_at: stamp
	}, { onConflict: 'scope_type,scope_id,key' });
	if (result.error) throw result.error;
	return record;
}


export async function findEngineRollbackCheckpoint(currentReleaseId?: string | null) {
	const currentId=String(currentReleaseId||'').trim();
	const checkpoints=await readCheckpointList();
	for(const checkpoint of checkpoints){
		const active=objectValue(checkpoint.activeRelease);
		const engine=objectValue(active?.engine);
		const releaseId=String(engine?.releaseId||'').trim();
		const version=String(engine?.version||'').trim();
		if(!releaseId||!version||releaseId===currentId)continue;
		const engineHost=objectValue(checkpoint.engineHost);
		const channel=String(engineHost?.releaseChannel||'').trim().toLowerCase()||null;
		return {
			checkpoint,
			releaseId,
			version,
			channel,
			componentVersions:engine?.componentVersions&&typeof engine.componentVersions==='object'?engine.componentVersions:{}
		};
	}
	return null;
}
