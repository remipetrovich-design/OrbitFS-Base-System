<script lang="ts">
	import { api, ApiError } from '$lib/api';
	import { Card, CardHeader, CardTitle, CardDescription, CardContent, Button, Input } from '$lib/components/ui';
	import { CheckCircle2, KeyRound, LoaderCircle, Network, Save, ShieldCheck } from '@lucide/svelte';

	type Connection={
		label:string;
		base_url:string;
		priority?:number;
		allowed_clients?:string[];
		settings?:Record<string,unknown>;
	};
	type Config={
		providerBase:string;
		allowedProviderBases:string[];
		officialConnections?:Connection[];
		registryAuthority?:string;
	};

	let config=$state<Config|null>(null);
	let apiUrl=$state('');
	let loading=$state(true);
	let saving=$state(false);
	let testing=$state(false);
	let error=$state('');
	let message=$state('');

	function err(e:unknown,fallback:string){return e instanceof ApiError?e.message:fallback;}

	async function load(){
		loading=true;error='';
		try{
			config=await api.get<Config>('/license/provider');
			apiUrl=config.providerBase||'';
		}catch(e){error=err(e,'Unable to load API connections');}
		finally{loading=false;}
	}
	async function save(event:Event){
		event.preventDefault();saving=true;error='';message='';
		try{
			config=await api.put<Config>('/license/provider',{providerBase:apiUrl.trim()});
			apiUrl=config.providerBase;
			message='Official OrbitFS licence API selected.';
		}catch(e){error=err(e,'Could not save API connection');}
		finally{saving=false;}
	}
	async function test(){
		testing=true;error='';message='';
		try{
			const result=await api.post<any>('/license/provider/test',{providerBase:apiUrl.trim()});
			message=result?.master?.ok?'Connected · HTTP '+String(result.master.status||200):'Connection failed'+(result?.master?.error?': '+result.master.error:'');
		}catch(e){error=err(e,'API connection test failed');}
		finally{testing=false;}
	}
	load();
</script>

<svelte:head><title>API Connections · OrbitFS</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
	<div class="space-y-1">
		<div class="flex items-center gap-2 text-xs font-medium uppercase tracking-[.12em] text-muted-foreground"><ShieldCheck class="size-4" />OrbitFS Configuration</div>
		<h1 class="text-xl font-semibold tracking-tight">API Connections</h1>
		<p class="max-w-3xl text-sm text-muted-foreground">Choose the official OrbitFS licence API used by this Base installation. License Manager publishes the approved registry; arbitrary URLs are rejected by the server.</p>
	</div>

	{#if loading}
		<Card><CardContent class="flex items-center gap-2 p-5 text-sm text-muted-foreground"><LoaderCircle class="size-4 animate-spin" />Loading official API registry…</CardContent></Card>
	{:else}
		<Card>
			<CardHeader>
				<CardTitle class="flex items-center gap-2"><KeyRound class="size-4" />Licence runtime API</CardTitle>
				<CardDescription>All Base licence validation, pulses, entitlement checks and check-ins use this selected endpoint.</CardDescription>
			</CardHeader>
			<CardContent>
				<form class="space-y-4" onsubmit={save}>
					<div class="space-y-1.5">
						<label for="api-url" class="text-sm font-medium">Official API URL</label>
						<Input id="api-url" list="official-license-apis" bind:value={apiUrl} placeholder="https://incendiarynetworks.cc/api/v1/license" />
						<datalist id="official-license-apis">{#each config?.officialConnections||[] as connection}<option value={connection.base_url}>{connection.label}</option>{/each}</datalist>
						<p class="text-xs text-muted-foreground">You can paste or type a URL, but it will only save if it exactly matches an enabled <code>v1_base</code> licence runtime endpoint in License Manager.</p>
					</div>
					<div class="flex flex-wrap gap-2">
						<Button type="submit" size="sm" disabled={saving||!apiUrl}>{#if saving}<LoaderCircle class="size-4 animate-spin" />{:else}<Save class="size-4" />{/if}Save official API</Button>
						<Button type="button" size="sm" variant="outline" disabled={testing||!apiUrl} onclick={test}>{#if testing}<LoaderCircle class="size-4 animate-spin" />{:else}<Network class="size-4" />{/if}Test connection</Button>
						{#if (config?.officialConnections||[]).length}<Button type="button" size="sm" variant="outline" onclick={()=>apiUrl=config?.officialConnections?.[0]?.base_url||apiUrl}>Use recommended</Button>{/if}
					</div>
				</form>
				{#if message}<p class="mt-3 flex items-center gap-1 text-sm text-success"><CheckCircle2 class="size-4" />{message}</p>{/if}
				{#if error}<p class="mt-3 text-sm text-destructive">{error}</p>{/if}
			</CardContent>
		</Card>

		<Card>
			<CardHeader><CardTitle>Approved OrbitFS endpoints</CardTitle><CardDescription>Read from the immutable License Manager trust anchor <code>{config?.registryAuthority||'https://incendiarynetworks.cc/api/v1'}</code>.</CardDescription></CardHeader>
			<CardContent class="space-y-2">
				{#each config?.officialConnections||[] as connection}
					<div class="rounded-lg border p-4">
						<div class="flex flex-wrap items-start justify-between gap-3"><div><p class="font-medium">{connection.label}</p><code class="mt-1 block break-all text-xs">{connection.base_url}</code></div><span class="rounded-full border px-2 py-1 text-[10px]">{connection.base_url===config?.providerBase?'SELECTED':'AVAILABLE'}</span></div>
						<p class="mt-2 text-xs text-muted-foreground">Priority {connection.priority??100} · {(connection.allowed_clients||[]).join(', ')||'OrbitFS Base'}</p>
					</div>
				{/each}
			</CardContent>
		</Card>

		<Card>
			<CardHeader><CardTitle>Connection boundary</CardTitle><CardDescription>This page is only for official OrbitFS authority APIs.</CardDescription></CardHeader>
			<CardContent class="grid gap-3 md:grid-cols-2">
				<div class="rounded-lg border p-4"><p class="font-medium">Official authority</p><p class="mt-1 text-sm text-muted-foreground">License Manager runtime API is selectable here and is validated against the registry before every use.</p></div>
				<div class="rounded-lg border p-4"><p class="font-medium">Installation services</p><p class="mt-1 text-sm text-muted-foreground">Your Panel URL, Engine Host URL, Vercel deployment and Supabase project are installation-specific and remain under their existing configuration pages.</p></div>
			</CardContent>
		</Card>
	{/if}

	<a href="/admin/config" class="text-sm text-muted-foreground hover:text-foreground">← Back to OrbitFS configuration</a>
</div>
