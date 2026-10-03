import { timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import { ensureInstallationIdentity } from '$lib/server/license';
import { ENGINE_DEPLOYER_PROTOCOL, provisionSharedEngineHost, refreshSharedEngineDeployment, scopeEngineReleaseForInstalledLicenses } from '$lib/server/vercel-engine-provision';
import { getSharedEngineHostState, saveSharedEngineHostState } from '$lib/server/engine-host-state';
import { findEngineRollbackCheckpoint } from '$lib/server/update-checkpoints';
import { confirmSharedEngineHostLink } from '$lib/server/engine-host-remote';
import { fetchLatestEngineRelease } from '$lib/server/engine-release-client';
import { buildEngineUpdatePlan } from '$lib/server/engine-update-planner';
import { resolveInstalledBaseVersion } from '$lib/server/base-release-state';

function fail(message:string,status=500,code='STORE_ENGINE_UPDATE_FAILED'){
	return json({ok:false,error:message,code},{status});
}

function sameSecret(supplied:string, expected:string){
	const a=Buffer.from(supplied),b=Buffer.from(expected);
	return a.length===b.length && a.length>0 && timingSafeEqual(a,b);
}

async function authorize(request:Request){
	const expectedSecret=String(env.ORBITFS_DB_SECRET||'').trim();
	const suppliedSecret=String(request.headers.get('x-orbitfs-db-secret')||'').trim();
	if(!expectedSecret||!sameSecret(suppliedSecret,expectedSecret)) throw Object.assign(new Error('Store update authorization failed'),{status:403,code:'STORE_UPDATE_UNAUTHORIZED'});
	const expectedInstallation=await ensureInstallationIdentity();
	const suppliedInstallation=String(request.headers.get('x-orbitfs-installation-id')||'').trim();
	if(!suppliedInstallation||suppliedInstallation!==expectedInstallation) throw Object.assign(new Error('Store installation identity does not match this Base installation'),{status:403,code:'STORE_INSTALLATION_MISMATCH'});
	return expectedInstallation;
}

export async function POST({request}:any){
	try{
		await authorize(request);
		const body=await request.json().catch(()=>({}));
		const mode=String(body.mode||'apply').trim().toLowerCase();
		if(!['plan','apply','refresh','rollback'].includes(mode)) return fail('Unsupported Engine update mode',400,'STORE_UPDATE_MODE_INVALID');

		if(mode==='refresh'){
			const result=await refreshSharedEngineDeployment({vercelToken:String(body.vercelToken||'').trim(),teamId:String(body.teamId||'').trim()});
			let host=result.host||await getSharedEngineHostState();
			if(result.ready && host.hostUrl && !['linked','ready'].includes(String(host.state||''))){
				try{
					await confirmSharedEngineHostLink({
						installationId:host.installationId,
						panelUrl:String(host.panelUrl||env.ORBITFS_PANEL_URL||'').trim(),
						actorUserId:'billing-store'
					});
					host=await saveSharedEngineHostState({
						state:'ready',
						linkedAt:host.linkedAt||new Date().toISOString(),
						linkedByUserId:'billing-store',
						lastHealthAt:new Date().toISOString(),
						lastSyncAt:new Date().toISOString(),
						lastError:null
					},host);
				}catch(error:any){
					const code=String(error?.code||'');
					if(['INSTALLATION_MISMATCH','PANEL_URL_MISMATCH','ENGINE_HOST_ALREADY_LINKED','ENGINE_HOST_INSTALLATION_MISMATCH','ENGINE_HOST_DEPLOYMENT_MISMATCH'].includes(code)) throw error;
					host=await saveSharedEngineHostState({
						state:'deployed',
						lastSyncAt:new Date().toISOString(),
						lastError:`Engine deployment is ready; waiting for Host startup/link: ${String(error?.message||'not reachable yet')}`
					},host);
					return json({ok:true,waiting:true,readyState:result.readyState,host},{status:202});
				}
			}
			const waiting=!result.ready || !['linked','ready'].includes(String(host.state||'')) || host.updaterConnected!==true;
			return json({ok:true,waiting,readyState:result.readyState,host},{status:waiting?202:200});
		}

		const releaseId=String(body.releaseId||'').trim();
		const releaseChannel=String(body.releaseChannel||'stable').trim().toLowerCase();
		if(!releaseId) return fail('Release ID is required',400,'STORE_UPDATE_RELEASE_REQUIRED');
		if(!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(releaseChannel)) return fail('Release channel is invalid',400,'STORE_UPDATE_CHANNEL_INVALID');

		if(mode==='plan'){
			const release=(await scopeEngineReleaseForInstalledLicenses(await fetchLatestEngineRelease({releaseId,channel:releaseChannel}),body.components)).release;
			const installedBaseVersion=await resolveInstalledBaseVersion();
			const plan=await buildEngineUpdatePlan({
				descriptor:release.descriptor,
				package:release.package,
				installedBaseVersion,
				supportedProtocol:ENGINE_DEPLOYER_PROTOCOL
			});
			if(plan.blocked) return fail(plan.reason||'Engine update is blocked by this installation.',409,'ENGINE_UPDATE_BLOCKED');
			return json({ok:true,plan,engineDeployerProtocol:ENGINE_DEPLOYER_PROTOCOL,release:{id:release.descriptor.releaseId,version:release.descriptor.version,channel:release.descriptor.channel,components:release.descriptor.components,checkpointRequired:release.descriptor.checkpointRequired,minimumEngineDeployerProtocol:release.descriptor.minimumEngineDeployerProtocol,executor:'base-inner-deployer'}});
		}

		if(mode==='rollback'){
			const current=await getSharedEngineHostState();
			const rollback=await findEngineRollbackCheckpoint(current.releaseId);
			if(!rollback) return fail('No previous Engine checkpoint is available to restore.',409,'ENGINE_ROLLBACK_CHECKPOINT_MISSING');
			const rollbackSource=rollback.distribution==='orbitfs-store-package-v1'?'published-update':'authorized-branch';
			if(rollbackSource==='authorized-branch'&&!rollback.sourceCommit) return fail('The rollback checkpoint does not contain a previously authorized Engine source commit.',409,'ENGINE_ROLLBACK_SOURCE_MISSING');
			const restored=await provisionSharedEngineHost({
				releaseId:rollback.releaseId,
				releaseSource:rollbackSource,
				...(rollback.sourceCommit?{sourceCommit:rollback.sourceCommit}:{}),
				components:rollback.components,
				releaseChannel:rollback.channel||current.releaseChannel||releaseChannel,
				reconcileToAuthority:true,
				rollbackToCheckpoint:true,
				vercelToken:String(body.vercelToken||'').trim(),
				teamId:String(body.teamId||'').trim(),
				actorUserId:'customer-rollback',
				actorUsername:'customer-rollback'
			});
			const host=await getSharedEngineHostState();
			const waiting=Boolean(host.pendingDeploymentId)||['provisioning','deployed','linking'].includes(String(host.state||''));
			return json({
				ok:true,
				waiting,
				checkpointId:rollback.checkpoint.id,
				restoredVersion:rollback.version,
				componentVersions:rollback.componentVersions,
				host,
				updatePlan:(restored as any)?.updatePlan||null
			},{status:waiting?202:200});
		}

		// The normal updater never mutates Base files. It delegates Shared Engine/MCP/APEX/Studio execution to the Base-owned inner deployer.
		const host=await provisionSharedEngineHost({
			releaseId,
			releaseSource:'published-update',
			releaseChannel,
			components:body.components,
			vercelToken:String(body.vercelToken||'').trim(),
			teamId:String(body.teamId||'').trim(),
			actorUserId:'customer-updater',
			actorUsername:'customer-updater'
		});
		const current=await getSharedEngineHostState();
		const waiting=['provisioning','deploying','deployed','linking'].includes(String(current.state||'')) || Boolean(current.pendingDeploymentId) || Boolean(current.pendingReleaseInventory?.length) || current.updaterConnected!==true;
		return json({
			ok:true,
			waiting,
			engineDeployerProtocol:ENGINE_DEPLOYER_PROTOCOL,
			host:current,
			updatePlan:(host as any)?.updatePlan||null,
			databaseMigrations:Array.isArray((host as any)?.databaseMigrations)?(host as any).databaseMigrations:[]
		},{status:waiting?202:200});
	}catch(error:any){
		return fail(String(error?.message||'Store Engine update failed'),Number(error?.status||500),String(error?.code||'STORE_ENGINE_UPDATE_FAILED'));
	}
}
