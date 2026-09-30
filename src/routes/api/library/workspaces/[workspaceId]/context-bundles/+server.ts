import { error, json, type RequestHandler } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { libraryContext } from '$lib/server/library';
import { listContextBundles, saveContextBundle } from '$lib/server/mcp-workspace-state';

async function context(cookies: any, workspaceId: string) {
	const user = await requireUser(cookies);
	await assertPanelLicensed();
	const library = await libraryContext(user, workspaceId);
	return { user, library };
}

export const GET: RequestHandler = async ({ cookies, params }) => {
	const workspaceId = String(params.workspaceId || '');
	const { library } = await context(cookies, workspaceId);
	if (!library.workspace) throw error(404, 'Workspace not found');
	return json({ bundles: await listContextBundles(workspaceId) });
};

export const POST: RequestHandler = async ({ cookies, params, request }) => {
	const workspaceId = String(params.workspaceId || '');
	const { user, library } = await context(cookies, workspaceId);
	if (!library.canManage) throw error(403, 'Manage Library / Knowledge permission required');
	const body = await request.json().catch(() => ({}));
	return json({ bundle: await saveContextBundle(workspaceId, user, body) });
};
