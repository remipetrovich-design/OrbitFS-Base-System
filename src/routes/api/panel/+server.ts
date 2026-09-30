import { json } from '@sveltejs/kit';
import { requireUser, type OrbitUser } from '$lib/server/auth';
import { getSupabaseAdmin } from '$lib/server/supabase';
import { writeAudit } from '$lib/server/audit';

const slugify = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
const cleanName = (value: unknown) => String(value ?? '').trim();
const rank: Record<string, number> = { viewer: 0, contributor: 1, editor: 2, owner: 3 };

async function workspaceAccess(user: OrbitUser, workspaceId: string) {
	if (user.role === 'owner' || user.role === 'admin') return 'owner';
	const supabase = getSupabaseAdmin();
	const { data: member } = await supabase.from('orbitfs_workspace_members').select('role').eq('workspace_id', workspaceId).eq('user_id', user.id).maybeSingle();
	if (member?.role) return member.role as string;
	const { data: workspace } = await supabase.from('orbitfs_workspaces').select('visibility').eq('id', workspaceId).maybeSingle();
	return workspace?.visibility === 'public' ? 'viewer' : null;
}
async function requireWorkspaceAccess(user: OrbitUser, workspaceId: string, minimum: 'viewer' | 'contributor' | 'editor' | 'owner') {
	const access = await workspaceAccess(user, workspaceId);
	if (!access || (rank[access] ?? -1) < rank[minimum]) return null;
	return access;
}
async function accessibleWorkspaceRows(user: OrbitUser) {
	const supabase = getSupabaseAdmin();
	if (user.role === 'owner' || user.role === 'admin') {
		const { data, error } = await supabase.from('orbitfs_workspaces').select('*').order('is_main', { ascending: false }).order('name');
		if (error) throw error;
		return (data ?? []).map((workspace) => ({ ...workspace, permission: 'owner' }));
	}
	const [{ data: memberships, error: memberError }, { data: publicRows, error: publicError }] = await Promise.all([
		supabase.from('orbitfs_workspace_members').select('workspace_id,role').eq('user_id', user.id),
		supabase.from('orbitfs_workspaces').select('*').eq('visibility', 'public')
	]);
	if (memberError) throw memberError;
	if (publicError) throw publicError;
	const memberMap = new Map((memberships ?? []).map((item) => [item.workspace_id, item.role]));
	const memberIds = [...memberMap.keys()];
	let memberRows: any[] = [];
	if (memberIds.length) {
		const { data, error } = await supabase.from('orbitfs_workspaces').select('*').in('id', memberIds);
		if (error) throw error;
		memberRows = data ?? [];
	}
	const combined = new Map<string, any>();
	for (const row of publicRows ?? []) combined.set(row.id, { ...row, permission: memberMap.get(row.id) ?? 'viewer' });
	for (const row of memberRows) combined.set(row.id, { ...row, permission: memberMap.get(row.id) ?? 'viewer' });
	return [...combined.values()].sort((a, b) => Number(b.is_main) - Number(a.is_main) || a.name.localeCompare(b.name));
}

export async function GET({ cookies }) {
	const user = await requireUser(cookies);
	const supabase = getSupabaseAdmin();
	try {
		const workspaces = await accessibleWorkspaceRows(user);
		const ids = workspaces.map((item) => item.id);
		if (!ids.length) return json({ workspaces: [], profiles: [], files: [], permissions: [], settings: [] });
		const [profilesResult, filesResult, permissionsResult] = await Promise.all([
			supabase.from('orbitfs_profiles').select('*').in('workspace_id', ids).order('updated_at', { ascending: false }),
			supabase.from('orbitfs_files').select('*').in('workspace_id', ids).is('deleted_at', null).order('kind').order('name'),
			supabase.from('orbitfs_file_permissions').select('*').in('workspace_id', ids).order('path_prefix')
		]);
		const failure = [profilesResult, filesResult, permissionsResult].find((result) => result.error);
		if (failure?.error) throw failure.error;
		let settings: any[] = [];
		if (user.role === 'owner' || user.role === 'admin') {
			const result = await supabase.from('orbitfs_settings').select('*');
			if (result.error) throw result.error;
			settings = result.data ?? [];
		}
		return json({ workspaces, profiles: profilesResult.data ?? [], files: filesResult.data ?? [], permissions: permissionsResult.data ?? [], settings });
	} catch (error) {
		console.error('OrbitFS panel load failed', error);
		return json({ error: 'Base System database load failed' }, { status: 500 });
	}
}

