import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { writeAudit } from '$lib/server/audit';
import { getSupabaseAdmin } from '$lib/server/supabase';
import {
	FILE_ACTIONS, MANAGEMENT_ACTIONS, MANAGEMENT_LABELS, createWorkspace, effectiveUserPermissions,
	isSystemAdmin, readWorkspaceSettings, visibleWorkspaces
} from '$lib/server/workspaces';

function fail(error: any) {
	const status = Number(error?.status || 500);
	return json({ error:String(error?.message || 'Request failed'), code:String(error?.code || 'REQUEST_FAILED') }, { status });
}

export async function GET({ cookies }) {
	try {
		const user = await requireUser(cookies);
		const db = getSupabaseAdmin();
		const [workspaces, addonResult, settings, userPermissions] = await Promise.all([
			visibleWorkspaces(user),
			db.from('orbitfs_addons').select('id,attached').in('id',['mcp','apex','studio']),
			readWorkspaceSettings(),
			effectiveUserPermissions(user)
		]);
		if (addonResult.error) throw addonResult.error;
		const attached = new Map((addonResult.data ?? []).map((row:any) => [String(row.id),row.attached === true]));
		const mcpAttached = attached.get('mcp') === true;
		const apexAttached = attached.get('apex') === true;
		const studioAttached = attached.get('studio') === true;
		const baseActions = MANAGEMENT_ACTIONS.filter((id)=>
			id !== 'mcp_use' && !id.startsWith('manage_mcp_') &&
			!id.startsWith('sorter_') && !id.startsWith('converter_') &&
			!id.startsWith('studio_')
		);
		const mcpActions = MANAGEMENT_ACTIONS.filter((id)=>id==='mcp_use'||id.startsWith('manage_mcp_'));
		const apexActions = MANAGEMENT_ACTIONS.filter((id)=>id.startsWith('sorter_')||id.startsWith('converter_'));
		const studioActions = MANAGEMENT_ACTIONS.filter((id)=>id.startsWith('studio_'));
		const currentManagementActions = [
			...baseActions,
			...(mcpAttached ? mcpActions : []),
			...(apexAttached ? apexActions : []),
			...(studioAttached ? studioActions : [])
		];
		return json({
			workspaces, settings, canManageGlobal:isSystemAdmin(user),
			userPermissions, roles:['owner','editor','contributor','viewer'],
			fileActions:[...FILE_ACTIONS], managementActions:[...currentManagementActions], managementLabels:MANAGEMENT_LABELS,
			managementCatalog:{ groups:[
				{id:'base',label:'Workspace permissions',addonId:'base',attached:true,permissions:baseActions},
				{id:'mcp',label:'MCP',addonId:'mcp',attached:mcpAttached,permissions:mcpActions},
				{id:'apex',label:'APEX',addonId:'apex',attached:apexAttached,permissions:apexActions},
				{id:'studio',label:'Studio',addonId:'studio',attached:studioAttached,permissions:studioActions}
			],labels:MANAGEMENT_LABELS,count:currentManagementActions.length}, currentUser:{id:user.id,username:user.username,role:user.role},
			ownedCount:workspaces.filter((ws:any) => ws.permission === 'owner' && !ws.is_main).length
		}, { headers:{ 'cache-control':'private, no-store' } });
	} catch (error) { return fail(error); }
}

export async function POST({ request, cookies }) {
	try {
		const user = await requireUser(cookies);
		const body = await request.json().catch(() => ({}));
		const workspace = await createWorkspace(user,body);
		await writeAudit({
			actorUserId:user.id, workspaceId:workspace.id, action:'workspace.create',
			targetType:'workspace', targetId:workspace.id, detail:{ name:workspace.name }
		});
		return json({ workspace });
	} catch (error) { return fail(error); }
}
