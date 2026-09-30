import { json } from '@sveltejs/kit';
import { getPanelLicenseSummary } from '$lib/server/license';
import { requireLicenseAdmin } from '$lib/server/auth';

function errorDetail(error: unknown) { const value:any=error; return String(value?.message || value?.error || (typeof error === 'string' ? error : 'License check failed')); }

export async function GET({ url, cookies }) {
	const requestedRefresh = url.searchParams.get('refresh') === '1';
	let refresh = false;
	if (requestedRefresh) {
		// Forced validation consumes the manager-issued failure budget, so it must
		// never be enabled by a spoofable Referer header.
		await requireLicenseAdmin(cookies);
		refresh = true;
	}
	try {
		return json(await getPanelLicenseSummary({ refresh }));
	} catch (error) {
		return json({
			valid: false,
			licensed: false,
			enforcement: true,
			reason: 'license_check_failed',
			refreshError: errorDetail(error)
		}, { status: 503 });
	}
}
