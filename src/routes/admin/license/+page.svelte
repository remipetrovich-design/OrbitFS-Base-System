<script lang="ts">
	import { api, ApiError } from '$lib/api';
	import { addons } from '$lib/addons.svelte';
	import { Card, CardHeader, CardTitle, CardDescription, CardContent, Badge, Button, Input } from '$lib/components/ui';
	import { KeyRound, RefreshCw, LoaderCircle, HardDrive, Server, Sparkles, ShieldCheck } from '@lucide/svelte';

	type ComponentStatus = { state: string; allowed: boolean; lockedToThisInstallation?: boolean; reason?: string | null };
	type LicenseSummary = {
		valid: boolean;
		enforcement: boolean;
		reason?: string;
		keyHint?: string;
		lastCheckedAt?: string;
		offlineGrace?: boolean;
		components: Record<string, ComponentStatus>;
	};
	type ProviderSettings = { providerBase: string; allowedProviderBases: string[] };
	type UpdaterSettings = {
		mode: 'auto' | 'manual';
		providerBase: string;
		autoProviderBase: string;
		manualProviderBase: string | null;
		source: string;
		connected: boolean;
		authorized: boolean | null;
		lastVerifiedAt: string | null;
		lastStatus: number | null;
		lastCode: string | null;
		lastError: string | null;
		release?: { id?: string | null; version?: string | null; channel?: string | null; components?: string[] } | null;
	};

	const COMPONENT_META: Record<string, { label: string; icon: typeof HardDrive }> = {
		orbitfs_base: { label: 'Base System', icon: HardDrive },
		orbitfs_mcp: { label: 'MCP', icon: Server },
		orbitfs_apex: { label: 'APEX', icon: Sparkles },
		orbitfs_studio: { label: 'Studio', icon: Sparkles }
	};

	let summary = $state<LicenseSummary | null>(null);
	let provider = $state<ProviderSettings | null>(null);
	let providerInput = $state('');
	let providerSaving = $state(false);
	let providerMessage = $state('');
	let providerError = $state('');
	let updater = $state<UpdaterSettings | null>(null);
	let updaterMode = $state<'auto' | 'manual'>('auto');
	let updaterInput = $state('');
	let updaterTesting = $state(false);
	let updaterSaving = $state(false);
	let updaterMessage = $state('');
	let updaterError = $state('');
	let loading = $state(true);
	let refreshing = $state(false);
	let error = $state('');
	let keyInput = $state('');
	let activating = $state(false);
	let activateError = $state('');
	let activateErrorCode = $state('');
	let activateErrorStatus = $state<number | null>(null);
	let activateErrorDetails = $state<any>(null);

	async function loadProvider() {
		try {
			provider = await api.get<ProviderSettings>('/license/provider');
			providerInput = provider.providerBase;
		} catch (err) {
			providerError = err instanceof ApiError ? err.message : 'Failed to load licence API settings';
		}
	}

	async function loadUpdater() {
		try {
			updater = await api.get<UpdaterSettings>('/license/updater');
			updaterMode = updater.mode;
			updaterInput = updater.manualProviderBase || updater.providerBase;
		} catch (err) {
			updaterError = err instanceof ApiError ? err.message : 'Failed to load updater connection';
		}
	}

	function updaterPayload() {
		return { mode: updaterMode, providerBase: updaterMode === 'manual' ? updaterInput.trim() : '' };
	}

	async function testUpdater() {
		updaterTesting = true;
		updaterError = '';
		updaterMessage = '';
		try {
			updater = await api.post<UpdaterSettings>('/license/updater', updaterPayload());
			updaterMessage = updater.connected
				? (updater.authorized === false ? 'Updater endpoint reached, but this licence is not authorized.' : 'Updater connection verified.')
				: 'Updater connection could not be verified.';
		} catch (err) {
			updaterError = err instanceof ApiError ? err.message : 'Could not test updater connection';
		} finally {
			updaterTesting = false;
		}
	}

	async function saveUpdater() {
		updaterSaving = true;
		updaterError = '';
		updaterMessage = '';
		try {
			updater = await api.put<UpdaterSettings>('/license/updater', updaterPayload());
			updaterMode = updater.mode;
			updaterInput = updater.manualProviderBase || updater.providerBase;
			updaterMessage = 'Updater connection verified and saved.';
		} catch (err) {
			updaterError = err instanceof ApiError ? err.message : 'Could not save updater connection';
		} finally {
			updaterSaving = false;
		}
	}

	async function load(refresh = false) {
		if (refresh) refreshing = true;
		else loading = true;
		error = '';
		try {
			summary = await api.get<LicenseSummary>(`/license/status${refresh ? '?refresh=1' : ''}`);
			await Promise.all([loadProvider(), loadUpdater()]);
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Failed to load licence status';
		} finally {
			loading = false;
			refreshing = false;
		}
	}

	load();

	async function saveProvider() {
		providerSaving = true;
		providerError = '';
		providerMessage = '';
		try {
			provider = await api.put<ProviderSettings>('/license/provider', { providerBase: providerInput });
			providerInput = provider.providerBase;
			providerMessage = 'Licence API updated.';
			await load(true);
		} catch (err) {
			providerError = err instanceof ApiError ? err.message : 'Could not update licence API';
		} finally {
			providerSaving = false;
		}
	}

	async function activate(e: Event) {
		e.preventDefault();
		if (!keyInput.trim()) return;
		activating = true;
		activateError = '';
		activateErrorCode = '';
		activateErrorStatus = null;
		activateErrorDetails = null;
		try {
			await api.post('/license/activate', { licenseKey: keyInput.trim() });
			keyInput = '';
			await Promise.all([load(), addons.load()]);
		} catch (err) {
			if (err instanceof ApiError) {
				activateError = err.message;
				activateErrorCode = err.code || '';
				activateErrorStatus = err.status;
				activateErrorDetails = err.details;
			} else {
				activateError = 'Activation failed';
			}
		} finally {
			activating = false;
		}
	}
