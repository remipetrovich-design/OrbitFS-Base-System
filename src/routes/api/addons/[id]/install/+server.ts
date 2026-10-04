import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { isSystemAdmin } from '$lib/server/workspaces';
import { assertAddonLicensed, CLOUD_ADDON_MANIFESTS, ensureCloudAddonRecord, getCloudAddon, presentAddon, saveCloudAddon } from '$lib/server/cloud-addons';
import { assertSharedEngineHostReady, getSharedEngineHostState } from '$lib/server/engine-host-state';
import { getEngineAttachContext } from '$lib/server/engine-host';
import { confirmEngineHostPairing } from '$lib/server/engine-host-remote';
import { writeAudit } from '$lib/server/audit';

const fail=(e:any)=>json({error:String(e?.message||'Request failed'),code:String(e?.code||'ADDON_INSTALL_ERROR')},{status:Number(e?.status||500)});
const isEngineHostAddon=(id:string)=>CLOUD_ADDON_MANIFESTS[id]?.runtimeMode==='engine-host';
const defaultEngineMode=(id:string)=>id==='mcp'?'running':'standby';

export async function POST({params,cookies}:any){
	let id='';
	let pendingStarted=false;
	try{
		const user=await requireUser(cookies);
		await assertPanelLicensed();
		if(!isSystemAdmin(user))throw Object.assign(new Error('System Owner or Admin required'),{status:403,code:'ADMIN_REQUIRED'});
		id=String(params.id||'').trim().toLowerCase();
		const manifest=CLOUD_ADDON_MANIFESTS[id];
		if(!manifest)throw Object.assign(new Error('Add-on not found'),{status:404,code:'ADDON_NOT_FOUND'});
		if(manifest.panelIntegration?.installable===false)throw Object.assign(new Error('This add-on is not currently installable'),{status:409,code:'ADDON_NOT_INSTALLABLE'});

		const row=await ensureCloudAddonRecord(id);
		if(row.available===false)throw Object.assign(new Error('This add-on is not currently available'),{status:409,code:'ADDON_UNAVAILABLE'});
		if(row.installed===true){
			return json({ok:true,noOp:true,addon:await presentAddon(row),host:isEngineHostAddon(id)?await getSharedEngineHostState():null});
		}

		// License Manager remains the authority for whether this plugin may be installed.
		await assertAddonLicensed(manifest.licenseComponent||row.license_component||null,true);

		const engineHosted=isEngineHostAddon(id);
		if(!engineHosted){
			const runtime={...(row.runtime||{}),mode:'external-vercel',setupState:row.runtime?.setupState||'not_started',compute:'vercel',database:'shared-panel',online:false};
			const addon=await saveCloudAddon(row.id,{installed:true,attached:false,configured:false,status:'detached',installed_at:row.installed_at||new Date().toISOString(),runtime});
			await writeAudit({actorUserId:user.id,action:'addon.install',targetType:'addon',targetId:row.id,detail:{engineHost:false}});
			return json({ok:true,addon,host:null});
		}

		// Inner deployment / Shared Engine is a prerequisite. Installing a plugin
		// must never create, redeploy or replace the shared host.
		const host=await assertSharedEngineHostReady();

		const previousMode=String(row.runtime?.engineMode||'');
		const requestedAt=new Date().toISOString();
		await saveCloudAddon(row.id,{
			installed:false,
			attached:false,
			configured:false,
			status:'installing',
			installed_at:null,
			transport_path:row.transport_path??manifest.transportPath??null,
			runtime:{
				...(row.runtime||{}),
				mode:'engine-host',
				engineMode:id==='mcp'?(previousMode==='stopped'?'stopped':'running'):(previousMode||defaultEngineMode(id)),
				setupState:row.runtime?.setupState||'not_started',
				pendingInstall:true,
				desiredInstalled:true,
				installState:'pairing',
				installRequestedAt:requestedAt,
				installRequestedByUserId:String(user.id),
				autoAttachPending:true,
				lastManualDetachAt:null,
				compute:'vercel',
				database:'shared-panel',
				online:false
			}
		});
		pendingStarted=true;

		// The Engine shares the customer database. The signed pending-install row
		// above is therefore visible to the Engine before pairing and is the only
		// temporary state accepted by pairEngineHost().
		const attach=await getEngineAttachContext(id,String(user.id));
		const remote=await confirmEngineHostPairing({
			engineId:id,
			installationId:attach.installationId,
			panelUrl:attach.panelUrl,
			workspaceId:attach.workspaceId,
			actorUserId:String(user.id)
		});

		const paired=await getCloudAddon(id);
		const pairedRuntime=paired.runtime&&typeof paired.runtime==='object'?paired.runtime:{};
		const addon=await saveCloudAddon(id,{
			installed:true,
			attached:true,
			status:'attached',
			installed_at:paired.installed_at||new Date().toISOString(),
			runtime:{...pairedRuntime,pendingInstall:false,desiredInstalled:true,installState:'installed',autoAttachPending:false,lastAttachAt:new Date().toISOString(),installError:null,installErrorCode:null}
		});
		await writeAudit({actorUserId:user.id,action:'addon.install.complete',targetType:'addon',targetId:id,detail:{engineHost:true,hostUrl:host.hostUrl,remoteConfirmed:true}});
		return json({ok:true,waiting:false,addon:await presentAddon(addon),host,engineHost:remote});
	}catch(e:any){
		if(id&&pendingStarted){
			try{
				const current=await getCloudAddon(id);
				const runtime=current.runtime&&typeof current.runtime==='object'?current.runtime:{};
				await saveCloudAddon(id,{
					installed:false,
					attached:false,
					configured:false,
					status:'install_error',
					runtime:{...runtime,pendingInstall:false,desiredInstalled:false,installState:'error',installError:String(e?.message||'Plugin installation failed'),installErrorCode:String(e?.code||'ADDON_INSTALL_ERROR'),online:false}
				});
			}catch{}
		}
		return fail(e);
	}
}
