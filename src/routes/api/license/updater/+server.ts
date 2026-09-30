import { json } from '@sveltejs/kit';
import { requireLicenseAdmin } from '$lib/server/auth';
import { getUpdaterConnectionSettings, saveUpdaterConnection, testUpdaterConnection } from '$lib/server/updater-connection';

function failure(error: any, fallback: string) {
	return json({
		error: String(error?.message || fallback),
		code: String(error?.code || 'UPDATER_CONNECTION_FAILED')
	}, { status: Number(error?.status || 500) });
}

export async function GET({ cookies }) {
	try {
		await requireLicenseAdmin(cookies);
		return json(await getUpdaterConnectionSettings(), { headers: { 'cache-control': 'no-store' } });
	} catch (error: any) {
		return failure(error, 'Could not load updater connection');
	}
}

export async function POST({ request, cookies }) {
	try {
		await requireLicenseAdmin(cookies);
		const body = await request.json().catch(() => ({}));
		return json(await testUpdaterConnection(body), { headers: { 'cache-control': 'no-store' } });
	} catch (error: any) {
		return failure(error, 'Could not test updater connection');
	}
}

export async function PUT({ request, cookies }) {
	try {
		await requireLicenseAdmin(cookies);
		const body = await request.json().catch(() => ({}));
		return json(await saveUpdaterConnection(body), { headers: { 'cache-control': 'no-store' } });
	} catch (error: any) {
		return failure(error, 'Could not save updater connection');
	}
}
