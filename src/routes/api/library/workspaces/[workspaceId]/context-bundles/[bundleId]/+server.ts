import { error, json, type RequestHandler } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { libraryContext } from '$lib/server/library';
import { deleteContextBundle, getContextBundle, saveContextBundle } from '$lib/server/mcp-workspace-state';

async function context(cookies: any, workspaceId: string) {
	const user = await requireUser(cookies);
	await assertPanelLicensed();
	const library = await libraryContext(user, workspaceId);
	return { user, library };
}

export const GET: RequestHandler = async ({ cookies, params }) => {
	const workspaceId = String(params.workspaceId || '');
	const bundleId = String(params.bundleId || '');
	await context(cookies, workspaceId);
	return json({ bundle: await getContextBundle(workspaceId, bundleId) });
};

export const PATCH: RequestHandler = async ({ cookies, params, request }) => {
	const workspaceId = String(params.workspaceId || '');
	const bundleId = String(params.bundleId || '');
	const { user, library } = await context(cookies, workspaceId);
	if (!library.canManage) throw error(403, 'Manage Library / Knowledge permission required');
	const body = await request.json().catch(() => ({}));
	return json({ bundle: await saveContextBundle(workspaceId, user, body, bundleId) });
};

export const DELETE: RequestHandler = async ({ cookies, params }) => {
	const workspaceId = String(params.workspaceId || '');
	const bundleId = String(params.bundleId || '');
	const { library } = await context(cookies, workspaceId);
	if (!library.canManage) throw error(403, 'Manage Library / Knowledge permission required');
	await deleteContextBundle(workspaceId, bundleId);
	return json({ deleted: true });
};
