<script lang="ts">
	import NetworkStatusPill from '$lib/components/network-status-pill.svelte'
	import NetworkSettingsModal from '$lib/components/network-settings-modal.svelte'

	let { children } = $props()

	let networkSettingsOpen = $state(false)
</script>

<div class="page-wrapper">
	<div class="network-trigger">
		<NetworkStatusPill onclick={() => (networkSettingsOpen = true)} />
	</div>

	<div class="page-content">
		<div class="content-area">
			{@render children()}
		</div>
	</div>
</div>

<NetworkSettingsModal bind:open={networkSettingsOpen} />

<style>
	.page-wrapper {
		display: flex;
		flex-direction: row;
		min-height: 100vh;
		background: var(--colors-ultra-low);
		position: relative;
		align-items: stretch;
		justify-content: space-around;
	}

	.network-trigger {
		position: fixed;
		top: var(--padding);
		right: var(--padding);
		z-index: 10;
	}

	.page-content {
		flex: 1;
		display: flex;
		justify-content: center;
		flex-direction: column;
		align-items: center;
		padding: var(--double-padding);
	}

	.content-area {
		max-width: 560px;
		display: flex;
		flex-direction: column;
		justify-content: center;
		width: 100%;
	}

	@media screen and (max-width: 640px) {
		.page-content {
			padding: var(--padding);
		}

		.content-area {
			flex: 1;
		}
	}
</style>
