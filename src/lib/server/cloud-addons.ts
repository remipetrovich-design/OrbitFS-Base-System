import { getSupabaseAdmin } from '$lib/server/supabase';
import { getPanelLicenseSummary, activateLicenseComponent, componentLicensed, type PanelLicenseSummary } from '$lib/server/license';
import { getSharedEngineHostState, type SharedEngineHostState } from '$lib/server/engine-host-state';
import { SHARED_ADDON_DATABASE } from '$lib/server/addon-database';

export const CLOUD_ADDON_MANIFESTS: Record<string, any> = {
	mcp: {
		id:'mcp',name:'OrbitFS MCP',version:'',description:'OrbitFS MCP Engine component.',
		licenseComponent:'orbitfs_mcp',kind:'engine',runtimeMode:'engine-host',transportPath:'/mcp',sourceRef:'orbitfsengine:mcp',
		database:SHARED_ADDON_DATABASE,
		panelIntegration:{mode:'engine-owned',installable:true,engineRequired:true,actions:['install','deploy-engine','link-engine','unlink','uninstall']}
	},
	apex: {
		id:'apex',name:'OrbitFS APEX',version:'',description:'OrbitFS APEX Engine component.',
		licenseComponent:'orbitfs_apex',kind:'engine',runtimeMode:'engine-host',transportPath:null,sourceRef:'orbitfsengine:apex',
		database:SHARED_ADDON_DATABASE,
		panelIntegration:{mode:'engine-owned',installable:true,engineRequired:true,actions:['install','deploy-engine','link-engine','unlink','uninstall']}
	},
	studio: {
		id:'studio',name:'OrbitFS Studio',version:'',description:'OrbitFS Studio Engine component.',
		licenseComponent:'orbitfs_studio',kind:'engine',runtimeMode:'engine-host',transportPath:null,sourceRef:'orbitfsengine:studio',
		database:SHARED_ADDON_DATABASE,
		panelIntegration:{mode:'engine-owned',installable:true,engineRequired:true,actions:['install','deploy-engine','link-engine','unlink','uninstall']}
	}
};

export const BUILTIN_ADDON_IDS = Object.freeze(Object.keys(CLOUD_ADDON_MANIFESTS));

type PresentationContext = {
	license?: PanelLicenseSummary;
	host?: SharedEngineHostState | null;
};

function engineLaunchHref(addonId:string,href:unknown){
	const path=String(href||'').trim();
	if(!path)return path;
	if(path!==`/engines/${addonId}`&&!path.startsWith(`/engines/${addonId}/`))return path;
	return `/api/engine-host/launch?engine=${encodeURIComponent(addonId)}&path=${encodeURIComponent(path)}`;
}

function syntheticRow(manifest:any){return{id:manifest.id,name:manifest.name,description:manifest.description||'',version:manifest.version||'',license_component:manifest.licenseComponent||null,available:true,installed:false,attached:false,configured:false,status:'registered',deployment_url:null,transport_path:manifest.transportPath||null,source_ref:manifest.sourceRef||null,config:{},manifest,runtime:{},installed_at:null,updated_at:null};}
function explicitSetupState(row:any){const runtime=row?.runtime&&typeof row.runtime==='object'?row.runtime:{};const config=row?.config&&typeof row.config==='object'?row.config:{};const setup=config.engineSetup&&typeof config.engineSetup==='object'?config.engineSetup:{};const state=String(runtime.setupState||setup.state||'');if(['not_started','required','in_progress','complete','error'].includes(state))return state;return row?.attached?'required':'not_started';}
function presentedRuntime(row:any){const runtime=row?.runtime&&typeof row.runtime==='object'?{...row.runtime}:{};const raw=String(runtime.engineMode||'');runtime.engineMode=String(row?.id)==='mcp'?(raw==='stopped'?'stopped':'running'):(['running','standby','stopped'].includes(raw)?raw:'standby');return runtime;}

export async function addonLicenseAccess(component?:string|null, summaryOverride?:PanelLicenseSummary){
	if(!component)return{allowed:true,licensed:true,state:'enabled',reason:null,lockedToThisInstallation:true};
	const summary=summaryOverride||await getPanelLicenseSummary();
	const item=summary.components?.[component]||{state:'blocked',allowed:false,reason:'not_included',lockedToThisInstallation:false};
	const allowed=summary.licensed===true&&item.allowed===true;
	const locked=item.lockedToThisInstallation===true;
	const licensed=allowed&&componentLicensed(item)&&locked&&item.reason!=='activation_required';
	const reason=licensed?null:allowed&&!locked?'activation_required':item.reason?String(item.reason):'not_included';
	return{allowed,licensed,state:String(item.state||'blocked'),reason,lockedToThisInstallation:locked};
}

