<script lang="ts">
	import Settings from 'carbon-icons-svelte/lib/Settings.svelte'
	import { networkSettingsStore } from '$lib/stores/network-settings.svelte'
	import { nodeBatchStore } from '$lib/stores/node-batch.svelte'
	import { DEFAULT_BEE_NODE_URL } from '@swarm-id/lib'

	interface Props {
		onclick: () => void
	}

	let { onclick }: Props = $props()

	const hasCustomSettings = $derived(networkSettingsStore.beeNodeUrl !== DEFAULT_BEE_NODE_URL)
	const hasBatch = $derived(nodeBatchStore.batchId !== '')
	const isReadOnly = $derived(hasCustomSettings && !hasBatch)
	const isReadWrite = $derived(hasCustomSettings && hasBatch)

	const nodeLabel = $derived(
		hasCustomSettings ? getBeeNodeLabel(networkSettingsStore.beeNodeUrl) : 'Public gateway',
	)

	function getBeeNodeLabel(url: string): string {
		try {
			return new URL(url).host
		} catch {
			return url
		}
	}
</script>

<button
	class="network-pill"
	class:custom={hasCustomSettings}
	{onclick}
	aria-label="Network settings: {nodeLabel}{isReadOnly
		? ', read only'
		: isReadWrite
			? ', read/write'
			: ''}"
	title="Network settings"
>
	<span class="pill-dot" class:custom={hasCustomSettings}></span>
	<span class="pill-label">
		<span class="pill-node">{nodeLabel}</span>
		{#if isReadOnly}
			<span class="pill-mode readonly">· read only</span>
		{:else if isReadWrite}
			<span class="pill-mode readwrite">· read/write</span>
		{/if}
	</span>
	<span class="pill-icon"><Settings size={16} /></span>
</button>

<style>
	.network-pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 5px 10px 5px 8px;
		border: 1px solid var(--colors-low);
		border-radius: var(--border-radius);
		background: var(--colors-ultra-low);
		color: var(--colors-high);
		font-size: var(--font-size-small);
		line-height: var(--line-height-small);
		letter-spacing: var(--letter-spacing-small);
		font-family: var(--font-family-sans-serif);
		cursor: pointer;
		transition:
			border-color 0.15s ease,
			color 0.15s ease;
		white-space: nowrap;
		max-width: 260px;
	}

	.network-pill:hover {
		border-color: var(--colors-high);
		color: var(--colors-ultra-high);
	}

	.network-pill:focus-visible {
		outline: var(--focus-outline);
		outline-offset: var(--focus-outline-offset);
	}

	.pill-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--colors-low);
		flex-shrink: 0;
		transition: background 0.15s ease;
	}

	.pill-dot.custom {
		background: #22c55e;
		box-shadow: 0 0 0 2px color-mix(in srgb, #22c55e 20%, transparent);
	}

	.pill-label {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
	}

	.pill-node {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}

	.pill-mode {
		flex-shrink: 0;
		opacity: 0.7;
	}

	.pill-mode.readwrite {
		color: #22c55e;
		opacity: 1;
	}

	.pill-icon {
		display: flex;
		align-items: center;
		flex-shrink: 0;
		opacity: 0.5;
		transition: opacity 0.15s ease;
	}

	.network-pill:hover .pill-icon {
		opacity: 1;
	}
</style>
