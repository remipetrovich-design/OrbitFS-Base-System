import { env } from '$env/dynamic/private';
import { getStoredLicenseCredential } from '$lib/server/license';
import { getSupabaseAdmin } from '$lib/server/supabase';

const SETTING_KEY = 'updater.connection';
const DEFAULT_PROVIDER = 'https://incendiarynetworks.cc/api/v1/updater';
const DEFAULT_CHANNEL = 'stable';

export type UpdaterConnectionMode = 'auto' | 'manual';

export type UpdaterConnectionSettings = {
	mode: UpdaterConnectionMode;
	providerBase: string;
	autoProviderBase: string;
	manualProviderBase: string | null;
	source: 'manual' | 'engine_env' | 'license_env' | 'default';
	connected: boolean;
	authorized: boolean | null;
	lastVerifiedAt: string | null;
	lastStatus: number | null;
	lastCode: string | null;
	lastError: string | null;
};

function objectValue(value: unknown): Record<string, any> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function privateHostname(hostname: string) {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
	if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
	if (host === '::1' || (host.includes(':') && (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')))) return true;
	if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
	const match = host.match(/^172\.(\d+)\./);
	if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true;
	return false;
}

export function normalizeUpdaterProviderBase(value: unknown, label = 'Updater URL') {
	const raw = String(value || '').trim().replace(/\/+$/, '');
	if (!raw) throw Object.assign(new Error(`${label} is required`), { status: 400, code: 'UPDATER_URL_REQUIRED' });
	try {
		const url = new URL(raw);
		const path = url.pathname.replace(/\/+$/, '');
		if (
			url.protocol !== 'https:' ||
			url.username ||
			url.password ||
			url.search ||
			url.hash ||
			path !== '/api/v1/updater' ||
			privateHostname(url.hostname)
		) throw new Error();
		return `${url.protocol}//${url.host}${path}`;
	} catch {
		throw Object.assign(new Error(`${label} must be a public HTTPS /api/v1/updater endpoint`), {
			status: 400,
			code: 'UPDATER_URL_INVALID'
		});
	}
}

function deriveUpdaterFromLicense(value: unknown) {
	const raw = String(value || '').trim();
	if (!raw) return null;
	try {
		const url = new URL(raw);
		if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
		const path = url.pathname.replace(/\/+$/, '');
		if (!path.endsWith('/api/v1/license')) return null;
		url.pathname = path.slice(0, -'/license'.length) + '/updater';
		url.search = '';
		url.hash = '';
		return normalizeUpdaterProviderBase(url.toString(), 'Derived updater URL');
	} catch {
		return null;
	}
}

function automaticProvider() {
	const explicit = String(env.ORBITFS_ENGINE_RELEASE_PROVIDER || '').trim();
	if (explicit) return { providerBase: normalizeUpdaterProviderBase(explicit, 'ORBITFS_ENGINE_RELEASE_PROVIDER'), source: 'engine_env' as const };
	const derived = deriveUpdaterFromLicense(env.ORBITFS_LICENSE_API_URL);
	if (derived) return { providerBase: derived, source: 'license_env' as const };
	return { providerBase: DEFAULT_PROVIDER, source: 'default' as const };
}

async function readStored() {
	const db = getSupabaseAdmin();
	const result = await db
		.from('orbitfs_settings')
		.select('value')
		.eq('scope_type', 'global')
		.eq('scope_id', '')
		.eq('key', SETTING_KEY)
		.maybeSingle();
	if (result.error) throw result.error;
	return objectValue(result.data?.value);
}

function resolvedFrom(stored: Record<string, any>): UpdaterConnectionSettings {
	const automatic = automaticProvider();
	const manual = stored.manualProviderBase
		? normalizeUpdaterProviderBase(stored.manualProviderBase, 'Manual updater URL')
		: null;
	const mode: UpdaterConnectionMode = stored.mode === 'manual' && manual ? 'manual' : 'auto';
	const providerBase = mode === 'manual' && manual ? manual : automatic.providerBase;
	const sameProvider = stored.providerBase === providerBase;
	return {
		mode,
		providerBase,
		autoProviderBase: automatic.providerBase,
		manualProviderBase: manual,
		source: mode === 'manual' ? 'manual' : automatic.source,
		connected: sameProvider && stored.connected === true,
		authorized: sameProvider && typeof stored.authorized === 'boolean' ? stored.authorized : null,
		lastVerifiedAt: sameProvider && typeof stored.lastVerifiedAt === 'string' ? stored.lastVerifiedAt : null,
		lastStatus: sameProvider && stored.lastStatus !== null && stored.lastStatus !== undefined && Number.isFinite(Number(stored.lastStatus)) ? Number(stored.lastStatus) : null,
		lastCode: sameProvider && typeof stored.lastCode === 'string' ? stored.lastCode : null,
		lastError: sameProvider && typeof stored.lastError === 'string' ? stored.lastError : null
	};
}

export async function getUpdaterConnectionSettings() {
	return resolvedFrom(await readStored());
}

export async function resolveUpdaterProviderBase() {
	return (await getUpdaterConnectionSettings()).providerBase;
}

function candidateSettings(input: Record<string, any>, current: UpdaterConnectionSettings) {
	const automatic = automaticProvider();
	const mode: UpdaterConnectionMode = input.mode === 'manual' ? 'manual' : 'auto';
	const manual = mode === 'manual'
		? normalizeUpdaterProviderBase(input.providerBase || input.manualProviderBase, 'Manual updater URL')
		: current.manualProviderBase;
	return {
		mode,
		providerBase: mode === 'manual' ? manual! : automatic.providerBase,
		autoProviderBase: automatic.providerBase,
		manualProviderBase: manual,
		source: mode === 'manual' ? 'manual' as const : automatic.source
	};
}

async function probe(providerBase: string) {
	let identity: { installationId: string; licenseKey: string } | null = null;
	try {
		identity = await getStoredLicenseCredential();
	} catch (error: any) {
		if (String(error?.code || '') !== 'LICENSE_KEY_REQUIRED') throw error;
	}
	const url = new URL(providerBase);
	url.searchParams.set('product', 'orbitfs_base');
	url.searchParams.set('channel', String(env.ORBITFS_UPDATE_CHANNEL || DEFAULT_CHANNEL).trim().toLowerCase() || DEFAULT_CHANNEL);
	url.searchParams.set('type', 'update');
	const headers: Record<string, string> = {
		accept: 'application/json',
		'x-orbitfs-client': 'orbitfs-base-updater-connection'
	};
	if (identity) {
		headers['x-license-key'] = identity.licenseKey;
		headers['x-installation-id'] = identity.installationId;
	}
	let response: Response;
	try {
		response = await fetch(url, {
			method: 'GET',
			headers,
			cache: 'no-store',
			signal: AbortSignal.timeout(Math.max(5_000, Number(env.ORBITFS_ENGINE_RELEASE_TIMEOUT_MS || 30_000)))
		});
	} catch (error: any) {
		return {
			connected: false,
			authorized: identity ? false : null,
			status: null,
			code: 'UPDATER_UNREACHABLE',
			error: String(error?.message || error || 'Updater request failed'),
			release: null
		};
	}
	const body: any = await response.json().catch(() => ({}));
	const code = String(body?.code || '');
	const endpointRecognized =
		response.ok ||
		(response.status === 404 && code === 'RELEASE_NOT_FOUND') ||
		(response.status === 401 && code === 'LICENSE_KEY_REQUIRED') ||
		(response.status === 403 && Boolean(code));
	const authorized = identity
		? (response.ok || (response.status === 404 && code === 'RELEASE_NOT_FOUND'))
		: null;
	return {
		connected: endpointRecognized,
		authorized,
		status: response.status,
		code: code || (response.ok ? 'OK' : 'UPDATER_ERROR'),
		error: endpointRecognized ? null : String(body?.error || body?.message || code || `Updater returned HTTP ${response.status}`),
		release: body?.release ? {
			id: body.release.id || null,
			version: body.release.version || null,
			channel: body.release.channel || null,
			components: Array.isArray(body.release.components) ? body.release.components : []
		} : null
	};
}

export async function testUpdaterConnection(input: Record<string, any> = {}) {
	const current = await getUpdaterConnectionSettings();
	const candidate = Object.keys(input).length ? candidateSettings(input, current) : current;
	const checked = await probe(candidate.providerBase);
	return {
		...candidate,
		connected: checked.connected,
		authorized: checked.authorized,
		lastVerifiedAt: new Date().toISOString(),
		lastStatus: checked.status,
		lastCode: checked.code,
		lastError: checked.error,
		release: checked.release
	};
}

export async function saveUpdaterConnection(input: Record<string, any>) {
	const tested = await testUpdaterConnection(input);
	if (!tested.connected) {
		throw Object.assign(new Error(tested.lastError || 'Updater connection could not be verified'), {
			status: 409,
			code: tested.lastCode || 'UPDATER_CONNECTION_FAILED'
		});
	}
	const value = {
		version: 1,
		mode: tested.mode,
		manualProviderBase: tested.manualProviderBase,
		providerBase: tested.providerBase,
		connected: tested.connected,
		authorized: tested.authorized,
		lastVerifiedAt: tested.lastVerifiedAt,
		lastStatus: tested.lastStatus,
		lastCode: tested.lastCode,
		lastError: tested.lastError,
		updatedAt: new Date().toISOString()
	};
	const db = getSupabaseAdmin();
	const result = await db.from('orbitfs_settings').upsert({
		scope_type: 'global',
		scope_id: '',
		key: SETTING_KEY,
		value,
		updated_at: value.updatedAt
	}, { onConflict: 'scope_type,scope_id,key' });
	if (result.error) throw result.error;
	return resolvedFrom(value);
}
