import { env } from '$env/dynamic/private';
import { getSupabaseAdmin } from '$lib/server/supabase';
import { STORAGE_BUCKET } from '$lib/server/base-compat';
import { ensureCloudAddonRecord } from '$lib/server/cloud-addons';
import { getPanelLicenseSummary } from '$lib/server/license';

export type SetupStep = 'core' | 'license' | 'owner' | 'workspace' | 'complete';
export type InstallationRoute = 'billing_store' | 'standard';

const INSTALLATION_ROUTE_KEY = 'installation.route';

function normalizeInstallationRoute(value: unknown): InstallationRoute {
	return String(value || '').trim().toLowerCase() === 'billing_store' ? 'billing_store' : 'standard';
}

export async function getInstallationRoute() {
	const db = getSupabaseAdmin();
	const result = await db.from('orbitfs_settings').select('value').eq('scope_type', 'global').eq('scope_id', '').eq('key', INSTALLATION_ROUTE_KEY).maybeSingle();
	if (result.error) throw result.error;
	const value = result.data?.value;
	const runtimeRoute = normalizeInstallationRoute(env.ORBITFS_INSTALLATION_ROUTE);
	return {
		route: normalizeInstallationRoute((value as any)?.route || runtimeRoute),
		registered: Boolean(value && typeof value === 'object' && (value as any).registeredAt),
		registeredAt: value && typeof value === 'object' ? String((value as any).registeredAt || '') || null : null,
		registeredBy: value && typeof value === 'object' ? String((value as any).registeredBy || '') || null : null,
		deploymentId: value && typeof value === 'object' ? String((value as any).deploymentId || '') || null : null,
		projectId: value && typeof value === 'object' ? String((value as any).projectId || '') || null : null,
		installationId: value && typeof value === 'object' ? String((value as any).installationId || '') || null : null
	};
}

export async function registerInstallationRoute(input: {
	route: InstallationRoute;
	registeredBy?: string | null;
	deploymentId?: string | null;
	projectId?: string | null;
	installationId?: string | null;
}) {
	const db = getSupabaseAdmin();
	const current = await getInstallationRoute();
	const requestedRoute = normalizeInstallationRoute(input.route);
	if (current.registered && current.route !== requestedRoute) {
		throw Object.assign(new Error(`Installation route is already registered as ${current.route} and cannot be changed to ${requestedRoute}.`), { status: 409, code: 'INSTALLATION_ROUTE_LOCKED' });
	}
	const requestedProjectId = String(input.projectId || '').trim() || null;
	const requestedInstallationId = String(input.installationId || '').trim() || null;
	const runtimeProjectId = String(env.VERCEL_PROJECT_ID || '').trim() || null;
	const runtimeDeploymentId = String(env.VERCEL_DEPLOYMENT_ID || '').trim() || null;
	if (current.projectId && requestedProjectId && current.projectId !== requestedProjectId) {
		throw Object.assign(new Error('This Base installation is already locked to another Vercel project. Base updates must redeploy the registered project instead of creating or adopting a new one.'), { status: 409, code: 'BASE_PROJECT_LOCKED' });
	}
	if (current.projectId && runtimeProjectId && current.projectId !== runtimeProjectId) {
		throw Object.assign(new Error('The running Base deployment does not match the registered Vercel project.'), { status: 409, code: 'BASE_PROJECT_MISMATCH' });
	}
	if (current.installationId && requestedInstallationId && current.installationId !== requestedInstallationId) {
		throw Object.assign(new Error('This Base installation identity is already registered and cannot be replaced during an update.'), { status: 409, code: 'INSTALLATION_ID_LOCKED' });
	}
	const next = {
		route: requestedRoute,
		registeredAt: current.registeredAt || new Date().toISOString(),
		registeredBy: input.registeredBy || current.registeredBy || null,
		deploymentId: input.deploymentId || runtimeDeploymentId || current.deploymentId || null,
		projectId: requestedProjectId || current.projectId || runtimeProjectId || null,
		installationId: requestedInstallationId || current.installationId || null,
		version: 2
	};
	const existing = await db.from('orbitfs_settings').select('id').eq('scope_type', 'global').eq('scope_id', '').eq('key', INSTALLATION_ROUTE_KEY).maybeSingle();
	if (existing.error) throw existing.error;
	if (existing.data?.id) {
		const updated = await db.from('orbitfs_settings').update({ value: next, updated_at: new Date().toISOString() }).eq('id', existing.data.id).select('value').single();
		if (updated.error) throw updated.error;
		return { ...next, registered: true };
	}
	const created = await db.from('orbitfs_settings').insert({
		scope_type: 'global',
		scope_id: '',
		key: INSTALLATION_ROUTE_KEY,
		value: next,
		updated_at: new Date().toISOString()
	}).select('value').single();
	if (!created.error && created.data) return { ...next, registered: true };
	if (created.error?.code === '23505') {
		const raced = await db.from('orbitfs_settings').select('id').eq('scope_type', 'global').eq('scope_id', '').eq('key', INSTALLATION_ROUTE_KEY).maybeSingle();
		if (raced.error || !raced.data?.id) throw raced.error ?? created.error;
		const updated = await db.from('orbitfs_settings').update({ value: next, updated_at: new Date().toISOString() }).eq('id', raced.data.id).select('value').single();
		if (updated.error) throw updated.error;
		return { ...next, registered: true };
	}
	throw created.error ?? new Error('Could not register installation route');
}