</script>

<div class="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="flex items-center gap-2 text-xl font-semibold tracking-tight"><KeyRound class="size-5 text-muted-foreground" />Licence</h1>
			<p class="text-sm text-muted-foreground">Component entitlement and activation.</p>
		</div>
		<Button variant="outline" size="sm" onclick={() => load(true)} disabled={refreshing}><RefreshCw class="size-4 {refreshing ? 'animate-spin' : ''}" />Refresh</Button>
	</div>

	{#if error}<div class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>{/if}

	{#if loading}
		<div class="flex items-center justify-center gap-2 py-16 text-muted-foreground"><LoaderCircle class="size-5 animate-spin" />Loading&hellip;</div>
	{:else if summary}
		<Card>
			<CardHeader>
				<div class="flex items-center justify-between"><CardTitle>Overview</CardTitle><Badge variant={summary.valid ? 'success' : 'destructive'}>{summary.valid ? 'Valid' : 'Invalid'}</Badge></div>
				<CardDescription>{#if !summary.enforcement}Licence enforcement is disabled — all components run unrestricted (development mode).{:else}{summary.reason ?? '—'}{#if summary.offlineGrace}&middot; running on cached offline grace period{/if}{/if}</CardDescription>
			</CardHeader>
			<CardContent class="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
				{#if summary.keyHint}<span>Key: {summary.keyHint}</span>{/if}
				{#if summary.lastCheckedAt}<span>Last checked: {new Date(summary.lastCheckedAt).toLocaleString()}</span>{/if}
			</CardContent>
		</Card>

		<div class="grid gap-4 sm:grid-cols-2">
			{#each Object.entries(summary.components) as [id, comp] (id)}
				{@const meta = COMPONENT_META[id] ?? { label: id, icon: HardDrive }}
				{@const Icon = meta.icon}
				<Card><CardHeader><div class="flex items-center justify-between"><CardTitle class="flex items-center gap-2"><Icon class="size-4 text-muted-foreground" />{meta.label}</CardTitle><Badge variant={comp.allowed ? 'success' : 'destructive'}>{comp.state}</Badge></div>{#if comp.reason}<CardDescription class="mt-1">{comp.reason}</CardDescription>{/if}</CardHeader></Card>
			{/each}
		</div>

		<Card>
			<CardHeader>
				<CardTitle class="flex items-center gap-2"><ShieldCheck class="size-4 text-muted-foreground" />Licence API</CardTitle>
				<CardDescription>Choose the approved OrbitFS licence system used by this deployment. Custom hosts are rejected server-side.</CardDescription>
			</CardHeader>
			<CardContent class="space-y-3">
				{#if provider}
					<div class="flex flex-col gap-2 sm:flex-row">
						<select class="h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm" bind:value={providerInput}>
							{#each provider.allowedProviderBases as url}<option value={url}>{url}</option>{/each}
						</select>
						<Button type="button" onclick={saveProvider} disabled={providerSaving || !providerInput || providerInput === provider.providerBase}>{#if providerSaving}<LoaderCircle class="size-4 animate-spin" />{/if}Save API</Button>
					</div>
					<p class="text-xs text-muted-foreground">Validation path is controlled by OrbitFS and cannot be replaced with an arbitrary external URL.</p>
				{/if}
				{#if providerError}<p class="text-sm text-destructive">{providerError}</p>{/if}
				{#if providerMessage}<p class="text-sm text-muted-foreground">{providerMessage}</p>{/if}
			</CardContent>
		</Card>


		<Card>
			<CardHeader>
				<div class="flex items-center justify-between gap-3">
					<div>
						<CardTitle class="flex items-center gap-2"><RefreshCw class="size-4 text-muted-foreground" />Update system</CardTitle>
						<CardDescription>Auto uses the deployed OrbitFS updater. Manual mode links another deployment of the same /api/v1/updater contract.</CardDescription>
					</div>
					{#if updater}<Badge variant={updater.connected ? 'success' : 'destructive'}>{updater.connected ? 'Connected' : 'Not verified'}</Badge>{/if}
				</div>
			</CardHeader>
			<CardContent class="space-y-3">
				{#if updater}
					<div class="grid gap-2 sm:grid-cols-[140px_1fr]">
						<select class="h-10 rounded-md border border-input bg-background px-3 text-sm" bind:value={updaterMode}>
							<option value="auto">Automatic</option>
							<option value="manual">Manual link</option>
						</select>
						{#if updaterMode === 'manual'}
							<Input bind:value={updaterInput} placeholder="https://updates.example.com/api/v1/updater" />
						{:else}
							<Input value={updater.autoProviderBase} disabled />
						{/if}
					</div>
					<div class="flex flex-wrap gap-2">
						<Button type="button" variant="outline" onclick={testUpdater} disabled={updaterTesting || updaterSaving || (updaterMode === 'manual' && !updaterInput.trim())}>
							{#if updaterTesting}<LoaderCircle class="size-4 animate-spin" />{/if}Test connection
						</Button>
						<Button type="button" onclick={saveUpdater} disabled={updaterTesting || updaterSaving || (updaterMode === 'manual' && !updaterInput.trim())}>
							{#if updaterSaving}<LoaderCircle class="size-4 animate-spin" />{/if}Save updater
						</Button>
					</div>
					<div class="space-y-1 text-xs text-muted-foreground">
						<p>Active endpoint: <span class="font-mono text-foreground">{updater.providerBase}</span></p>
						<p>Source: {updater.source}{#if updater.lastVerifiedAt} · last verified {new Date(updater.lastVerifiedAt).toLocaleString()}{/if}{#if updater.lastStatus} · HTTP {updater.lastStatus}{/if}</p>
						<p>Shared Engine release checks and deployments use this same updater endpoint. The endpoint is also propagated into Shared Engine Vercel environment on deploy/update.</p>
					</div>
				{/if}
				{#if updaterError}<p class="text-sm text-destructive">{updaterError}</p>{/if}
				{#if updaterMessage}<p class="text-sm text-muted-foreground">{updaterMessage}</p>{/if}
			</CardContent>
		</Card>

		<Card>
			<CardHeader><CardTitle>Activate / replace key</CardTitle><CardDescription>Enter a licence key to activate or replace the OrbitFS Base entitlement.</CardDescription></CardHeader>
			<CardContent>
				<form class="flex flex-col gap-2 sm:flex-row" onsubmit={activate}><Input bind:value={keyInput} placeholder="Licence key" class="flex-1" /><Button type="submit" disabled={activating}>{#if activating}<LoaderCircle class="size-4 animate-spin" />{/if}Activate</Button></form>
				{#if activateError}
					<div class="mt-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
						<p class="font-medium">{activateError}</p>
						{#if activateErrorCode || activateErrorStatus}
							<p class="mt-1 font-mono text-xs">Code: {activateErrorCode || 'UNKNOWN'} · HTTP: {activateErrorStatus ?? '—'}</p>
						{/if}
						{#if activateErrorDetails}
							<pre class="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded border bg-background/70 p-3 text-xs text-foreground">{JSON.stringify(activateErrorDetails, null, 2)}</pre>
						{/if}
					</div>
				{/if}
			</CardContent>
		</Card>
	{/if}
</div>
