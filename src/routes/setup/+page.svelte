<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { api, ApiError } from '$lib/api';
	import { Button, Card, CardContent } from '$lib/components/ui';
	import { CheckCircle2, CircleAlert, Cloud, Database, HardDrive, KeyRound, LoaderCircle, RefreshCw, UserPlus, Workflow } from '@lucide/svelte';

	const LICENSE_KEY_PATTERN = /^LIC-[A-Z0-9]{10}-[A-Z0-9]{10}-[A-Z0-9]{10}$/;
	type SetupItem = { title: string; description: string; complete: boolean };
	type SetupConfig = {
		setupComplete: boolean;
		needsSetup: boolean;
		currentStep: 'core' | 'license' | 'owner' | 'workspace' | 'complete';
		coreReady: boolean;
		licenseReady: boolean;
		ownerExists: boolean;
		mainWorkspaceId: string | null;
		config: Record<string, string | number>;
		steps: {
			runtime: SetupItem;
			database: SetupItem;
			storage: SetupItem;
			license: SetupItem;
			owner: SetupItem;
			workspace: SetupItem;
		};
		notes: string[];
	};

	let loading = $state(true);
	let working = $state(false);
	let activating = $state(false);
	let licenseKey = $state('');
	let error = $state('');
	let model = $state<SetupConfig | null>(null);
	onMount(load);

	async function load() {
		loading = true;
		error = '';
		try {
			model = await api.get<SetupConfig>('/setup/config');
			if (model.setupComplete) await goto('/login');
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Could not load setup status';
		} finally {
			loading = false;
		}
	}

	async function bootstrap() {
		working = true;
		error = '';
		try {
			model = await api.post<SetupConfig & { ok: boolean }>('/setup/bootstrap');
			if (model.setupComplete) await goto('/login');
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Could not prepare OrbitFS Base';
		} finally {
			working = false;
		}
	}

	async function activateLicense(event: SubmitEvent) {
		event.preventDefault();
		const key = licenseKey.trim().toUpperCase();
		if (!LICENSE_KEY_PATTERN.test(key)) {
			error = 'Invalid licence key format. Use LIC-XXXXXXXXXX-XXXXXXXXXX-XXXXXXXXXX.';
			return;
		}
		activating = true;
		error = '';
		try {
			const response = await fetch('/api/license/activate', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ licenseKey: key })
			});
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(payload?.error || payload?.code || 'Licence activation failed');
			licenseKey = '';
			await load();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Licence activation failed';
		} finally {
			activating = false;
		}
	}

	const statusText = (complete: boolean) => complete ? 'Ready' : 'Needs setup';
</script>