export async function addonLicensed(component?:string|null){return(await addonLicenseAccess(component)).licensed;}
export async function engineHostBootstrapEntitlement(options:{activate?:boolean;refresh?:boolean}={}){
	const engineIds=Object.keys(CLOUD_ADDON_MANIFESTS).filter((id)=>CLOUD_ADDON_MANIFESTS[id]?.runtimeMode==='engine-host');
	let summary=await getPanelLicenseSummary({refresh:options.refresh===true,requireAuthority:options.refresh===true});
	if(!summary.valid){
		return {eligible:false,componentId:null,licenseComponent:null,reason:String(summary.refreshError||summary.reason||'LICENSE_REQUIRED'),licensedIds:[] as string[]};
	}
	const entitled=engineIds.filter((id)=>{
		const licenseComponent=String(CLOUD_ADDON_MANIFESTS[id]?.licenseComponent||'').trim();
		const item=summary.components?.[licenseComponent];
		return item?.allowed===true;
	});
	if(!entitled.length)return {eligible:false,componentId:null,licenseComponent:null,reason:'ENGINE_ADDON_LICENSE_REQUIRED',licensedIds:[] as string[]};

	for(const id of entitled){
		const licenseComponent=String(CLOUD_ADDON_MANIFESTS[id]?.licenseComponent||'').trim();
		let access=await addonLicenseAccess(licenseComponent,summary);
		if(access.licensed)return {eligible:true,componentId:id,licenseComponent,reason:null,licensedIds:entitled};
		if(options.activate===true&&access.allowed&&access.reason==='activation_required'){
			await activateLicenseComponent(licenseComponent);
			summary=await getPanelLicenseSummary({refresh:true,requireAuthority:true});
			access=await addonLicenseAccess(licenseComponent,summary);
			if(access.licensed)return {eligible:true,componentId:id,licenseComponent,reason:null,licensedIds:entitled};
		}
	}
	return {eligible:options.activate!==true,componentId:entitled[0]||null,licenseComponent:entitled[0]?String(CLOUD_ADDON_MANIFESTS[entitled[0]]?.licenseComponent||'').trim():null,reason:options.activate===true?'LICENSE_COMPONENT_ACTIVATION_REQUIRED':null,licensedIds:entitled};
}


export async function assertAddonLicensed(component?:string|null,activateEntitled=true){
	const initialSummary=activateEntitled?await getPanelLicenseSummary({refresh:true,requireAuthority:true}):undefined;
	let access=await addonLicenseAccess(component,initialSummary);
	if(access.licensed)return access;
	if(component&&activateEntitled&&access.allowed&&access.reason==='activation_required'){
		await activateLicenseComponent(component);
		access=await addonLicenseAccess(component,await getPanelLicenseSummary({refresh:true,requireAuthority:true}));
		if(access.licensed)return access;
	}
	throw Object.assign(new Error(access.reason==='activation_required'?'This OrbitFS add-on licence has not been locked to this installation.':'This installation is not licensed for this OrbitFS add-on'),{status:403,code:access.reason==='activation_required'?'LICENSE_COMPONENT_ACTIVATION_REQUIRED':'LICENSE_REQUIRED'});
}

export async function prepareInstalledEngineAddonLicenses(){
	await ensureBuiltinAddonRecords();
	const db=getSupabaseAdmin();
	const result=await db.from('orbitfs_addons').select('id,license_component,installed,attached,configured,available,runtime').eq('installed',true);
	if(result.error)throw result.error;
	const prepared:Array<{id:string;component:string;status:'locked'|'not_entitled';lockedToThisInstallation:boolean;reason:string|null}>=[];
	let licenseSummary=await getPanelLicenseSummary({refresh:true,requireAuthority:true});
	if(!licenseSummary.licensed)throw Object.assign(new Error(licenseSummary.refreshError||licenseSummary.reason||'License Manager did not authorize this Base installation.'),{status:503,code:String(licenseSummary.reason||'LICENSE_AUTHORITY_REQUIRED')});
	for(const row of result.data||[]){
		const id=String((row as any).id||'').trim().toLowerCase();
		const manifest=CLOUD_ADDON_MANIFESTS[id];
		if(!manifest||manifest.runtimeMode!=='engine-host'||(row as any).available===false)continue;
		const component=String((row as any).license_component||manifest.licenseComponent||'').trim();
		if(!component)continue;
		let access=await addonLicenseAccess(component,licenseSummary);
		if(access.allowed&&access.reason==='activation_required'){
			try{
				await activateLicenseComponent(component);
			}catch(error:any){
				const code=String(error?.code||'').trim().toLowerCase();
				if(!['license_required','license_component_not_entitled','component_not_entitled','component_not_included','component_not_licensed','entitlement_required','entitlement_denied','addon_not_included','addon_not_licensed'].includes(code))throw error;
			}
			licenseSummary=await getPanelLicenseSummary({refresh:true,requireAuthority:true});
			access=await addonLicenseAccess(component,licenseSummary);
		}
		if(access.licensed&&access.lockedToThisInstallation===true){
			prepared.push({id,component,status:'locked',lockedToThisInstallation:true,reason:null});
			continue;
		}
		if(access.allowed){
			throw Object.assign(new Error(`License Manager did not lock ${component} to this OrbitFS installation.`),{status:409,code:'LICENSE_COMPONENT_LOCK_REQUIRED'});
		}
		const runtime=(row as any).runtime&&typeof (row as any).runtime==='object'?(row as any).runtime:{};
		const parked=await db.from('orbitfs_addons').update({
			attached:false,
			configured:false,
			status:'license_required',
			runtime:{...runtime,online:false,lastLicenseReason:access.reason||'not_included',lastLicenseCheckedAt:new Date().toISOString()},
			updated_at:new Date().toISOString()
		}).eq('id',id);
		if(parked.error)throw parked.error;
		prepared.push({id,component,status:'not_entitled',lockedToThisInstallation:false,reason:access.reason||'not_included'});
	}
	return prepared;
}

