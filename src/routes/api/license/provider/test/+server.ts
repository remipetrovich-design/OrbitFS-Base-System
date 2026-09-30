import { json } from '@sveltejs/kit';
import { getLicenseProviderDiagnostics } from '$lib/server/license';
import { requireLicenseAdmin } from '$lib/server/auth';

export async function POST({ request, cookies }) {
	await requireLicenseAdmin(cookies);
	try {
		const body=await request.json().catch(()=>({}));
		return json(await getLicenseProviderDiagnostics(String(body?.providerBase||'').trim()||undefined), { headers: { 'cache-control': 'no-store' } });
	} catch (error: any) {
		return json({
			error: String(error?.message || 'Could not test licence system'),
			code: String(error?.code || 'LICENSE_PROVIDER_TEST_FAILED')
		}, { status: Number(error?.status || 400) });
	}
}
