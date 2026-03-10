<script lang="ts">
	import { z } from 'zod'
	import { Bee } from '@ethersphere/bee-js'
	import Button from './ui/button.svelte'
	import Modal, { type ModalProps } from './ui/modal.svelte'
	import Typography from './ui/typography.svelte'
	import Vertical from './ui/vertical.svelte'
	import Close from 'carbon-icons-svelte/lib/Close.svelte'
	import Renew from 'carbon-icons-svelte/lib/Renew.svelte'
	import Input from './ui/input/input.svelte'
	import Select from './ui/select/select.svelte'
	import { networkSettingsStore } from '$lib/stores/network-settings.svelte'
	import { nodeBatchStore } from '$lib/stores/node-batch.svelte'
	import { DEFAULT_BEE_NODE_URL, DEFAULT_GNOSIS_RPC_URL } from '@swarm-id/lib'

	const UrlSchema = z.string().url()

	// Sentinel for "no default batch" — empty string is falsy and breaks the Select display
	const NONE = '--none--'

	let { oncancel, open = $bindable(false), ...restProps }: ModalProps = $props()

	type BatchItem = { value: string; label: string }
	type StampsState = 'idle' | 'loading' | 'ready' | 'error'

	let beeNodeUrl = $state('')
	let gnosisRpcUrl = $state('')
	let beeNodeUrlError = $state<string | undefined>(undefined)
	let gnosisRpcUrlError = $state<string | undefined>(undefined)

	let stampsState = $state<StampsState>('idle')
	let stampCount = $state(0)
	let batchItems = $state<BatchItem[]>([
		{ value: NONE, label: 'No default batch — read only mode' },
	])
	let selectedBatchId = $state(NONE)
	let manualBatchId = $state('')
	let useManualInput = $state(false)
	let lastFetchedUrl = $state('')

	const effectiveBatchId = $derived(
		useManualInput ? manualBatchId : selectedBatchId === NONE ? '' : selectedBatchId,
	)
	const isUsingCustomNode = $derived(beeNodeUrl !== DEFAULT_BEE_NODE_URL)
	const isValid = $derived(!beeNodeUrlError && !gnosisRpcUrlError && beeNodeUrl && gnosisRpcUrl)

	function resetForm() {
		beeNodeUrl = networkSettingsStore.beeNodeUrl
		gnosisRpcUrl = networkSettingsStore.gnosisRpcUrl
		beeNodeUrlError = undefined
		gnosisRpcUrlError = undefined
		stampsState = 'idle'
		stampCount = 0
		batchItems = [{ value: NONE, label: 'No default batch — read only mode' }]
		selectedBatchId = NONE
		manualBatchId = nodeBatchStore.batchId
		useManualInput = false
		lastFetchedUrl = ''
		fetchStamps()
	}

	async function fetchStamps() {
		const url = beeNodeUrl
		if (!url || validateBeeNodeUrl(url)) return
		lastFetchedUrl = url
		stampsState = 'loading'
		try {
			const bee = new Bee(url)
			const batches = await bee.getAllPostageBatch()
			const usable = batches.filter((b) => b.usable)
			const stampOptions: BatchItem[] = usable.map((b) => {
				const id = String(b.batchID)
				return { value: id, label: `${id.slice(0, 8)}…${id.slice(-6)}` }
			})
			stampCount = stampOptions.length
			batchItems = [{ value: NONE, label: 'No default batch — read only mode' }, ...stampOptions]
			const saved = nodeBatchStore.batchId
			const match = stampOptions.find((b) => b.value === saved)
			selectedBatchId = match ? saved : NONE
			useManualInput = false
			stampsState = 'ready'
		} catch {
			stampCount = 0
			useManualInput = true
			stampsState = 'error'
		}
	}

	function validateBeeNodeUrl(value: string): string | undefined {
		const result = UrlSchema.safeParse(value)
		if (!result.success) return 'Please enter a valid URL'
		return undefined
	}

	function validateGnosisRpcUrl(value: string): string | undefined {
		const result = UrlSchema.safeParse(value)
		if (!result.success) return 'Please enter a valid URL'
		return undefined
	}

	function handleBeeNodeUrlInput() {
		beeNodeUrlError = validateBeeNodeUrl(beeNodeUrl)
	}

	function handleBeeNodeUrlBlur() {
		beeNodeUrlError = validateBeeNodeUrl(beeNodeUrl)
		if (!beeNodeUrlError && beeNodeUrl !== lastFetchedUrl) {
			fetchStamps()
		}
	}

	function handleGnosisRpcUrlInput() {
		gnosisRpcUrlError = validateGnosisRpcUrl(gnosisRpcUrl)
	}

	function handleSave() {
		beeNodeUrlError = validateBeeNodeUrl(beeNodeUrl)
		gnosisRpcUrlError = validateGnosisRpcUrl(gnosisRpcUrl)
		if (beeNodeUrlError || gnosisRpcUrlError) return

		networkSettingsStore.updateSettings({ beeNodeUrl, gnosisRpcUrl })
		nodeBatchStore.set(effectiveBatchId)
		open = false
	}

	function handleReset() {
		beeNodeUrl = DEFAULT_BEE_NODE_URL
		gnosisRpcUrl = DEFAULT_GNOSIS_RPC_URL
		beeNodeUrlError = undefined
		gnosisRpcUrlError = undefined
		stampsState = 'idle'
		stampCount = 0
		batchItems = [{ value: NONE, label: 'No default batch — read only mode' }]
		selectedBatchId = NONE
		manualBatchId = ''
		useManualInput = false
		lastFetchedUrl = ''
	}

	function handleCancel() {
		open = false
		oncancel?.()
	}
