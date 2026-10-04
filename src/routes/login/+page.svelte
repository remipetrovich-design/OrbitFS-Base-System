<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { auth } from '$lib/auth.svelte';
	import { api, ApiError } from '$lib/api';
	import { Button, Input, Card, CardContent } from '$lib/components/ui';
	import { HardDrive, Eye, EyeOff, LoaderCircle, ShieldCheck, Database, Server, UserPlus } from '@lucide/svelte';

	type HealthKey = 'panel' | 'api';
	type HealthItem = { key: HealthKey; label: string; detail: string; online: boolean | null; icon: typeof Server };
	type RegistrationStatus = { mode: 'off' | 'open' | 'approval_queue'; available: boolean; queueMode: boolean };

	let username = $state('');
	let password = $state('');
	let needsSetup = $state(false);
	let showPassword = $state(false);
	let error = $state('');
	let submitting = $state(false);
	let forcedToken = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let lastChecked = $state('checking');
	let health = $state<Record<HealthKey, boolean | null>>({ panel: null, api: null });
	let mode = $state<'login' | 'register'>('login');
	let registration = $state<RegistrationStatus>({ mode: 'off', available: false, queueMode: false });
	let registerUsername = $state('');
	let registerEmail = $state('');
		let registerPassword = $state('');
	let registerConfirmPassword = $state('');
	let registerMessage = $state('');

	const statusItems = $derived<HealthItem[]>([
		{ key: 'panel', label: 'Panel', detail: 'public shell', online: health.panel, icon: Server },
		{ key: 'api', label: 'API', detail: 'backend', online: health.api, icon: Database },
	]);

	async function check(url: string) {
		try {
			const res = await fetch(url, { cache: 'no-store' });
			return res.ok;
		} catch {
			return false;
		}
	}

	async function loadHealth() {
		let setupStatus: { needsSetup?: boolean; setupComplete?: boolean } | null = null;
		try {
			setupStatus = await api.get<{ needsSetup?: boolean; setupComplete?: boolean }>('/setup/status');
		} catch {
			setupStatus = null;
		}

		needsSetup = Boolean(setupStatus?.needsSetup || setupStatus?.setupComplete === false);
		if (needsSetup) {
			await goto('/setup');
			return;
		}
		try {
			registration = await api.get<RegistrationStatus>('/registration/status');
			if (!registration.available) mode = 'login';
		} catch {
			registration = { mode: 'off', available: false, queueMode: false };
			mode = 'login';
		}

		const panelOk = await check('/');
		health = { api: Boolean(setupStatus), panel: panelOk };
		lastChecked = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}

	onMount(() => {
		loadHealth();
		const timer = setInterval(loadHealth, 60_000);
		return () => clearInterval(timer);
	});

	function postLoginPath() {
		const next = page.url.searchParams.get('next') || '/';
		return next.startsWith('/') && !next.startsWith('//') ? next : '/';
	}

	async function submit(e: Event) {
		e.preventDefault();
		if (!username || !password) return;
		error = '';
		submitting = true;
		try {
			const result = await api.post<{ token: string; username: string; role: 'owner' | 'admin' | 'user'; mustChangePin: boolean }>('/login', { username, password });
			if (result.mustChangePin) {
				forcedToken = result.token;
				password = '';
				return;
			}
			auth.set(result.token, { username: result.username, role: result.role });
			await goto(postLoginPath());
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Something went wrong';
		} finally {
			submitting = false;
		}
	}

	async function changeTemporaryPassword(e: Event) {
		e.preventDefault();
		error = '';
		if (newPassword.length < 8 || newPassword.length > 128 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
			error = 'Password must be 8-128 characters and include a letter and number';
			return;
		}
		if (newPassword !== confirmPassword) {
			error = "Passwords don't match";
			return;
		}
		submitting = true;
		try {
			const result = await api.post<{ token: string; username: string; role: 'owner' | 'admin' | 'user' }>(
				'/login/change-password',
				{ token: forcedToken, password: newPassword }
			);
			auth.set(result.token, { username: result.username, role: result.role });
			await goto(postLoginPath());
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Could not change password';
		} finally {
			submitting = false;
		}
	}

	async function submitRegister(e: Event) {
		e.preventDefault();
		error = '';
		registerMessage = '';
		if (!registerUsername.trim()) return void (error = 'Username is required');
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(registerEmail.trim())) return void (error = 'Enter a valid email address');
		if (registerPassword.length < 8 || registerPassword.length > 128 || !/[A-Za-z]/.test(registerPassword) || !/\d/.test(registerPassword)) return void (error = 'Password must be 8-128 characters and include a letter and a number'); else {
			if (registerPin.length < 8 || registerPin.length > 128 || !/[A-Za-z]/.test(registerPin) || !/\d/.test(registerPin)) return void (error = 'Password must be 8-128 characters and include a letter and a number');
		}
		if (registerPassword !== registerConfirmPassword) return void (error = "Passwords don't match");
		submitting = true;
		try {
			const result = await api.post<{ token?: string; username?: string; role?: 'owner' | 'admin' | 'user'; pending?: boolean }>('/register', {
				username: registerUsername.trim(),
				email: registerEmail.trim() || null,
				password: registerPassword
			});
			if (result.pending) {
				registerMessage = 'Registration request sent. An owner or admin must approve it before login.';
				registerPassword = '';
				registerConfirmPassword = '';
				return;
			}
			if (result.token && result.username && result.role) {
				auth.set(result.token, { username: result.username, role: result.role });
				await goto('/');
			}
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Registration failed';
		} finally {
			submitting = false;
		}
	}
