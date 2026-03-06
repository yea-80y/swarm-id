<script lang="ts">
	import { goto } from '$app/navigation'
	import { resolve } from '$app/paths'
	import CreationLayout from '$lib/components/creation-layout.svelte'
	import Vertical from '$lib/components/ui/vertical.svelte'
	import Horizontal from '$lib/components/ui/horizontal.svelte'
	import Typography from '$lib/components/ui/typography.svelte'
	import Button from '$lib/components/ui/button.svelte'
	import ErrorMessage from '$lib/components/ui/error-message.svelte'
	import ArrowRight from 'carbon-icons-svelte/lib/ArrowRight.svelte'
	import routes from '$lib/routes'
	import { sessionStore } from '$lib/stores/session.svelte'
	import { accountsStore } from '$lib/stores/accounts.svelte'
	import { mnemonicToMasterKey } from '$lib/utils/passkey-mnemonic'
	import { validateSeedPhrase, countSeedPhraseWords } from '$lib/agent-account'
	import { createEthereumWalletFromSeed, authenticateWithPasskey } from '$lib/passkey'
	import { deriveAccountSwarmEncryptionKey } from '@swarm-id/lib'

	let phrase = $state('')
	let error = $state<string | undefined>(undefined)
	let isProcessing = $state(false)

	const wordCount = $derived(countSeedPhraseWords(phrase))

	const validation = $derived.by(() => {
		if (!phrase.trim()) return undefined
		return validateSeedPhrase(phrase)
	})

	const isValid = $derived(validation?.valid === true && wordCount === 24)

	async function handleRecover() {
		if (!isValid) return

		try {
			isProcessing = true
			error = undefined

			// Derive master key from mnemonic
			const masterKey = mnemonicToMasterKey(phrase)

			// Re-derive the Ethereum address (account ID)
			const wallet = createEthereumWalletFromSeed(masterKey.toUint8Array())

			// Find matching passkey account in store
			let account = accountsStore.accounts.find(
				(a) => a.type === 'passkey' && a.id.equals(wallet.address),
			)

			if (!account) {
				// Account not in localStorage — this device hasn't been set up yet.
				// Authenticate with the synced passkey to get credentialId and verify
				// the PRF output matches the mnemonic-derived master key.
				try {
					const passkeyResult = await authenticateWithPasskey({ rpId: window.location.hostname })

					if (passkeyResult.masterKey.toHex() !== masterKey.toHex()) {
						error =
							'The recovery phrase does not match this passkey. Make sure you entered the correct phrase for this credential.'
						isProcessing = false
						return
					}

					const swarmEncryptionKey = await deriveAccountSwarmEncryptionKey(masterKey.toHex())
					account = accountsStore.addAccount({
						id: wallet.address,
						name: 'Recovered Account',
						createdAt: Date.now(),
						type: 'passkey',
						credentialId: passkeyResult.credentialId,
						swarmEncryptionKey,
					})
				} catch {
					error =
						'Account not found on this device. ' +
						'If your passkey is synced (iCloud / Google Password Manager), approve the passkey prompt. ' +
						'Otherwise use "Restore from Swarm backup" to restore your account to this device.'
					isProcessing = false
					return
				}
			}

			// Restore session — same state as after a successful passkey authentication
			sessionStore.setAccount(account)
			sessionStore.setTemporaryMasterKey(masterKey)
			sessionStore.setCurrentAccount(account.id.toHex())

			// Navigate to home / connect depending on context
			if (sessionStore.data.appOrigin) {
				goto(resolve(routes.CONNECT))
			} else {
				goto(resolve(routes.HOME))
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Recovery failed. Please check your phrase.'
			isProcessing = false
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey && isValid) {
			event.preventDefault()
			handleRecover()
		}
	}
</script>

<CreationLayout
	title="Recover passkey account"
	description="Enter your 24-word recovery phrase"
	onClose={() => goto(resolve(routes.HOME))}
>
	{#snippet content()}
		<Vertical --vertical-gap="var(--padding)">
			<Typography>
				Enter the 24-word recovery phrase you saved when you created your passkey account. This will
				restore your account session without needing your passkey.
			</Typography>

			<Vertical --vertical-gap="var(--quarter-padding)">
				<Horizontal --horizontal-justify-content="space-between">
					<Typography variant="small">Recovery phrase</Typography>
					<Typography variant="small" class="word-count">{wordCount} / 24 words</Typography>
				</Horizontal>
				<!-- svelte-ignore a11y_autofocus -->
				<textarea
					class="phrase-input"
					bind:value={phrase}
					placeholder="Enter your 24 words separated by spaces..."
					rows="4"
					autofocus
					onkeydown={handleKeydown}
					disabled={isProcessing}
				></textarea>
				{#if validation && !validation.valid}
					<ErrorMessage>{validation.error}</ErrorMessage>
				{:else if validation?.valid && wordCount !== 24}
					<ErrorMessage>Passkey recovery requires exactly 24 words.</ErrorMessage>
				{:else if validation?.valid && wordCount === 24}
					<Typography variant="small" style="color: var(--colors-green)">
						Valid recovery phrase
					</Typography>
				{/if}
			</Vertical>

			{#if error}
				<ErrorMessage>{error}</ErrorMessage>
			{/if}
		</Vertical>
	{/snippet}

	{#snippet buttonContent()}
		<Button
			dimension="compact"
			onclick={handleRecover}
			disabled={!isValid || isProcessing}
			class="mobile-full-width"
		>
			{isProcessing ? 'Recovering...' : 'Restore account'}
			<span class="mobile-only"
				>{#if !isProcessing}<ArrowRight size={20} />{/if}</span
			>
		</Button>
	{/snippet}
</CreationLayout>

<style>
	.phrase-input {
		width: 100%;
		padding: var(--half-padding);
		border: 1px solid var(--colors-low);
		border-radius: 4px;
		font-family: var(--typography-font-family-mono);
		font-size: var(--typography-font-size-base);
		resize: vertical;
		min-height: 90px;
		background: transparent;
		color: var(--colors-top);
	}

	.phrase-input:focus {
		outline: var(--focus-outline);
		outline-offset: var(--focus-outline-offset);
		border-color: var(--colors-high);
	}

	.phrase-input:disabled {
		opacity: 0.6;
	}

	:global(.word-count) {
		color: var(--colors-medium);
	}

	.mobile-only {
		display: none;
	}

	@media screen and (max-width: 640px) {
		.mobile-only {
			display: inline-flex;
		}

		:global(.mobile-full-width) {
			width: 100%;
			justify-content: center;
		}
	}
</style>