export async function resetInstallationRegistration() {
	const db = getSupabaseAdmin();
	for (const key of [INSTALLATION_ROUTE_KEY, 'installation.lifecycle']) {
		const removed = await db.from('orbitfs_settings').delete().eq('scope_type', 'global').eq('scope_id', '').eq('key', key);
		if (removed.error) throw removed.error;
	}
	return { registered: false, route: 'standard' as InstallationRoute };
}

const REQUIRED_TABLES = [
	'orbitfs_users',
	'orbitfs_groups',
	'orbitfs_group_members',
	'orbitfs_workspaces',
	'orbitfs_workspace_members',
	'orbitfs_file_permissions',
	'orbitfs_registration_requests',
	'orbitfs_sessions',
	'orbitfs_settings',
	'orbitfs_license',
	'orbitfs_addons',
	'orbitfs_audit_log',
	'orbitfs_library_state',
	'orbitfs_profile_state'
] as const;

const REQUIRED_TABLE_COLUMNS: Partial<Record<(typeof REQUIRED_TABLES)[number], string>> = {
	orbitfs_users:'id,username,display_name,email,password_hash,role,status,permissions,must_change_pin,ban_reason,created_at,updated_at',
	orbitfs_groups:'id,name,permissions,created_at,updated_at',
	orbitfs_group_members:'group_id,user_id,created_at',
	orbitfs_workspaces:'id,name,slug,status,visibility,is_main,owner_id,created_by,mcp_system_enabled,mcp_ui_enabled,apex_system_enabled',
	orbitfs_workspace_members:'workspace_id,user_id,role,mcp_enabled,created_at,updated_at',
	orbitfs_file_permissions:'workspace_id,path_prefix,principal_type,principal_id,can_view,can_edit,can_download,can_move,can_delete,can_create,can_share,can_manage_permissions,inherit',
	orbitfs_registration_requests:'id,username,email,credential_hash,credential_type,status,requested_at,decided_at,decided_by,created_user_id',
	orbitfs_sessions:'id,user_id,token_hash,user_agent,ip_address,expires_at,last_seen_at,created_at',
	orbitfs_settings:'id,scope_type,scope_id,key,value,updated_at',
	orbitfs_addons:'id,name,version,license_component,available,installed,attached,configured,status,deployment_url,transport_path,source_ref,config,manifest,runtime,installed_at,updated_at',
	orbitfs_library_state:'id,workspace_id,state,updated_at',
	orbitfs_profile_state:'id,workspace_id,user_id,state,created_at,updated_at'
};

function configured(value: unknown) {
	return Boolean(String(value ?? '').trim());
}

async function tableReady(name: (typeof REQUIRED_TABLES)[number]) {
	try {
		const db = getSupabaseAdmin();
		const columns = REQUIRED_TABLE_COLUMNS[name] || '*';
		const { error } = await db.from(name).select(columns, { count: 'exact', head: true });
		return { ok: !error, detail: error?.message || 'Available' };
	} catch (error) {
		return { ok: false, detail: error instanceof Error ? error.message : 'Unavailable' };
	}
}

