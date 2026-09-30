import { timingSafeEqual } from 'node:crypto';
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getPanelLicenseSummary } from '$lib/server/license';
import { STORAGE_BUCKET } from '$lib/server/base-compat';
import { bootstrapBaseSetup, getBaseSetupState, registerInstallationRoute, type InstallationRoute } from '$lib/server/setup';
import { getSharedEngineHostState } from '$lib/server/engine-host-state';
import { ensureInstallationIdentity } from '$lib/server/license';

const LICENSE_MASTER_URL = String(env.ORBITFS_LICENSE_API_URL || '').trim().replace(/\/+$/, '');

function sameSecret(supplied:string,expected:string){
	const a=Buffer.from(supplied),b=Buffer.from(expected);
	return a.length===b.length&&a.length>0&&timingSafeEqual(a,b);
}

async function setupModel(origin = '') {
	const state = await getBaseSetupState();
	const engineHost = await getSharedEngineHostState().catch(() => null);
	const engineHostUrl = engineHost?.hostUrl || null;
	return {
		...state,
		coreRequired: ['Vercel runtime', 'OrbitFS database schema', 'Supabase Storage', 'Base System licence'],
		config: {
			publicOrigin: origin,
			backendPort: 'managed by Vercel',
			apiBase: '/api',
			deployMode: 'vercel',
			storageRoot: `Supabase Storage / ${STORAGE_BUCKET}`,
			workspaceRoot: 'Supabase orbitfs_workspaces + orbitfs_library_state',
			systemRoot: 'Supabase orbitfs_* tables',
			engineHostUrl: engineHostUrl || '',
			mcpEndpoint: engineHostUrl ? `${engineHostUrl}/mcp` : '',
			licenseApiUrl: LICENSE_MASTER_URL
		},
		steps: {
			runtime: { title: 'Vercel runtime', description: state.checks.environment.detail, complete: state.checks.environment.ok },
			database: { title: 'OrbitFS database', description: state.checks.database.detail, complete: state.checks.database.ok },
			storage: { title: 'Supabase Storage', description: state.checks.storage.detail, complete: state.checks.storage.ok },
			license: { title: 'Base System licence', description: state.checks.license.detail, complete: state.checks.license.ok },
			owner: { title: 'First Owner', description: state.checks.owner.detail, complete: state.checks.owner.ok },
			workspace: { title: 'Main workspace', description: state.checks.workspace.detail, complete: state.checks.workspace.ok }
		},
		installation: state.installation,
		addons: [
			{ id: 'mcp', name: 'OrbitFS MCP', linked: false, firstSetup: false, role: 'engine-component' },
			{ id: 'apex', name: 'OrbitFS APEX', linked: false, firstSetup: false, role: 'engine-component' },
			{ id: 'studio', name: 'OrbitFS Studio', linked: false, firstSetup: false, role: 'engine-component' }
		],
		notes: [
			'OrbitFS Panel is the main control plane.',
			'First-time Base setup prepares the database, storage, licence, Owner account and main workspace only.',
			'Workspace files and Library paths are virtual records backed by Supabase, not folders on a persistent server drive.',
			'MCP, APEX and Studio are Engine components. Base setup registers their manifests; the Shared Engine Host deployment installs the licensed components as part of the Engine release.',
			...(engineHostUrl ? [`Engine Host: ${engineHostUrl}`, `MCP endpoint: ${engineHostUrl}/mcp`] : ['No Engine Host is configured yet. This is expected during Base-only first-time setup.'])
		]
	};
}
function failure(error: any) { return json({ error: error?.message ?? 'Setup request failed' }, { status: Number(error?.status || 500) }); }
export async function GET({ params, url }) { try { if (String(params.rest || '') !== 'config') return json({ error: 'Not found' }, { status: 404 }); return json(await setupModel(url.origin)); } catch (error) { return failure(error); } }
export async function PUT({ params, url }) { try { if (String(params.rest || '') !== 'config') return json({ error: 'Not found' }, { status: 404 }); return json(await setupModel(url.origin)); } catch (error) { return failure(error); } }
export async function POST({ params, request, url }) { try { const rest = String(params.rest || ''); if (rest === 'bootstrap') { const body = await request.json().catch(() => ({})); const route = String(body.installationRoute || body.installRoute || '').toLowerCase() === 'billing_store' ? 'billing_store' : 'standard'; if (route === 'billing_store') { const expected = await ensureInstallationIdentity(); const supplied = String(request.headers.get('x-orbitfs-installation-id') || '').trim(); const expectedSecret=String(env.ORBITFS_DB_SECRET||'').trim(); const suppliedSecret=String(request.headers.get('x-orbitfs-db-secret')||'').trim(); if (!supplied || supplied !== expected) return json({ error: 'Billing Store installation identity does not match this Base installation' }, { status: 403 }); if(!expectedSecret||!sameSecret(suppliedSecret,expectedSecret)) return json({ error:'Billing Store bootstrap authorization failed' }, { status:403 }); } const installationId=await ensureInstallationIdentity(); await bootstrapBaseSetup({ installationRoute: route, registeredBy: body.registeredBy || null, deploymentId: body.deploymentId || null, projectId: body.projectId || null, installationId }); return json({ ok: true, ...(await setupModel(url.origin)) }); } if (rest === 'register-installation') { const expected=await ensureInstallationIdentity(); const supplied=String(request.headers.get('x-orbitfs-installation-id')||'').trim(); const expectedSecret=String(env.ORBITFS_DB_SECRET||'').trim(); const suppliedSecret=String(request.headers.get('x-orbitfs-db-secret')||'').trim(); if(!supplied||supplied!==expected||!expectedSecret||!sameSecret(suppliedSecret,expectedSecret)) return json({error:'Installation registration authorization failed'},{status:403}); const body = await request.json().catch(() => ({})); const route: InstallationRoute = String(body.installationRoute || '').toLowerCase() === 'billing_store' ? 'billing_store' : 'standard'; const registration = await registerInstallationRoute({ route, registeredBy: body.registeredBy || null, deploymentId: body.deploymentId || null, projectId: body.projectId || null, installationId: expected }); return json({ ok: true, installation: registration }); } if (rest === 'test-link') { const body = await request.json().catch(() => ({})); const target = String(body.target ?? ''); if (target === 'license') { const status = await getPanelLicenseSummary({ refresh: true }); return json({ ok: true, message: status.licensed ? 'Licence service connected and Base System is licensed.' : `Licence service connected (${status.reason ?? 'not activated'}).` }); } if (target === 'storage') { const state = await bootstrapBaseSetup(); return json({ ok: state.checks.storage.ok, message: state.checks.storage.detail }); } return json({ error: 'Unknown setup test target' }, { status: 400 }); } return json({ error: 'Not found' }, { status: 404 }); } catch (error) { return failure(error); } }
