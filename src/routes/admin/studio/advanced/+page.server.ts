import { redirect } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { assertComponentRuntimeReady } from '$lib/server/component-license';

export async function load({ cookies }: any) {
	await requireAdmin(cookies);
	await assertComponentRuntimeReady('orbitfs_studio');
	throw redirect(303, '/api/engine-host/launch?engine=studio&path=%2Fengines%2Fstudio%2Fmonitoring');
}