export async function getBaseSetupState() {
	const supabaseKey = configured(env.SUPABASE_SECRET_KEY);
	const envReady = configured(env.SUPABASE_URL) && supabaseKey;
	const tableChecks = envReady ? await Promise.all(REQUIRED_TABLES.map(async (name) => [name, await tableReady(name)] as const)) : [];
	const tables = Object.fromEntries(tableChecks) as Record<string, { ok: boolean; detail: string }>;
	const schemaReady = envReady && REQUIRED_TABLES.every((name) => tables[name]?.ok === true);
	const schemaFailures = envReady
		? REQUIRED_TABLES.filter((name) => tables[name]?.ok !== true).map((name) => ({ name, detail: tables[name]?.detail || 'Unavailable' }))
		: [];

	let storageReady = false;
	let storageDetail = envReady ? 'Storage bucket unavailable' : 'Supabase environment is incomplete';
	let licenseReady = false;
	let licenseDetail = 'Base System licence has not been activated';
	let licenseReason: string | null = 'LICENSE_REQUIRED';
	let ownerExists = false;
	let ownerId: string | null = null;
	let mainWorkspaceId: string | null = null;

	if (envReady && schemaReady) {
		const db = getSupabaseAdmin();
		const [bucket, owner, workspace, license] = await Promise.all([
			db.storage.getBucket(STORAGE_BUCKET),
			db.from('orbitfs_users').select('id').eq('role', 'owner').eq('status', 'active').limit(1).maybeSingle(),
			db.from('orbitfs_workspaces').select('id').eq('is_main', true).neq('status', 'archived').limit(1).maybeSingle(),
			getPanelLicenseSummary().catch((error) => ({ licensed: false, reason: error instanceof Error ? error.message : 'LICENSE_CHECK_FAILED' }))
		]);
		storageReady = !bucket.error && Boolean(bucket.data);
		storageDetail = storageReady ? `${STORAGE_BUCKET} is available` : bucket.error?.message || `${STORAGE_BUCKET} is missing`;
		licenseReady = license.licensed === true;
		licenseReason = licenseReady ? null : String(license.reason || 'LICENSE_REQUIRED');
		licenseDetail = licenseReady ? 'OrbitFS Base System licence is active' : `Base System licence required (${licenseReason})`;
		if (!owner.error && owner.data?.id) {
			ownerExists = true;
			ownerId = String(owner.data.id);
		}
		if (!workspace.error && workspace.data?.id) mainWorkspaceId = String(workspace.data.id);
	}

	const coreReady = envReady && schemaReady && storageReady;
	const setupComplete = coreReady && licenseReady && ownerExists && Boolean(mainWorkspaceId);
	const installation = envReady && schemaReady ? await getInstallationRoute() : { route: 'standard' as InstallationRoute, registered: false, registeredAt: null, registeredBy: null, deploymentId: null, projectId: null, installationId: null };
	const currentStep: SetupStep = !coreReady ? 'core' : !licenseReady ? 'license' : !ownerExists ? 'owner' : !mainWorkspaceId ? 'workspace' : 'complete';

	return {
		setupComplete,
		needsSetup: !setupComplete,
		currentStep,
		coreReady,
		licenseReady,
		licenseReason,
		ownerExists,
		ownerId,
		mainWorkspaceId,
		installation,
		checks: {
			environment: {
				ok: envReady,
				detail: envReady ? 'Supabase server environment is configured' : 'SUPABASE_URL and SUPABASE_SECRET_KEY are required'
			},
			database: {
				ok: schemaReady,
				detail: schemaReady
					? 'Required OrbitFS Base tables are available'
					: `OrbitFS Base database schema is incomplete: ${schemaFailures.map((failure) => `${failure.name} (${failure.detail})`).join('; ') || 'required schema objects are unavailable'}`,
				tables,
				failures: schemaFailures
			},
			storage: { ok: storageReady, detail: storageDetail },
			license: { ok: licenseReady, detail: licenseDetail, reason: licenseReason },
			owner: { ok: ownerExists, detail: ownerExists ? 'Active Owner exists' : 'First Owner has not been created' },
			workspace: { ok: Boolean(mainWorkspaceId), detail: mainWorkspaceId ? 'Main workspace is available' : 'Main workspace has not been initialized' }
		}
	};
}

export async function ensureStorageBucket() {
	const db = getSupabaseAdmin();
	const existing = await db.storage.getBucket(STORAGE_BUCKET);
	if (existing.data) {
		if (existing.data.public !== false) {
			const updated = await db.storage.updateBucket(STORAGE_BUCKET, { public: false });
			if (updated.error) throw updated.error;
			return updated.data ?? existing.data;
		}
		return existing.data;
	}
	if (existing.error && !String(existing.error.message || '').toLowerCase().includes('not found')) throw existing.error;
	const created = await db.storage.createBucket(STORAGE_BUCKET, { public: false });
	if (!created.error && created.data) return created.data;
	if (String(created.error?.message || '').toLowerCase().includes('already')) {
		const retry = await db.storage.getBucket(STORAGE_BUCKET);
		if (retry.error || !retry.data) throw retry.error ?? created.error;
		if (retry.data.public !== false) {
			const updated = await db.storage.updateBucket(STORAGE_BUCKET, { public: false });
			if (updated.error) throw updated.error;
			return updated.data ?? retry.data;
		}
		return retry.data;
	}
	throw created.error ?? new Error('Could not create storage bucket');
}

