import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { isSystemAdmin } from '$lib/server/workspaces';
import { assertAddonLicensed, CLOUD_ADDON_MANIFESTS, ensureCloudAddonRecord, getCloudAddon, presentAddon, saveCloudAddon } from '$lib/server/cloud-addons';
import { getSharedEngineHostState } from '$lib/server/engine-host-state';
import { provisionSharedEngineHost } from '$lib/server/vercel-engine-provision';
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

		// License Manager entitlement/installation lock is established before any
		// Engine or local install state is mutated.
		await assertAddonLicensed(manifest.licenseComponent||row.license_component||null,true);

		const engineHosted=isEngineHostAddon(id);
		if(!engineHosted){
			const runtime={...(row.runtime||{}),mode:'external-vercel',setupState:row.runtime?.setupState||'not_started',compute:'vercel',database:'shared-panel',online:false};
			const addon=await saveCloudAddon(row.id,{installed:true,attached:false,configured:false,status:'detached',installed_at:row.installed_at||new Date().toISOString(),runtime});
			await writeAudit({actorUserId:user.id,action:'addon.install',targetType:'addon',targetId:row.id,detail:{engineHost:false}});
			return json({ok:true,addon,host:null});
		}

		const previousMode=String(row.runtime?.engineMode||'');
		const requestedAt=new Date().toISOString();
		const pendingRuntime={
			...(row.runtime||{}),
			mode:'engine-host',
			engineMode:id==='mcp'?(previousMode==='stopped'?'stopped':'running'):(previousMode||defaultEngineMode(id)),
			setupState:row.runtime?.setupState||'not_started',
			pendingInstall:true,
			desiredInstalled:true,
			installState:'provisioning',
			installRequestedAt:requestedAt,
			installRequestedByUserId:String(user.id),
			autoAttachPending:true,
			lastManualDetachAt:null,
			compute:'vercel',
			database:'shared-panel',
			online:false
		};

		// Crucially: installed stays false until the deployed Engine confirms the
		// signed pairing. This removes the old installed->deploy circular dependency.
		await saveCloudAddon(row.id,{
			installed:false,
			attached:false,
			configured:false,
			status:'installing',
			installed_at:null,
			transport_path:row.transport_path??manifest.transportPath??null,
			runtime:pendingRuntime
		});
		pendingStarted=true;

		const provisioned:any=await provisionSharedEngineHost({
			components:[id],
			actorUserId:user.id,
			actorUsername:user.username
		});

		// If no deployment was needed and the Host is already linked/ready, finish
		// the install synchronously. Otherwise /engine-host/refresh finalizes it as
		// soon as the Vercel deployment and Host link are ready.
		let host=await getSharedEngineHostState();
		if(provisioned?.noOp===true&&['linked','ready'].includes(String(host.state||''))){
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
			await saveCloudAddon(id,{
				installed:true,
				attached:true,
				status:'attached',
				installed_at:paired.installed_at||new Date().toISOString(),
				runtime:{...pairedRuntime,pendingInstall:false,desiredInstalled:true,installState:'installed',autoAttachPending:false,lastAttachAt:new Date().toISOString()}
			});
			await writeAudit({actorUserId:user.id,action:'addon.install.complete',targetType:'addon',targetId:id,detail:{engineHost:true,noDeploymentRequired:true,remoteConfirmed:true}});
			return json({ok:true,waiting:false,addon:await presentAddon(await getCloudAddon(id)),host,engineHost:remote});
		}

		host=await getSharedEngineHostState();
		await writeAudit({actorUserId:user.id,action:'addon.install.started',targetType:'addon',targetId:id,detail:{engineHost:true,hostState:host.state,projectName:host.projectName||null}});
		return json({ok:true,waiting:true,phase:'provisioning',addon:await presentAddon(await getCloudAddon(id)),host},{status:202});
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
					runtime:{...runtime,pendingInstall:false,desiredInstalled:false,installState:'error',installError:String(e?.message||'Engine provisioning failed'),installErrorCode:String(e?.code||'ADDON_INSTALL_ERROR'),online:false}
				});
			}catch{}
		}
		return fail(e);
	}
}