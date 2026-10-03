import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = () => {
	throw redirect(307, '/api/engine-host/launch?engine=studio&path=%2Fengines%2Fstudio%2Fconfiguration');
};