</script>

<Modal oncancel={handleCancel} bind:open onshow={resetForm} {...restProps}>
	<section class="dialog">
		<header class="horizontal">
			<Typography variant="h5">Network settings</Typography>
			<div class="grower"></div>
			<Button variant="ghost" dimension="compact" onclick={handleCancel}><Close size={24} /></Button
			>
		</header>

		<Vertical --vertical-gap="var(--padding)">
			<Input
				variant="outline"
				dimension="compact"
				name="bee-node-url"
				bind:value={beeNodeUrl}
				label="Bee node URL"
				placeholder={DEFAULT_BEE_NODE_URL}
				error={beeNodeUrlError}
				oninput={handleBeeNodeUrlInput}
				onblur={handleBeeNodeUrlBlur}
			/>
			<Input
				variant="outline"
				dimension="compact"
				name="gnosis-rpc-url"
				bind:value={gnosisRpcUrl}
				label="Gnosis RPC endpoint"
				placeholder={DEFAULT_GNOSIS_RPC_URL}
				error={gnosisRpcUrlError}
				oninput={handleGnosisRpcUrlInput}
			/>

			<div class="batch-section">
				<div class="batch-header">
					<Typography variant="small" class="batch-label">Default postage batch</Typography>
					<div class="batch-header-right">
						{#if stampsState === 'ready'}
							<Typography variant="small" class="stamp-count">
								{stampCount === 0
									? 'No usable stamps on this node'
									: `${stampCount} stamp${stampCount === 1 ? '' : 's'} available`}
							</Typography>
						{/if}
						<Button
							variant="ghost"
							dimension="small"
							onclick={fetchStamps}
							disabled={stampsState === 'loading'}
							title="Refresh stamps from Bee node"
						>
							<Renew size={16} />
						</Button>
					</div>
				</div>

				{#if stampsState === 'loading'}
					<Typography variant="small" class="batch-status">Checking for stamps…</Typography>
				{:else if !useManualInput}
					<Select
						variant="outline"
						dimension="compact"
						label=""
						bind:value={selectedBatchId}
						items={batchItems}
					/>
					<button class="toggle-link" onclick={() => (useManualInput = true)}>
						Enter batch ID manually
					</button>
				{:else}
					<Input
						variant="outline"
						dimension="compact"
						name="manual-batch-id"
						bind:value={manualBatchId}
						label=""
						placeholder="64-character hex batch ID"
					/>
					{#if batchItems.length > 1}
						<button class="toggle-link" onclick={() => (useManualInput = false)}>
							Choose from available stamps
						</button>
					{/if}
					{#if stampsState === 'error'}
						<Typography variant="small" class="batch-status">
							Could not reach Bee node — enter a batch ID manually or leave blank.
						</Typography>
					{/if}
				{/if}

				{#if isUsingCustomNode && !effectiveBatchId}
					<Typography variant="small" class="batch-hint">
						Without a default batch your node is read-only — you can browse existing content but
						backups and feed updates will prompt for a batch at that time.
					</Typography>
				{:else if !isUsingCustomNode}
					<Typography variant="small" class="batch-hint">
						Optional. Only needed if you switch to your own Bee node.
					</Typography>
				{/if}
			</div>
		</Vertical>

		<section class="buttons">
			<Button variant="strong" dimension="compact" onclick={handleSave} disabled={!isValid}
				>Save settings</Button
			>
			<Button variant="ghost" dimension="compact" onclick={handleCancel}>Cancel</Button>
			<div class="grower"></div>
			<Button variant="ghost" dimension="compact" onclick={handleReset}>Reset to defaults</Button>
		</section>
	</section>
</Modal>

<style lang="postcss">
	.dialog {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: var(--one-and-half-padding);
		background-color: var(--colors-ultra-low);
		padding: var(--one-and-half-padding);
		height: 100%;
	}
	.horizontal {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: var(--half-padding);
	}
	.buttons {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: var(--half-padding);
	}
	@media screen and (max-width: 624px) {
		.buttons {
			flex-direction: column-reverse;
			align-items: stretch;
		}
	}
	.grower {
		flex-grow: 1;
	}
	.batch-section {
		display: flex;
		flex-direction: column;
		gap: var(--half-padding);
	}
	.batch-header {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: space-between;
	}
	.batch-header-right {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: var(--half-padding);
	}
	:global(.batch-label) {
		color: var(--colors-high);
		font-weight: 500;
	}
	:global(.stamp-count) {
		color: var(--colors-high);
		opacity: 0.7;
	}
	:global(.batch-status) {
		color: var(--colors-high);
		opacity: 0.7;
	}
	:global(.batch-hint) {
		color: var(--colors-high);
		opacity: 0.7;
		line-height: 1.4;
	}
	.toggle-link {
		background: none;
		border: none;
		padding: 0;
		color: var(--colors-high);
		font-size: var(--font-size-small);
		font-family: var(--font-family-sans-serif);
		cursor: pointer;
		text-align: left;
		text-decoration: underline;
		opacity: 0.8;

		&:hover {
			opacity: 1;
		}
	}
</style>