</script>

<div class="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-4 py-8">
	<div class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(20,184,166,0.20),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(30,64,175,0.18),transparent_32%),linear-gradient(180deg,rgba(2,6,23,0.10),rgba(0,0,0,0.38))]"></div>
	<div class="pointer-events-none absolute top-0 h-px w-full bg-gradient-to-r from-transparent via-primary/50 to-transparent"></div>

	<section class="relative grid w-full max-w-5xl gap-4 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
		<div class="hidden space-y-4 rounded-3xl border border-border/60 bg-card/35 p-6 shadow-2xl shadow-black/30 backdrop-blur lg:block">
			<div class="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs text-primary">
				<ShieldCheck class="size-3.5" /> OrbitFS secure access
			</div>
			<div class="space-y-2">
				<h1 class="text-4xl font-semibold tracking-tight">Control the workspace layer.</h1>
				<p class="max-w-md text-sm leading-6 text-muted-foreground">Workspaces, files, MCP, storage, and service control stay behind the panel gate.</p>
			</div>
			<div class="grid grid-cols-2 gap-3 pt-2">
				{#each statusItems as item (item.key)}
					<div class="rounded-2xl border border-border/60 bg-background/55 p-4">
						<div class="flex items-center gap-3">
							<div class="flex size-10 items-center justify-center rounded-xl border border-border/70 bg-card/70">
								<item.icon class="size-5" />
							</div>
							<div>
								<p class="text-sm font-medium">{item.label}</p>
								<p class="text-xs text-muted-foreground">{item.detail}</p>
							</div>
							<span class="ml-auto size-2.5 rounded-full {item.online === null ? 'bg-muted' : item.online ? 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]' : 'bg-destructive shadow-[0_0_12px_rgba(239,68,68,0.8)]'}"></span>
						</div>
					</div>
				{/each}
			</div>
		</div>
		<div class="mx-auto w-full max-w-sm space-y-4">
			<div class="rounded-3xl border border-border/70 bg-card/75 p-5 text-center shadow-2xl shadow-black/30 backdrop-blur">
				<div class="mx-auto mb-3 flex size-14 items-center justify-center rounded-2xl border border-primary/30 bg-primary/15 text-primary">
					<HardDrive class="size-7" />
				</div>
				<h1 class="text-xl font-semibold tracking-tight">OrbitFS Panel</h1>
				<p class="text-sm text-muted-foreground">Secure workspace, files, and service control.</p>
				<div class="mt-4 grid grid-cols-2 gap-2 text-left lg:hidden">
					{#each statusItems as item (item.key)}
						<div class="rounded-2xl border border-border/70 bg-background/65 px-3 py-2">
							<div class="flex items-center gap-2">
								<span class="size-2.5 rounded-full {item.online === null ? 'bg-muted' : item.online ? 'bg-emerald-400' : 'bg-destructive'}"></span>
								<span class="text-xs font-medium">{item.label}</span>
							</div>
							<p class="mt-0.5 text-[10px] text-muted-foreground">{item.online === null ? 'checking' : item.online ? 'online' : 'offline'}</p>
						</div>
					{/each}
				</div>
				<p class="mt-3 text-[10px] text-muted-foreground lg:hidden">Live status refreshes every 1 minute. Last check: {lastChecked}</p>
			</div>

			<Card class="border-border/80 bg-card/90 shadow-xl shadow-black/25 backdrop-blur">
				<CardContent class="pt-5">
					{#if forcedToken}
						<form class="space-y-4" onsubmit={changeTemporaryPassword}>
							<div class="space-y-1">
								<p class="text-sm font-medium">Change temporary password</p>
								<p class="text-sm text-muted-foreground">Your temporary credential must be replaced with a password before continuing.</p>
							</div>
							<div class="space-y-1.5">
								<label for="new-password" class="text-sm font-medium">New password</label>
								<Input id="new-password" type="password" inputmode="numeric" autocomplete="new-password" bind:value={newPin} placeholder="New PIN" />
							</div>
							<div class="space-y-1.5">
								<label for="confirm-pin" class="text-sm font-medium">Confirm password</label>
								<Input id="confirm-pin" type="password" inputmode="numeric" autocomplete="new-password" bind:value={confirmPin} placeholder="Confirm PIN" />
							</div>
							{#if error}<p class="text-sm text-destructive">{error}</p>{/if}
							<Button type="submit" class="w-full" disabled={submitting}>
								{#if submitting}<LoaderCircle class="size-4 animate-spin" />{/if}
								Set new password
							</Button>
						</form>
					{:else}
						{#if registration.available}
							<div class="mb-4 grid grid-cols-2 rounded-md border bg-muted/25 p-1 text-sm">
								<button type="button" class="rounded px-3 py-2 {mode === 'login' ? 'bg-background shadow-sm' : 'text-muted-foreground'}" onclick={() => { mode = 'login'; error = ''; }}>Login</button>
								<button type="button" class="rounded px-3 py-2 {mode === 'register' ? 'bg-background shadow-sm' : 'text-muted-foreground'}" onclick={() => { mode = 'register'; error = ''; }}>Create account</button>
							</div>
						{/if}
						{#if mode === 'register'}
							<form class="space-y-4" onsubmit={submitRegister}>
								<div class="space-y-1">
									<p class="flex items-center gap-2 text-sm font-medium"><UserPlus class="size-4" />Create account</p>
									<p class="text-sm text-muted-foreground">{registration.queueMode ? 'Your account will wait for owner/admin approval.' : 'Create a normal user account.'}</p>
								</div>
								<div class="space-y-1.5">
									<label for="register-username" class="text-sm font-medium">Username</label>
									<Input id="register-username" bind:value={registerUsername} autocomplete="username" placeholder="Username" />
								</div>
								<div class="space-y-1.5">
									<label for="register-email" class="text-sm font-medium">Email</label>
									<Input id="register-email" type="email" bind:value={registerEmail} autocomplete="email" placeholder="Email address" />
								</div>
								<label class="space-y-1.5 text-sm">
									<span>Credential type</span></label>
								<div class="space-y-1.5">
									<label for="register-pin" class="text-sm font-medium">Password</label>
									<Input id="register-password" type="password" bind:value={registerPassword} autocomplete="new-password" placeholder="8+ chars, letter and number" />
								</div>
								<div class="space-y-1.5">
									<label for="register-confirm-pin" class="text-sm font-medium">Confirm password</label>
									<Input id="register-confirm-password" type="password" bind:value={registerConfirmPassword} autocomplete="new-password" placeholder="Confirm password" />
								</div>
								{#if error}<p class="text-sm text-destructive">{error}</p>{/if}
								{#if registerMessage}<p class="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{registerMessage}</p>{/if}
								<Button type="submit" class="w-full" disabled={submitting}>
									{#if submitting}<LoaderCircle class="size-4 animate-spin" />{/if}
									{registration.queueMode ? 'Request account' : 'Create account'}
								</Button>
							</form>
						{:else}
						<form class="space-y-4" onsubmit={submit}>
							<div class="space-y-1.5">
								<label for="username" class="text-sm font-medium">Username</label>
								<Input id="username" bind:value={username} autocomplete="username" placeholder="Username" />
							</div>
							<div class="space-y-1.5">
								<label for="pin" class="text-sm font-medium">Password</label>
								<div class="relative">
									<Input id="pin" type={showPassword ? 'text' : 'password'} bind:value={password} autocomplete="current-password" placeholder="Password" class="pr-9" />
									<button type="button" class="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onclick={() => (showPassword = !showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
										{#if showPassword}<EyeOff class="size-4" />{:else}<Eye class="size-4" />{/if}
									</button>
								</div>
							</div>
							{#if error}<p class="text-sm text-destructive">{error}</p>{/if}
							<Button type="submit" class="w-full" disabled={submitting}>
								{#if submitting}<LoaderCircle class="size-4 animate-spin" />{/if}
								Enter
							</Button>
						</form>
						{/if}
					{/if}
				</CardContent>
			</Card>
		</div>
	</section>
</div>
