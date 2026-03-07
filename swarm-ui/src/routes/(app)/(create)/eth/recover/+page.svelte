<script lang="ts">
	import { goto } from '$app/navigation'
	import { resolve } from '$app/paths'
	import { EthAddress } from '@ethersphere/bee-js'
	import CreationLayout from '$lib/components/creation-layout.svelte'
	import Vertical from '$lib/components/ui/vertical.svelte'
	import Typography from '$lib/components/ui/typography.svelte'
	import Button from '$lib/components/ui/button.svelte'
	import Input from '$lib/components/ui/input/input.svelte'
	import ErrorMessage from '$lib/components/ui/error-message.svelte'
	import ArrowRight from 'carbon-icons-svelte/lib/ArrowRight.svelte'
	import routes from '$lib/routes'
	import { sessionStore } from '$lib/stores/session.svelte'
	import { accountsStore } from '$lib/stores/accounts.svelte'
	import { connectAndSign, deriveMasterKey, deriveEncryptionSeed } from '$lib/ethereum'
	import { validateSecretSeed } from '$lib/utils/secret-seed'
	import {
		generateEncryptionSalt,
		deriveMasterKeyEncryptionKeyFromEIP712,
		encryptMasterKey,
		deriveSecretSeedEncryptionKeyFromEIP712,
		encryptSecretSeed,
	} from '$lib/utils/encryption'
	import { deriveAccountSwarmEncryptionKey } from '@swarm-id/lib'

	let secretSeed = $state('')
	let error = $state<string | undefined>(undefined)
	let isProcessing = $state(false)

	const seedError = $derived.by(() => {
		if (!secretSeed) return undefined
		if (!validateSecretSeed(secretSeed)) {
			return 'Must be 20–128 characters with uppercase, lowercase, numbers, and special characters'
		}
		return undefined
	})

	const canRecover = $derived(!!secretSeed && !seedError)

	async function handleRecover() {
		if (!canRecover) return

		try {
			isProcessing = true
			error = undefined

			// Connect wallet and sign SIWE — re-derives the same publicKey as account creation
			const signed = await connectAndSign()
			const { masterKey, masterAddress } = deriveMasterKey(secretSeed, signed.publicKey)

			// Check if this account already exists in localStorage (same device)
			let account = accountsStore.accounts.find((a) => a.id.equals(masterAddress))

			if (!account) {
				// New device — reconstruct the full account record with EIP-712 encryption
				const encryptionSeed = await deriveEncryptionSeed()
				const encryptionSalt = generateEncryptionSalt()

				const masterKeyEncKey = await deriveMasterKeyEncryptionKeyFromEIP712(
					encryptionSeed,
					encryptionSalt,
				)
				const encryptedMasterKey = await encryptMasterKey(masterKey, masterKeyEncKey)

				const secretSeedEncKey = await deriveSecretSeedEncryptionKeyFromEIP712(
					encryptionSeed,
					encryptionSalt,
				)
				const encryptedSecretSeed = await encryptSecretSeed(secretSeed, secretSeedEncKey)

				const swarmEncryptionKey = await deriveAccountSwarmEncryptionKey(masterKey.toHex())

				account = accountsStore.addAccount({
					id: masterAddress,
					name: 'Recovered Account',
					createdAt: Date.now(),
					type: 'ethereum',
					ethereumAddress: new EthAddress(signed.address),
					encryptedMasterKey,
					encryptionSalt,
					encryptedSecretSeed,
					swarmEncryptionKey,
					encryptionScheme: 'eip712',
				})
			}

			sessionStore.setAccount(account)
			sessionStore.setCurrentAccount(account.id.toHex())
			sessionStore.setTemporaryMasterKey(masterKey)

			if (sessionStore.data.appOrigin) {
				goto(resolve(routes.CONNECT))
			} else {
				goto(resolve(routes.HOME))
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Recovery failed. Please try again.'
			isProcessing = false
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && canRecover && !isProcessing) {
			event.preventDefault()
			handleRecover()
		}
	}
</script>

<CreationLayout
	title="Recover Ethereum account"
	description="Re-derive your account using your wallet and secret seed"
	onClose={() =>
		sessionStore.data.appOrigin ? goto(resolve(routes.CONNECT)) : goto(resolve(routes.HOME))}
>
	{#snippet content()}
		<Vertical --vertical-gap="var(--padding)">
			<Typography>
				Enter the secret seed you chose when you created your account. Your wallet will sign a
				message to re-derive your account — no Swarm backup required.
			</Typography>

			<Vertical --vertical-gap="var(--quarter-padding)">
				<Input
					label="Secret seed"
					variant="outline"
					dimension="compact"
					type="password"
					placeholder="Your account secret seed"
					bind:value={secretSeed}
					disabled={isProcessing}
					onkeydown={handleKeydown}
				/>
				{#if seedError}
					<ErrorMessage>{seedError}</ErrorMessage>
				{/if}
			</Vertical>

			<Typography variant="small" style="color: var(--colors-medium)">
				Your wallet will prompt for a signature. No transaction is broadcast — it is used only to
				re-derive your account key.
			</Typography>

			{#if error}
				<ErrorMessage>{error}</ErrorMessage>
			{/if}
		</Vertical>
	{/snippet}

	{#snippet buttonContent()}
		<Button
			dimension="compact"
			onclick={handleRecover}
			disabled={!canRecover || isProcessing}
			class="mobile-full-width"
		>
			{isProcessing ? 'Connecting wallet…' : 'Recover with wallet'}
			<span class="mobile-only"
				>{#if !isProcessing}<ArrowRight size={20} />{/if}</span
			>
		</Button>
	{/snippet}
</CreationLayout>

<style>
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