export async function POST({ request, cookies }) {
	const user = await requireUser(cookies);
	const body = await request.json().catch(() => ({}));
	const action = String(body.action ?? '');
	const supabase = getSupabaseAdmin();

	if (action === 'workspace.create') {
		const name = cleanName(body.name);
		if (name.length < 2) return json({ error: 'Workspace name is required' }, { status: 400 });
		let slug = slugify(name) || 'workspace';
		const { count } = await supabase.from('orbitfs_workspaces').select('*', { count: 'exact', head: true }).like('slug', `${slug}%`);
		if ((count ?? 0) > 0) slug = `${slug}-${Date.now().toString(36)}`;
		const { data, error } = await supabase.from('orbitfs_workspaces').insert({
			name, slug, description: cleanName(body.description),
			visibility: ['private','shared','public'].includes(body.visibility) ? body.visibility : 'private',
			created_by: user.id
		}).select('*').single();
		if (error || !data) return json({ error: error?.message ?? 'Create failed' }, { status: 500 });
		const member = await supabase.from('orbitfs_workspace_members').insert({ workspace_id: data.id, user_id: user.id, role: 'owner' });
		const library = await supabase.from('orbitfs_library_state').upsert({ workspace_id: data.id, state: { version: 9, workspaceId: data.id, items: [], collections: [], groups: [], categories: [], links: [], usage: [], sections: [], events: [], sourceHistory: [], autoLinks: [], entities: [], entityMentions: [], facts: [], factRelations: [], records: [], changeRequests: [], settings: { freshnessMs: 30000, maxFreshRefresh: 100, ingestMaxItems: 1000, ingestBatch: 100, autoIndexKnowledge: true, retrievalLimit: 12, retrievalMaxChars: 12000, analysisMaxItems: 250, analysisMaxCharacters: 1500000 }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, updated_at: new Date().toISOString() }, { onConflict: 'workspace_id' });
		if (member.error || library.error) return json({ error: member.error?.message || library.error?.message || 'Workspace initialization failed' }, { status: 500 });
		await writeAudit({ actorUserId: user.id, workspaceId: data.id, action, targetType: 'workspace', targetId: data.id });
		return json({ ok: true, item: { ...data, permission: 'owner' } });
	}

	if (action === 'workspace.update') {
		const id = cleanName(body.id);
		if (!await requireWorkspaceAccess(user, id, 'editor')) return json({ error: 'Workspace edit permission required' }, { status: 403 });
		const patch: Record<string, unknown> = {};
		if (body.name !== undefined) { patch.name = cleanName(body.name); patch.slug = slugify(cleanName(body.name)); }
		if (body.description !== undefined) patch.description = cleanName(body.description);
		if (['active','offline','archived'].includes(body.status)) patch.status = body.status;
		if (['private','shared','public'].includes(body.visibility)) patch.visibility = body.visibility;
		const { data, error } = await supabase.from('orbitfs_workspaces').update(patch).eq('id', id).select('*').single();
		if (error) return json({ error: error.message }, { status: 500 });
		await writeAudit({ actorUserId: user.id, workspaceId: id, action, targetType: 'workspace', targetId: id });
		return json({ ok: true, item: data });
	}

	if (action === 'workspace.delete') {
		const id = cleanName(body.id);
		if (!await requireWorkspaceAccess(user, id, 'owner')) return json({ error: 'Workspace owner permission required' }, { status: 403 });
		const { data: workspace } = await supabase.from('orbitfs_workspaces').select('is_main').eq('id', id).maybeSingle();
		if (workspace?.is_main) return json({ error: 'Main workspace cannot be deleted' }, { status: 400 });
		const { error } = await supabase.from('orbitfs_workspaces').delete().eq('id', id);
		if (error) return json({ error: error.message }, { status: 500 });
		await writeAudit({ actorUserId: user.id, workspaceId: id, action, targetType: 'workspace', targetId: id });
		return json({ ok: true });
	}

	if (action === 'file.create' || action === 'file.update' || action === 'file.delete' || action === 'permission.save' || action === 'permission.delete') {
		return json({ error: 'The legacy filesystem is retired. Use Library/Memory and structured records instead.', code: 'LEGACY_FILESYSTEM_RETIRED' }, { status: 410 });
	}

	return json({ error: 'Unknown panel action' }, { status: 400 });
}
