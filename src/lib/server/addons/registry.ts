export type PanelAddonManifest = {
	id: string;
	name: string;
	description: string;
	version: string;
	kind: string;
};

const manifests = new Map<string, PanelAddonManifest>([
	['mcp', { id:'mcp', name:'OrbitFS MCP', description:'Engine-hosted MCP component.', version:'', kind:'engine' }],
	['apex', { id:'apex', name:'OrbitFS APEX', description:'Engine-hosted APEX component.', version:'', kind:'engine' }],
	['studio', { id:'studio', name:'OrbitFS Studio', description:'Engine-hosted Studio component.', version:'', kind:'engine' }]
]);

export function getPanelAddonManifest(id: string) {
	return manifests.get(id) ?? null;
}

export async function dispatchPanelAddonHttp(id: string, _request: Request): Promise<Response> {
	if (id === 'mcp') {
		return new Response(JSON.stringify({
			error: 'MCP resource server is hosted by the installation Shared Engine Host'
		}), {
			status: 410,
			headers: { 'content-type': 'application/json' }
		});
	}
	if (id === 'apex' || id === 'studio') {
		return new Response(JSON.stringify({
			error: id.toUpperCase() + ' runtime is hosted by the installation Shared Engine Host'
		}), {
			status: 410,
			headers: { 'content-type': 'application/json' }
		});
	}
	return new Response(JSON.stringify({ error: 'Addon route not found' }), {
		status: 404,
		headers: { 'content-type': 'application/json' }
	});
}