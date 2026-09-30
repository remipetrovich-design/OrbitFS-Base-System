import { redirect } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { assertComponentRuntimeReady } from '$lib/server/component-license';
export async function load({ cookies, url }: any) { await requireAdmin(cookies); try { await assertComponentRuntimeReady('orbitfs_studio'); } catch (error:any) { throw redirect(303, `/library?addon=studio&error=${encodeURIComponent(String(error?.code||'COMPONENT_NOT_READY'))}`); } return { studioReady: true, next: `${url.pathname}${url.search}` }; }