export async function ensureBuiltinAddonRecords(){
	const supabase=getSupabaseAdmin();
	const ids=[...BUILTIN_ADDON_IDS];
	const existing=await supabase.from('orbitfs_addons').select('id').in('id',ids);
	if(existing.error)throw existing.error;
	const present=new Set((existing.data||[]).map((row:any)=>String(row.id)));
	const missing=ids.filter((id)=>!present.has(id));
	if(!missing.length)return;
	const payloads=missing.map((id)=>{const payload:any=syntheticRow(CLOUD_ADDON_MANIFESTS[id]);delete payload.updated_at;return payload;});
	const result=await supabase.from('orbitfs_addons').upsert(payloads,{onConflict:'id',ignoreDuplicates:true});
	if(result.error)throw result.error;
}

export async function listCloudAddons(){
	await ensureBuiltinAddonRecords();
	const supabase=getSupabaseAdmin();
	const [result,license,host]=await Promise.all([
		supabase.from('orbitfs_addons').select('*').order('name'),
		getPanelLicenseSummary(),
		getSharedEngineHostState()
	]);
	if(result.error)throw result.error;
	const rows=result.data??[];
	const byId=new Map(rows.map((row:any)=>[String(row.id),row]));
	const ordered=Object.values(CLOUD_ADDON_MANIFESTS).map((manifest:any)=>byId.get(manifest.id)||syntheticRow(manifest));
	for(const row of rows)if(!CLOUD_ADDON_MANIFESTS[String(row.id)])ordered.push(row);
	return Promise.all(ordered.map((row)=>presentAddon(row,{license,host})));
}

export async function getCloudAddon(id:string){const supabase=getSupabaseAdmin();const result=await supabase.from('orbitfs_addons').select('*').eq('id',id).maybeSingle();if(result.error)throw result.error;if(result.data)return result.data;const manifest=CLOUD_ADDON_MANIFESTS[id];if(manifest)return syntheticRow(manifest);throw Object.assign(new Error('Add-on not found'),{status:404});}
export async function ensureCloudAddonRecord(id:string){
	const manifest=CLOUD_ADDON_MANIFESTS[id];
	if(!manifest)throw Object.assign(new Error('Add-on not found'),{status:404});
	const supabase=getSupabaseAdmin();
	const existing=await getCloudAddon(id);
	const canonical:any=syntheticRow(manifest);
	// Reconcile only catalog/manifest fields. Never reset install, attach, runtime or
	// customer configuration state just because Base setup is run again.
	const patch:any={
		name:canonical.name,
		description:canonical.description,
		version:canonical.version,
		license_component:canonical.license_component,
		available:canonical.available,
		transport_path:canonical.transport_path,
		source_ref:canonical.source_ref,
		updated_at:new Date().toISOString()
	};
	if(!existing.updated_at){
		const created=await supabase.from('orbitfs_addons').upsert({...canonical,updated_at:new Date().toISOString()},{onConflict:'id'}).select('*').single();
		if(created.error)throw created.error;
		return created.data;
	}
	const result=await supabase.from('orbitfs_addons').update(patch).eq('id',id).select('*').single();
	if(result.error)throw result.error;
	return result.data;
}

