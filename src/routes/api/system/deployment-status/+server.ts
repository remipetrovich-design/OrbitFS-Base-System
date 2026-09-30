import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { getInstallationRoute } from '$lib/server/setup';
import { syncBaseRuntimeReleaseIdentity } from '$lib/server/base-release-state';

export async function GET({ cookies, url }) {
	try {
		await requireAdmin(cookies);
		await assertPanelLicensed();
		const [installation, activeRelease] = await Promise.all([
			getInstallationRoute(),
			syncBaseRuntimeReleaseIdentity()
		]);
		const currentVersion = String(process.env.ORBITFS_APP_VERSION || activeRelease?.panelVersion || activeRelease?.version || '').trim() || null;
		const releaseChannel = String(process.env.ORBITFS_RELEASE_CHANNEL || activeRelease?.releaseChannel || activeRelease?.base?.channel || 'stable').trim().toLowerCase() || 'stable';
		const projectId = String(installation.projectId || process.env.VERCEL_PROJECT_ID || '').trim() || null;
		return json({
			platform:'Vercel',
			environment:process.env.VERCEL_ENV || 'local',
			branch:process.env.VERCEL_GIT_COMMIT_REF || 'main',
			commit:process.env.VERCEL_GIT_COMMIT_SHA || null,
			commitMessage:process.env.VERCEL_GIT_COMMIT_MESSAGE || null,
			deploymentUrl:process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : url.origin,
			productionUrl:url.origin,
			provider:'GitHub → Vercel',
			managed:true,
			version:currentVersion,
			releaseChannel,
			activeRelease,
			projectId,
			installationRoute:installation.route,
			installationRegistered:installation.registered,
			baseUpdate:{
				mode:'redeploy_registered_project',
				ready:Boolean(projectId),
				projectId,
				blocker:projectId?null:'BASE_PROJECT_ID_REQUIRED'
			},
			checkedAt:new Date().toISOString()
		});
	} catch (error:any) {
		return json({ error:String(error?.message || 'Failed to load deployment status') }, { status:Number(error?.status || 500) });
	}
}