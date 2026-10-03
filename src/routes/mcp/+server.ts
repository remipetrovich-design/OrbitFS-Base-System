import type { RequestHandler } from './$types';
import { getSharedEngineHostState } from '$lib/server/engine-host-state';

const moved: RequestHandler = async () => {
	const host=await getSharedEngineHostState().catch(()=>null);
	const base=String(host?.hostUrl||'').replace(/\/$/,'');
	const resource=base?base+'/mcp':null;
	const metadata=base?base+'/.well-known/oauth-protected-resource':null;
	return new Response(JSON.stringify({
		error: 'OrbitFS MCP is hosted by the installation Shared Engine Host',
		resource,
		protectedResourceMetadata:metadata
	}), {
		status: 410,
		headers: {
			'content-type': 'application/json',
			...(resource?{'link': `<${resource}>; rel="alternate"`}:{})
		}
	});
};

export const GET = moved;
export const POST = moved;
export const DELETE = moved;
