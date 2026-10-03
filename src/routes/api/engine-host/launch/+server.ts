import { createHash, randomBytes } from 'node:crypto';
import { error, redirect } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { assertPanelLicensed, getStoredLicenseCredential } from '$lib/server/license';
import { assertAddonLicensed, CLOUD_ADDON_MANIFESTS, getCloudAddon } from '$lib/server/cloud-addons';
import { assertSharedEngineHostReady } from '$lib/server/engine-host-state';
import { getSupabaseAdmin } from '$lib/server/supabase';

const ENGINE_IDS=new Set(['mcp','apex','studio']);

function safeEnginePath(engineId:string,value:unknown){
	const raw=String(value||`/engines/${engineId}`).trim();
	if(raw.length>512||raw.includes('?')||raw.includes('#'))throw error(400,'Invalid Engine destination');
	if(raw!==`/engines/${engineId}`&&!raw.startsWith(`/engines/${engineId}/`))throw error(400,'Invalid Engine destination');
	return raw;
}

export async function GET({url,cookies}:any){
	const user=await requireUser(cookies);
	await assertPanelLicensed();

	const engineId=String(url.searchParams.get('engine')||'').trim().toLowerCase();
	if(!ENGINE_IDS.has(engineId))throw error(400,'Unknown Engine component');

	const manifest=CLOUD_ADDON_MANIFESTS[engineId];
	if(!manifest||manifest.runtimeMode!=='engine-host')throw error(400,'This add-on does not use Shared Engine');
	const row=await getCloudAddon(engineId);
	if(row.installed!==true||row.attached!==true)throw error(409,'Install and link this add-on before opening Engine');
	await assertAddonLicensed(row.license_component||manifest.licenseComponent,false);

	const host=await assertSharedEngineHostReady();
	if(!host.hostUrl)throw error(503,'Shared Engine Host URL is unavailable');
	const {installationId}=await getStoredLicenseCredential();
	if(String(host.installationId||'')!==installationId)throw error(409,'Shared Engine Host installation identity mismatch');

	const destination=safeEnginePath(engineId,url.searchParams.get('path'));
	const ticket=randomBytes(32).toString('base64url');
	const ticketHash=createHash('sha256').update(ticket).digest('hex');
	const result=await getSupabaseAdmin().rpc('orbitfs_create_engine_session_handoff',{
		p_ticket_hash:ticketHash,
		p_installation_id:installationId,
		p_user_id:String(user.id),
		p_engine_id:engineId,
		p_redirect_path:destination,
		p_ttl_seconds:60
	});
	if(result.error){
		const code=String(result.error.code||'');
		if(['PGRST202','42883','42P01'].includes(code)){
			throw Object.assign(new Error('The Shared Engine session handoff database contract is not installed yet.'),{status:409,code:'ENGINE_SESSION_HANDOFF_SCHEMA_REQUIRED'});
		}
		throw result.error;
	}

	const target=new URL('/auth/panel',String(host.hostUrl));
	target.searchParams.set('ticket',ticket);
	throw redirect(303,target.toString());
}