<div class="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
	<header class="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-4">
		<div>
			<p class="text-xs font-semibold uppercase tracking-[.16em] text-primary">Base system setup</p>
			<h1 class="mt-1 text-2xl font-semibold">Prepare OrbitFS Panel</h1>
			<p class="mt-1 max-w-2xl text-sm text-muted-foreground">First-time setup prepares the Panel, database, storage, licence, first Owner and main workspace. Engines stay detached until you install them later.</p>
		</div>
		<Button variant="outline" onclick={load} disabled={loading || working}><RefreshCw class="size-4" />Refresh</Button>
	</header>

	{#if loading}
		<Card><CardContent class="flex items-center gap-2 p-5 text-sm text-muted-foreground"><LoaderCircle class="size-4 animate-spin" />Checking Base setup…</CardContent></Card>
	{:else if error && !model}
		<div class="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
	{:else if model}
		{#if error}<div class="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>{/if}

		<div class="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
			{#each [
				{ key: 'runtime', icon: Cloud, item: model.steps.runtime },
				{ key: 'database', icon: Database, item: model.steps.database },
				{ key: 'storage', icon: HardDrive, item: model.steps.storage },
				{ key: 'license', icon: KeyRound, item: model.steps.license },
				{ key: 'owner', icon: UserPlus, item: model.steps.owner },
				{ key: 'workspace', icon: Workflow, item: model.steps.workspace }
			] as entry (entry.key)}
				{@const Icon = entry.icon}
				<Card>
					<CardContent class="space-y-3 p-5">
						<div class="flex items-center justify-between gap-3">
							<div class="flex items-center gap-2 font-medium"><Icon class="size-4" />{entry.item.title}</div>
							<span class={entry.item.complete ? 'text-xs font-medium text-success' : 'text-xs font-medium text-warning'}>{statusText(entry.item.complete)}</span>
						</div>
						<p class="text-sm text-muted-foreground">{entry.item.description}</p>
						<div class="flex items-center gap-1 text-xs" class:text-success={entry.item.complete} class:text-warning={!entry.item.complete}>
							{#if entry.item.complete}<CheckCircle2 class="size-4" />{:else}<CircleAlert class="size-4" />{/if}
							{statusText(entry.item.complete)}
						</div>
					</CardContent>
				</Card>
			{/each}
		</div>

		<Card>
			<CardContent class="space-y-4 p-5">
				<div>
					<h2 class="font-medium">Next step</h2>
					<p class="mt-1 text-sm text-muted-foreground">
						{#if model.currentStep === 'core'}Prepare the Base data layer before creating an Owner.
						{:else if model.currentStep === 'license'}Activate the OrbitFS Base System licence before creating the first Owner.
						{:else if model.currentStep === 'owner'}Core services and licensing are ready. Create the first protected Owner account.
						{:else if model.currentStep === 'workspace'}The Owner exists, but the main workspace needs repair/bootstrap.
						{:else}Base setup is complete.{/if}
					</p>
				</div>
				<div class="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
					<div>Panel: <span class="font-mono">{model.config.publicOrigin}</span></div>
					<div>API: <span class="font-mono">{model.config.apiBase}</span></div>
					<div>Storage: <span class="font-mono">{model.config.storageRoot}</span></div>
					<div>Database: <span class="font-mono">Supabase Postgres</span></div>
					{#if model.config.engineHostUrl}<div>Engine Host: <span class="font-mono">{model.config.engineHostUrl}</span></div>{/if}
				</div>
				<div class="flex flex-wrap gap-2">
					{#if model.currentStep === 'core'}
						<Button onclick={bootstrap} disabled={working}>{#if working}<LoaderCircle class="size-4 animate-spin" />{/if}Prepare Base</Button>
					{:else if model.currentStep === 'license'}
						<form class="w-full space-y-3" onsubmit={activateLicense}>
							<label class="block text-sm font-medium" for="setup-license-key">OrbitFS licence key</label>
							<input id="setup-license-key" class="h-11 w-full rounded-md border border-input bg-background px-3 font-mono text-sm" bind:value={licenseKey} autocomplete="off" spellcheck="false" placeholder="LIC-XXXXXXXXXX-XXXXXXXXXX-XXXXXXXXXX" maxlength="36" />
							<p class="text-xs text-muted-foreground">Enter the licence key here on the deployed Base. Billing Store never receives or stores this key.</p>
							<Button type="submit" disabled={activating || !licenseKey.trim()}>{#if activating}<LoaderCircle class="size-4 animate-spin" />{/if}<KeyRound class="size-4" />Activate licence</Button>
						</form>
					{:else if model.currentStep === 'owner'}
						<Button onclick={() => goto('/setup/owner')}><UserPlus class="size-4" />Create first Owner</Button>
					{:else if model.currentStep === 'workspace'}
						<Button onclick={bootstrap} disabled={working}>{#if working}<LoaderCircle class="size-4 animate-spin" />{/if}Repair Base setup</Button>
					{/if}
				</div>
			</CardContent>
		</Card>

		<div class="rounded-lg border bg-muted/10 p-4 text-xs text-muted-foreground">
			<b class="text-foreground">Engine boundary:</b> MCP, APEX and Studio are not part of first-time Base setup. Their install, attach, pairing and engine setup happen later from Add-on management.
		</div>
	{/if}
</div>
