import { json } from '@sveltejs/kit';
import { getSessionUser, hashPassword } from '$lib/server/auth';
import { getSupabaseAdmin } from '$lib/server/supabase';

export async function POST({ request, cookies }) {
	const user = await getSessionUser(cookies);
	if (!user || !user.must_change_pin) return json({ error:'Password change session is invalid' }, { status:401 });
	const body = await request.json().catch(() => ({}));
	const password = String(body.password ?? '');
	if (password.length < 8 || password.length > 128 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) return json({ error:'Password must be 8-128 characters and include a letter and number' }, { status:400 });
	if (password.toLowerCase().includes(String(user.username||'').toLowerCase())) return json({ error:'Password cannot include the username' }, { status:400 });
	const supabase = getSupabaseAdmin();
	const { error } = await supabase.from('orbitfs_users').update({ password_hash:hashPassword(password), must_change_pin:false }).eq('id', user.id);
	if (error) return json({ error:error.message }, { status:500 });
	return json({ token:'cookie-session', username:user.username, role:user.role, email:user.email, mustChangePin:false });
}
