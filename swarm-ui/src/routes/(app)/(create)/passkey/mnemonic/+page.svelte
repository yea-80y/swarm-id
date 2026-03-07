<script lang="ts">
	import { goto } from '$app/navigation'
	import { resolve } from '$app/paths'
	import { onMount } from 'svelte'
	import CreationLayout from '$lib/components/creation-layout.svelte'
	import Vertical from '$lib/components/ui/vertical.svelte'
	import Horizontal from '$lib/components/ui/horizontal.svelte'
	import Typography from '$lib/components/ui/typography.svelte'
	import Button from '$lib/components/ui/button.svelte'
	import Checkbox from '$lib/components/ui/checkbox.svelte'
	import ErrorMessage from '$lib/components/ui/error-message.svelte'
	import CopyButton from '$lib/components/copy-button.svelte'
	import ArrowRight from 'carbon-icons-svelte/lib/ArrowRight.svelte'
	import Checkmark from 'carbon-icons-svelte/lib/Checkmark.svelte'
	import routes from '$lib/routes'
	import { sessionStore } from '$lib/stores/session.svelte'
	import { masterKeyToMnemonic, storeMnemonicBackup } from '$lib/utils/passkey-mnemonic'

	let mnemonic = $state<string | undefined>(undefined)
	// mnemonicStr is only referenced inside {#if mnemonic} blocks but TS can't narrow snippets
	let mnemonicStr = $derived(mnemonic ?? '')
	let words = $derived(mnemonic ? mnemonic.split(' ') : [])
	let confirmed = $state(false)
	let isStoring = $state(false)
	let error = $state<string | undefined>(undefined)

	onMount(() => {
		const masterKey = sessionStore.data.temporaryMasterKey
		if (!masterKey) {
			goto(resolve(routes.HOME))
			return
		}
		mnemonic = masterKeyToMnemonic(masterKey)
	})

	function handleSkip() {
		if (!confirmed) return
		goto(resolve(routes.IDENTITY_NEW))
	}

	async function handleConfirm() {
		const masterKey = sessionStore.data.temporaryMasterKey
		const account = sessionStore.data.account

		if (!masterKey || !account) {
			error = 'Session expired. Please start over.'
			return
		}

		if (!mnemonic) {
			error = 'Recovery phrase not available.'
			return
		}

		// credentialId is on passkey accounts only
		const credentialId = account.type === 'passkey' ? account.credentialId : undefined
		if (!credentialId) {
			error = 'Account type does not support mnemonic backup.'
			return
		}

		try {
			isStoring = true
			error = undefined
			await storeMnemonicBackup(credentialId, masterKey)
			goto(resolve(routes.IDENTITY_NEW))
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to store backup. Please try again.'
			isStoring = false
		}
	}
</script>

{#if mnemonic}
	<CreationLayout
		title="Save your recovery phrase"
		description="Your only safety net if you ever lose all your passkeys"
		onClose={() => goto(resolve(routes.HOME))}
	>
		{#snippet content()}
			<Vertical --vertical-gap="var(--padding)">
				<Typography>
					This phrase is the <strong>only way to recover your account</strong> if you permanently
					lose your passkey — all devices lost, cloud account deleted, or hardware key destroyed.
					Without it, that scenario means permanent, unrecoverable loss of your Swarm identity.
					<br /><br />
					It also lets you hold your keys independently: with this phrase you can re-derive everything
					using any standard BIP-39 tool, without relying on Google, Apple, or a hardware key. For day-to-day
					use on a new device your passkey syncs automatically and this phrase is not needed.
					<strong>Never share these words with anyone.</strong>
				</Typography>

				<!-- 24-word grid -->
				<div class="mnemonic-grid">
					{#each words as word, i (i)}
						<div class="word-cell">
							<span class="word-index">{i + 1}</span>
							<span class="word-text">{word}</span>
						</div>
					{/each}
				</div>

				<!-- Copy all button -->
				<Horizontal --horizontal-justify-content="flex-end">
					<CopyButton text={mnemonicStr} />
				</Horizontal>

				<div class="warning-box">
					<Typography variant="small">
						<strong>Never enter your recovery phrase on any website or app.</strong>
						Anyone with these words can access your account.
					</Typography>
				</div>

				<!-- Confirmation checkbox -->
				<Checkbox bind:checked={confirmed} dimension="compact">
					<Typography variant="small"
						>I understand: without this phrase, losing all my passkeys means my account cannot be
						recovered.</Typography
					>
				</Checkbox>

				{#if error}
					<ErrorMessage>{error}</ErrorMessage>
				{/if}
			</Vertical>
		{/snippet}

		{#snippet buttonContent()}
			<Vertical --vertical-gap="var(--half-padding)">
				<Button
					dimension="compact"
					onclick={handleConfirm}
					disabled={!confirmed || isStoring}
					class="mobile-full-width"
				>
					<span class="desktop-only"><Checkmark size={20} /></span>
					{isStoring ? 'Saving...' : "I've saved it — continue"}
					<span class="mobile-only"
						>{#if !isStoring}<ArrowRight size={20} />{/if}</span
					>
				</Button>
				<Button
					dimension="compact"
					variant="ghost"
					onclick={handleSkip}
					disabled={isStoring}
					class="mobile-full-width"
				>
					Skip without saving (not recommended)
				</Button>
			</Vertical>
		{/snippet}
	</CreationLayout>
{/if}

<style>
	.mnemonic-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: var(--half-padding);
	}

	@media (max-width: 480px) {
		.mnemonic-grid {
			grid-template-columns: repeat(3, 1fr);
		}
	}

	.word-cell {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: var(--quarter-padding) var(--half-padding);
		border: 1px solid var(--colors-ultra-low);
		border-radius: 4px;
		background: var(--colors-background-low);
	}

	.word-index {
		font-size: 0.7rem;
		color: var(--colors-medium);
		min-width: 1.4rem;
		text-align: right;
		user-select: none;
	}

	.word-text {
		font-family: var(--typography-font-family-mono);
		font-size: 0.85rem;
		color: var(--colors-top);
		user-select: all;
	}

	.warning-box {
		padding: var(--half-padding);
		border: 1px solid var(--colors-warning, #f59e0b);
		border-radius: 4px;
		background: color-mix(in srgb, var(--colors-warning, #f59e0b) 8%, transparent);
	}

	.desktop-only {
		display: inline-flex;
	}

	.mobile-only {
		display: none;
	}

	@media screen and (max-width: 640px) {
		.desktop-only {
			display: none;
		}

		.mobile-only {
			display: inline-flex;
		}

		:global(.mobile-full-width) {
			width: 100%;
			justify-content: center;
		}
	}
</style>