export async function presentAddon(row:any,context:PresentationContext={}){
	const catalogManifest=CLOUD_ADDON_MANIFESTS[String(row.id)]||{};
	const rowManifest=row.manifest&&typeof row.manifest==='object'?row.manifest:{};
	const explicitFrontend=Object.prototype.hasOwnProperty.call(rowManifest,'frontend')?rowManifest.frontend:catalogManifest.frontend;
	const manifest={...catalogManifest,...rowManifest,database:rowManifest.database||catalogManifest.database||SHARED_ADDON_DATABASE,frontend:explicitFrontend};
	const component=row.license_component||manifest.licenseComponent||null;
	const license=await addonLicenseAccess(component,context.license);
	const licensed=license.licensed;
	const installed=row.installed===true;
	const recordAttached=installed&&row.attached===true;
	const attached=recordAttached&&licensed;
	const setupState=explicitSetupState(row);
	const setupComplete=setupState==='complete'&&row.configured===true;
	const engineHosted=manifest.runtimeMode==='engine-host';
	const host=engineHosted?(context.host!==undefined?context.host:await getSharedEngineHostState()):null;
	const base=engineHosted?(host?.hostUrl||null):String(manifest.deploymentUrl||row.deployment_url||'').replace(/\/$/,'')||null;
	const manifestFrontend=manifest.frontend?{
		...manifest.frontend,
		navigationGroups:(manifest.frontend.navigationGroups||[]).map((group:any)=>({...group,items:(group.items||[]).map((item:any)=>({...item,href:engineHosted?engineLaunchHref(row.id,item.href):item.href}))})),
		adminGroups:(manifest.frontend.adminGroups||[]).map((group:any)=>({...group,items:(group.items||[]).map((item:any)=>({...item,href:engineHosted?engineLaunchHref(row.id,item.href):item.href}))})),
		primaryNavigation:(manifest.frontend.primaryNavigation||[]).map((item:any)=>({...item,href:engineHosted?engineLaunchHref(row.id,item.href):item.href})),
		routes:(manifest.frontend.routes||[]).map((route:any)=>({...route})),
		routeGuards:(manifest.frontend.routeGuards||[]).map((guard:any)=>({...guard})),
		slots:(manifest.frontend.slots||[]).map((slot:any)=>({...slot}))
	}:null;
	const frontend=licensed&&attached&&setupComplete?manifestFrontend:null;
	const hostLinked=engineHosted&&Boolean(host)&&['linked','ready'].includes(String(host?.state));
	const hostReady=engineHosted&&Boolean(host)&&host?.state==='ready';
	const runtime=presentedRuntime(row);
	const available=row.available!==false;
	const installable=available&&license.allowed&&manifest.panelIntegration?.installable!==false;
	const pendingInstall=runtime.pendingInstall===true||String(runtime.installState||'')==='provisioning';
	const installStatus=pendingInstall?'installing':installed?'installed':String(runtime.installState||'')==='error'?'error':'registered';
	const status=!available?'unavailable':!license.allowed?'license_required':!licensed?'activation_required':pendingInstall?'installing':attached?(setupComplete?'attached':'setup_required'):installed?'detached':installStatus==='error'?'install_error':'registered';
	return{id:row.id,name:row.name||manifest.name,description:row.description||manifest.description,version:row.version||manifest.version||'',installed,attached,recordAttached,parked:installed&&!attached,licensed,licenseAllowed:license.allowed,licenseState:licensed?'enabled':license.state,licenseReason:license.reason,available,installable,panelIntegration:manifest.panelIntegration||null,configured:licensed&&setupComplete,setupComplete:licensed&&setupComplete,setupState,needsSetup:licensed&&attached&&!setupComplete,status,installStatus,installMethod:String(row.runtime?.installMethod||'engine-component'),supports:installable?['install','attach','detach','uninstall']:[],deploymentUrl:licensed?base:null,transportPath:licensed?(row.transport_path??manifest.transportPath??null):null,sourceRef:row.source_ref||manifest.sourceRef||null,online:licensed&&Boolean(runtime.online),manifest,frontend,runtime,config:licensed?(row.config||{}):{},database:manifest.database,engineHostUrl:licensed&&engineHosted?base:null,engineManageUrl:licensed&&engineHosted&&base?engineLaunchHref(row.id,`/engines/${row.id}`):null,panelUrl:licensed?(host?.panelUrl||null):null,hostState:host?.state||null,hostLinked:licensed&&hostLinked,hostReady:licensed&&hostReady,wiring:{package:false,panel:true,backend:licensed&&installed,frontend:Boolean(frontend),engine:licensed&&attached,service:licensed&&hostReady,database:'shared-panel'},deploymentRole:engineHosted?'engine-component':'addon'};
}

export async function saveCloudAddon(id:string,patch:Record<string,any>){const supabase=getSupabaseAdmin();const result=await supabase.from('orbitfs_addons').update({...patch,updated_at:new Date().toISOString()}).eq('id',id).select('*').single();if(result.error)throw result.error;return presentAddon(result.data);}