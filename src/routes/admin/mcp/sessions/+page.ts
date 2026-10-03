import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = () => {
	throw redirect(307, '/api/engine-host/launch?engine=mcp&path=%2Fengines%2Fmcp%2Fconnections');
};
