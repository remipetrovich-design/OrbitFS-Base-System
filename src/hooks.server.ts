import { redirect, type Handle } from '@sveltejs/kit';
import { getPanelLicenseSummary, ensureInstallationIdentity, recordLicenseManagerCheckIn } from '$lib/server/license';
import { getSessionUser } from '$lib/server/auth';
import { syncBaseRuntimeReleaseIdentity } from '$lib/server/base-release-state';

const CHECK_IN_INTERVAL_MS=60_000;
const checkInCache=new Map<string,number>();

const PUBLIC_PATHS = new Set([
	'/license-suspended',
	'/login',
	'/api/auth/login',
	'/api/license/status',
	'/api/license/activate',
	'/api/license/provider',
	'/api/license/provider/test',
	'/api/license/updater',
	'/api/license/diagnostics',
	'/api/auth/me',
	'/api/auth/logout'
]);

const OAUTH_MACHINE_POSTS = new Set(['/oauth/token', '/oauth/register']);
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const FORM_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'];

function bypassLicense(pathname: string, method: string) {
	if (method === 'OPTIONS') return true;
	if (PUBLIC_PATHS.has(pathname)) return true;
	if (pathname.startsWith('/_app/') || pathname.startsWith('/favicon') || pathname.startsWith('/robots')) return true;
	return false;
}

function csrfBlocked(event: Parameters<Handle>[0]['event']) {
	if (!UNSAFE_METHODS.has(event.request.method)) return false;
	if (OAUTH_MACHINE_POSTS.has(event.url.pathname)) return false;
	const contentType = event.request.headers.get('content-type') || '';
	if (!FORM_TYPES.some((type) => contentType.startsWith(type))) return false;
	const origin = event.request.headers.get('origin');
	if (!origin) return false;
	return origin !== event.url.origin;
}

export const handle: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;
	if (csrfBlocked(event)) {
		return new Response('Cross-site form submission blocked', {
			status: 403,
			headers: { 'cache-control': 'no-store' }
		});
	}
	if (bypassLicense(pathname, event.request.method)) return resolve(event);

	let summary;
	try {
		summary = await getPanelLicenseSummary();
	} catch (error) {
		summary = {
			licensed: false,
			reason: 'license_check_failed',
			refreshError: error instanceof Error ? error.message : 'License check failed'
		};
	}

	if (summary.licensed) {
		const installationId=summary.installationId || await ensureInstallationIdentity();
		const now=Date.now();
		if(now-(checkInCache.get(installationId)||0)>=CHECK_IN_INTERVAL_MS){
			checkInCache.set(installationId,now);
			void syncBaseRuntimeReleaseIdentity().catch(()=>undefined);
			void recordLicenseManagerCheckIn({action:'check_in',phase:'completed',product:'orbitfs_base',productVersion:process.env.ORBITFS_APP_VERSION||'unknown',provider:'vercel',region:process.env.VERCEL_REGION||null,platform:'vercel',client:'orbitfs-base',clientVersion:process.env.ORBITFS_APP_VERSION||null,details:{path:pathname,method:event.request.method}}).catch(()=>undefined);
		}
		return resolve(event);
	}

	if (pathname.startsWith('/api/') || pathname === '/mcp' || pathname.startsWith('/oauth/')) {
		return new Response(JSON.stringify({
			error: 'OrbitFS Base System licence is required',
			code: 'LICENSE_REQUIRED',
			license: summary,
			restricted: true
		}), {
			status: 403,
			headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
		});
	}

	let user = null;
	try {
		user = await getSessionUser(event.cookies);
	} catch {
		user = null;
	}

	if (user?.role === 'user') {
		if (pathname === '/license-suspended') return resolve(event);
		throw redirect(303, '/license-suspended');
	}

	if (pathname === '/license') return resolve(event);

	const next = encodeURIComponent(`${pathname}${event.url.search}`);
	throw redirect(303, `/license?next=${next}`);
};
