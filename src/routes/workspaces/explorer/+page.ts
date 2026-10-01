import { redirect } from '@sveltejs/kit';

export function load({ url }) {
	const query = url.search ? url.search : '';
	throw redirect(307, '/library' + query);
}
