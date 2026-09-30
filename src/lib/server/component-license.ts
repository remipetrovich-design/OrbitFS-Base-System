import { getSupabaseAdmin } from '$lib/server/supabase';
import { componentLicensed, getPanelLicenseSummary } from '$lib/server/license';

const LABELS: Record<string,string> = {
	orbitfs_base: 'OrbitFS Base System',
	orbitfs_mcp: 'OrbitFS MCP',
	orbitfs_apex: 'OrbitFS APEX',
	orbitfs_studio: 'OrbitFS Studio'
};

export async function assertComponentLicensed(componentId: string) {
	const summary = await getPanelLicenseSummary();
	if (!summary.licensed) {
		throw Object.assign(new Error('OrbitFS Base System licence is required'), {
			status: 403, code: 'LICENSE_REQUIRED', componentId: 'orbitfs_base', license: summary
		});
	}
	const component = summary.components?.[componentId] ?? null;
	if (!componentLicensed(component || {})) {
		throw Object.assign(new Error(`${LABELS[componentId] || componentId} licence is required`), {
			status: 403, code: 'COMPONENT_LICENSE_REQUIRED', componentId, component
		});
	}
	if (componentId !== 'orbitfs_base') {
		const db = getSupabaseAdmin();
		const addon = await db.from('orbitfs_addons').select('id,installed,attached,configured,status,deployment_url,runtime').eq('license_component', componentId).maybeSingle();
		if (addon.error) throw addon.error;
		if (!addon.data?.installed) throw Object.assign(new Error(`${LABELS[componentId] || componentId} is not installed on this Base panel`), {status:403,code:'COMPONENT_NOT_INSTALLED',componentId});
		if (!addon.data.attached) throw Object.assign(new Error(`${LABELS[componentId] || componentId} is not attached to this installation`), {status:403,code:'COMPONENT_NOT_ATTACHED',componentId});
	}
	return { summary, component };
}

export async function assertComponentRuntimeReady(componentId: string) {
	const result = await assertComponentLicensed(componentId);
	if (componentId === 'orbitfs_base') return result;
	const db = getSupabaseAdmin();
	const addon = await db.from('orbitfs_addons').select('id,installed,attached,configured,status,deployment_url,runtime').eq('license_component', componentId).maybeSingle();
	if (addon.error) throw addon.error;
	const deploymentUrl = String(addon.data?.deployment_url || '').trim();
	const runtime = addon.data?.runtime && typeof addon.data.runtime === 'object' ? addon.data.runtime : {};
	const setupState = String(runtime.setupState || '');
	const online = runtime.online === true;
	if (!deploymentUrl || ['not_started','required','in_progress','error'].includes(setupState) || online === false) {
		throw Object.assign(new Error(`${LABELS[componentId] || componentId} engine host is not deployed and ready`), {
			status:503,code:'COMPONENT_ENGINE_NOT_READY',componentId,deploymentUrl:deploymentUrl||null,setupState:setupState||'unknown',online
		});
	}
	return {...result,addon:addon.data};
}
