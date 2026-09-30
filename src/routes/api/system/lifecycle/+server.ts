import { timingSafeEqual } from 'node:crypto';
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getSupabaseAdmin } from '$lib/server/supabase';
import { getBaseSetupState, resetInstallationRegistration } from '$lib/server/setup';
import { getSharedEngineHostState } from '$lib/server/engine-host-state';
import { ensureInstallationIdentity, resetPanelLicenseInstallationState } from '$lib/server/license';

const LIFECYCLE_KEY = 'installation.lifecycle';
const RESET_ENVIRONMENT = [
	'SUPABASE_URL',
	'SUPABASE_PUBLISHABLE_KEY',
	'SUPABASE_SECRET_KEY',
	'ORBITFS_DB_SECRET',
	'ORBITFS_INSTALLATION_ID',
	'ORBITFS_ENGINE_HOST_URL',
	'ORBITFS_ENGINE_HOST_PREVIEW_URL',
	'ORBITFS_ENGINE_SECRET',
	'ORBITFS_VERCEL_TOKEN',
	'ORBITFS_VERCEL_TEAM_ID'
] as const;

function sameSecret(supplied: string, expected: string) {
	const a = Buffer.from(supplied);
	const b = Buffer.from(expected);
	return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

async function authorize(request: Request) {
	const expectedId = await ensureInstallationIdentity();
	const suppliedId = String(request.headers.get('x-orbitfs-installation-id') || '').trim();
	const expectedSecret = String(env.ORBITFS_DB_SECRET || '').trim();
	const suppliedSecret = String(request.headers.get('x-orbitfs-db-secret') || '').trim();
	if (!suppliedId || suppliedId !== expectedId || !expectedSecret || !sameSecret(suppliedSecret, expectedSecret)) {
		throw Object.assign(new Error('Lifecycle authorization failed'), { status: 403, code: 'LIFECYCLE_UNAUTHORIZED' });
	}
	return expectedId;
}

async function model(installationId: string) {
	const [setup, engineHost] = await Promise.all([
		getBaseSetupState(),
		getSharedEngineHostState().catch(() => null)
	]);
	return {
		ok: true,
		service: 'orbitfs-base',
		protocolVersion: 2,
		installationId,
		setup: {
			complete: setup.setupComplete,
			currentStep: setup.currentStep,
			coreReady: setup.coreReady,
			licenseReady: setup.licenseReady
		},
		engineHost: engineHost
			? {
					state: engineHost.state,
					projectId: engineHost.projectId,
					projectName: engineHost.projectName,
					hostUrl: engineHost.hostUrl,
					deploymentId: engineHost.deploymentId
				}
			: null,
		statelessRuntime: true,
		databaseOwnedExternally: true
	};
}

function cleanupPlan(mode: 'undeploy' | 'uninstall') {
	return {
		resetDeployerToStage1: true,
		clearSavedSupabaseConnection: true,
		clearDeploymentEnvironment: [...RESET_ENVIRONMENT],
		removeEngineDeployment: true,
		removeBaseDeployment: true,
		unregisterInstallationFromLicenseManager: mode === 'uninstall',
		preserveCustomerDatabase: true,
		note:
			mode === 'uninstall'
				? 'Uninstall must unregister the installation in License Manager before Base local installation state is reset. Customer database contents are preserved unless the external deployer provides a separately approved destructive data-removal flow.'
				: 'Undeploy removes runtime/deployer configuration but keeps authoritative installation and customer data registration available for redeploy.'
	};
}

function failure(error: any) {
	return json(
		{ ok: false, error: error?.message || 'Lifecycle request failed', code: error?.code || 'LIFECYCLE_FAILED' },
		{ status: Number(error?.status || 500) }
	);
}

export async function GET({ request }: any) {
	try {
		return json(await model(await authorize(request)), { headers: { 'cache-control': 'no-store' } });
	} catch (error) {
		return failure(error);
	}
}

export async function POST({ request }: any) {
	try {
		const installationId = await authorize(request);
		const body = await request.json().catch(() => ({}));
		const action = String(body.action || '').toLowerCase();
		const mode = String(body.mode || '').toLowerCase();
		if (!['undeploy', 'uninstall'].includes(mode)) {
			return json({ ok: false, error: 'Lifecycle mode must be undeploy or uninstall', code: 'LIFECYCLE_MODE_INVALID' }, { status: 400 });
		}
		const lifecycleMode = mode as 'undeploy' | 'uninstall';
		const db = getSupabaseAdmin();

		if (action === 'prepare') {
			const snapshot = await model(installationId);
			const value = {
				version: 2,
				mode: lifecycleMode,
				state: 'prepared',
				preparedAt: new Date().toISOString(),
				installationId,
				engineHost: snapshot.engineHost,
				cleanup: cleanupPlan(lifecycleMode)
			};
			const saved = await db.from('orbitfs_settings').upsert(
				{ scope_type: 'global', scope_id: '', key: LIFECYCLE_KEY, value, updated_at: new Date().toISOString() },
				{ onConflict: 'scope_type,scope_id,key' }
			);
			if (saved.error) throw saved.error;
			return json(
				{ ...snapshot, prepared: true, mode: lifecycleMode, lifecycle: value },
				{ headers: { 'cache-control': 'no-store' } }
			);
		}

		if (action === 'finalize') {
			const prepared = await db.from('orbitfs_settings').select('value').eq('scope_type', 'global').eq('scope_id', '').eq('key', LIFECYCLE_KEY).maybeSingle();
			if (prepared.error) throw prepared.error;
			const preparedValue = prepared.data?.value as any;
			if (!preparedValue || preparedValue.state !== 'prepared' || preparedValue.mode !== lifecycleMode || preparedValue.installationId !== installationId) {
				throw Object.assign(new Error('Matching lifecycle prepare step is required before finalization'), {
					status: 409,
					code: 'LIFECYCLE_PREPARE_REQUIRED'
				});
			}
			if (body.deployerStateReset !== true) {
				throw Object.assign(new Error('Deployer Stage-1 state has not been confirmed reset'), {
					status: 409,
					code: 'DEPLOYER_RESET_REQUIRED'
				});
			}

			if (lifecycleMode === 'uninstall' && body.authorityUnregistered !== true) {
				throw Object.assign(new Error('License Manager installation unregistration must complete before uninstall finalization'), {
					status: 409,
					code: 'LICENSE_MANAGER_UNREGISTER_REQUIRED'
				});
			}

			if (lifecycleMode === 'uninstall') {
				await resetInstallationRegistration();
				await resetPanelLicenseInstallationState();
			} else {
				const removed = await db.from('orbitfs_settings').delete().eq('scope_type', 'global').eq('scope_id', '').eq('key', LIFECYCLE_KEY);
				if (removed.error) throw removed.error;
			}

			return json(
				{
					ok: true,
					service: 'orbitfs-base',
					protocolVersion: 2,
					mode: lifecycleMode,
					finalized: true,
					localInstallationReset: lifecycleMode === 'uninstall',
					authorityUnregistered: lifecycleMode === 'uninstall' ? true : null,
					deployerStateReset: true,
					nextStage: 1,
					nextRequiredAction: 'connect_supabase',
					cleanup: cleanupPlan(lifecycleMode)
				},
				{ headers: { 'cache-control': 'no-store' } }
			);
		}

		return json({ ok: false, error: 'Lifecycle action must be prepare or finalize', code: 'LIFECYCLE_ACTION_REQUIRED' }, { status: 400 });
	} catch (error) {
		return failure(error);
	}
}
