<script lang="ts">
	import { ShieldAlert, LogOut } from '@lucide/svelte';

	async function logout() {
		try {
			await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
		} finally {
			window.location.assign('/login');
		}
	}
</script>

<svelte:head>
	<title>Access suspended · OrbitFS</title>
</svelte:head>

<div class="flex min-h-dvh items-center justify-center bg-background px-4 py-10 text-foreground">
	<section class="w-full max-w-lg rounded-3xl border bg-card p-6 shadow-xl sm:p-8">
		<div class="flex size-12 items-center justify-center rounded-2xl border border-destructive/30 bg-destructive/10 text-destructive">
			<ShieldAlert class="size-6" />
		</div>
		<h1 class="mt-5 text-2xl font-semibold tracking-tight">OrbitFS access suspended</h1>
		<p class="mt-3 text-sm leading-6 text-muted-foreground">
			This OrbitFS installation does not currently have a valid active licence. Access to the panel is suspended until an owner or administrator restores the licence.
		</p>
		<div class="mt-5 rounded-xl border bg-muted/30 p-4 text-sm">
			<p class="font-medium">What you can do</p>
			<p class="mt-1 text-muted-foreground">Contact your OrbitFS owner or administrator. Your account and stored data have not been removed.</p>
		</div>
		<button
			type="button"
			class="mt-6 inline-flex h-10 items-center gap-2 rounded-md border px-4 text-sm font-medium hover:bg-muted"
			onclick={logout}
		>
			<LogOut class="size-4" />
			Sign out
		</button>
	</section>
</div>