export async function ensureDefaultWorkspace(ownerId: string) {
	const db = getSupabaseAdmin();
	const desired = {
		name: 'Public Workspace',
		description: 'Default workspace available to panel users.',
		status: 'active',
		visibility: 'public',
		is_main: true,
		delete_protected: true,
		storage_quota_bytes: 5 * 1024 ** 3,
		created_by: ownerId
	};
	let workspaceId: string | null = null;
	const existing = await db.from('orbitfs_workspaces').select('id').eq('slug', 'public-workspace').maybeSingle();
	if (existing.error) throw existing.error;
	if (existing.data?.id) {
		workspaceId = String(existing.data.id);
		const updated = await db.from('orbitfs_workspaces').update(desired).eq('id', workspaceId);
		if (updated.error) throw updated.error;
	} else {
		const created = await db.from('orbitfs_workspaces').insert({ ...desired, slug: 'public-workspace' }).select('id').single();
		if (created.error || !created.data?.id) {
			if (created.error?.code === '23505') {
				const raced = await db.from('orbitfs_workspaces').select('id').eq('slug', 'public-workspace').maybeSingle();
				if (raced.error || !raced.data?.id) throw raced.error ?? created.error;
				workspaceId = String(raced.data.id);
				const updated = await db.from('orbitfs_workspaces').update(desired).eq('id', workspaceId);
				if (updated.error) throw updated.error;
			} else {
				throw created.error ?? new Error('Could not create Public Workspace');
			}
		} else {
			workspaceId = String(created.data.id);
		}
	}
	const member = await db.from('orbitfs_workspace_members').upsert(
		{ workspace_id: workspaceId, user_id: ownerId, role: 'owner' },
		{ onConflict: 'workspace_id,user_id' }
	);
	if (member.error) throw member.error;
	await ensureWorkspaceState(workspaceId, ownerId);
	return workspaceId;
}

async function ensureWorkspaceState(workspaceId: string, ownerId: string) {
	const db = getSupabaseAdmin();
	const library = await db.from('orbitfs_library_state').select('id').eq('workspace_id', workspaceId).maybeSingle();
	if (library.error) throw library.error;
	if (!library.data) {
		const state = { version: 9, workspaceId, items: [], collections: [], groups: [], categories: [], links: [], usage: [], sections: [], events: [], sourceHistory: [], autoLinks: [], entities: [], entityMentions: [], facts: [], factRelations: [], records: [], changeRequests: [], settings: { freshnessMs: 30000, maxFreshRefresh: 100, ingestMaxItems: 1000, ingestBatch: 100, autoIndexKnowledge: true, retrievalLimit: 12, retrievalMaxChars: 12000, analysisMaxItems: 250, analysisMaxCharacters: 1500000 }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
		const created = await db.from('orbitfs_library_state').insert({ workspace_id: workspaceId, state, updated_at: new Date().toISOString() });
		if (created.error && created.error.code !== '23505') throw created.error;
	}
	const profile = await db.from('orbitfs_profile_state').select('id').eq('workspace_id', workspaceId).maybeSingle();
	if (profile.error) throw profile.error;
	if (!profile.data) {
		const state = { version: 2, enabled: false, settings: { startupMode: 'summary', loadUserSlots: true, loadWorkspaceProfiles: [], maxProfiles: 20, maxProfileSizeBytes: 50 * 1024 * 1024, maxTotalProfileStorageBytes: 0 }, roleOverrides: {}, memberOverrides: {}, profileTypes: [], profiles: [], profileBundles: [], userSlots: {}, profileEditRequests: [], audit: [] };
		const created = await db.from('orbitfs_profile_state').insert({ workspace_id: workspaceId, user_id: ownerId, state, updated_at: new Date().toISOString() });
		if (created.error && created.error.code !== '23505') throw created.error;
	}
}

async function ensureFreshEngineRegistry() {
	const db = getSupabaseAdmin();
	for (const id of Object.keys({
		mcp: true,
		apex: true,
		studio: true
	})) {
		await ensureCloudAddonRecord(id);
	}
}

export async function bootstrapBaseSetup(input: { installationRoute?: InstallationRoute; registeredBy?: string | null; deploymentId?: string | null; projectId?: string | null; installationId?: string | null } = {}) {
	const before = await getBaseSetupState();
	if (!before.checks.environment.ok) throw Object.assign(new Error(before.checks.environment.detail), { status: 503 });
	if (!before.checks.database.ok) throw Object.assign(new Error(`${before.checks.database.detail}. Apply the current Base schema migration chain before continuing.`), { status: 503, code: 'BASE_SCHEMA_INCOMPLETE' });
	await Promise.all([ensureStorageBucket(), ensureFreshEngineRegistry()]);
	await registerInstallationRoute({ route: input.installationRoute || before.installation.route, registeredBy: input.registeredBy, deploymentId: input.deploymentId, projectId: input.projectId, installationId: input.installationId || before.installation.installationId || null });
	if (before.ownerId) await ensureDefaultWorkspace(before.ownerId);
	return getBaseSetupState();
}
