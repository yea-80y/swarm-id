<script lang="ts">
	import Vertical from '$lib/components/ui/vertical.svelte'
	import Horizontal from '$lib/components/ui/horizontal.svelte'
	import Typography from '$lib/components/ui/typography.svelte'
	import Button from '$lib/components/ui/button.svelte'
	import Modal from '$lib/components/ui/modal.svelte'
	import Input from '$lib/components/ui/input/input.svelte'
	import { Close, View, ViewOff } from 'carbon-icons-svelte'
	import {
		deriveEncryptionKey,
		deriveSecretSeedEncryptionKey,
		deriveMasterKeyEncryptionKeyFromEIP712,
		deriveSecretSeedEncryptionKeyFromEIP712,
		decryptMasterKey,
		decryptSecretSeed,
	} from '$lib/utils/encryption'
	import { connectAndSign, deriveEncryptionSeed } from '$lib/ethereum'
	import type { EthereumAccount } from '@swarm-id/lib'
	import CopyButton from './copy-button.svelte'

	interface Props {
		open: boolean
		drawerOpen: boolean
		account: EthereumAccount
		onClose: () => void
	}

	let { open = $bindable(false), drawerOpen = $bindable(false), account, onClose }: Props = $props()

	let isUnmasked = $state(false)
	let secretSeed = $state('')
	let error = $state<string | undefined>(undefined)
	let isAuthenticating = $state(false)

	async function handleUnmask() {
		if (!account) return

		try {
			open = false
			drawerOpen = false
			isAuthenticating = true
			error = undefined

			if (account.encryptionScheme === 'eip712') {
				// Current scheme: one EIP-712 popup decrypts both masterKey and secretSeed
				const encryptionSeed = await deriveEncryptionSeed()
				const masterKeyKey = await deriveMasterKeyEncryptionKeyFromEIP712(
					encryptionSeed,
					account.encryptionSalt,
				)
				const seedKey = await deriveSecretSeedEncryptionKeyFromEIP712(
					encryptionSeed,
					account.encryptionSalt,
				)
				// masterKey not needed for display — only secretSeed is shown
				await decryptMasterKey(account.encryptedMasterKey, masterKeyKey) // validates the signature decrypts correctly
				secretSeed = await decryptSecretSeed(account.encryptedSecretSeed, seedKey)
			} else {
				// Legacy publickey scheme: SIWE → publicKey → v1 masterKey-based secretSeed decrypt
				const signed = await connectAndSign()
				const masterKeyKey = await deriveEncryptionKey(signed.publicKey, account.encryptionSalt)
				const decryptedMasterKey = await decryptMasterKey(account.encryptedMasterKey, masterKeyKey)
				const seedKey = await deriveSecretSeedEncryptionKey(decryptedMasterKey)
				secretSeed = await decryptSecretSeed(account.encryptedSecretSeed, seedKey)
			}

			isUnmasked = true
		} catch (err) {
			error =
				err instanceof Error
					? err.message
					: 'Authentication failed or secret seed could not be decrypted'
		} finally {
			isAuthenticating = false
			open = true
			drawerOpen = true
		}
	}

	function handleMask() {
		isUnmasked = false
		secretSeed = ''
	}

	function handleClose() {
		isUnmasked = false
		secretSeed = ''
		error = undefined
		onClose()
	}
</script>

<Modal bind:open oncancel={handleClose}>
	<Vertical --vertical-gap="var(--padding)" style="padding: var(--padding)">
		<Horizontal --horizontal-justify-content="space-between">
			<Typography variant="h5">Generation Details</Typography>
			<Button variant="ghost" dimension="compact" onclick={handleClose}><Close size={24} /></Button>
		</Horizontal>

		<Vertical --vertical-gap="var(--padding)">
			<Horizontal --horizontal-gap="var(--half-padding)" --horizontal-align-items="end">
				<Input
					variant="outline"
					dimension="compact"
					value={account.ethereumAddress.toHex()}
					class="grower"
					label="Initial wallet address"
					disabled
				/>
				<div style="border: 1px solid transparent">
					<CopyButton text={account.ethereumAddress.toHex()} />
				</div>
			</Horizontal>
			<Horizontal --horizontal-gap="var(--half-padding)" --horizontal-align-items="end">
				<Input
					variant="outline"
					dimension="compact"
					value={isUnmasked ? secretSeed : '***********************'}
					class="grower"
					label="Secret seed"
					disabled
					type={isUnmasked ? 'text' : 'password'}
				/>
				<div style="border: 1px solid transparent">
					{#if !isUnmasked}
						<Button
							dimension="compact"
							variant="ghost"
							onclick={handleUnmask}
							disabled={isAuthenticating}
							title="Unmask secret seed"
						>
							<View size={20} />
						</Button>
					{:else}
						<Button
							dimension="compact"
							variant="ghost"
							onclick={handleMask}
							title="Mask secret seed"
						>
							<ViewOff size={20} />
						</Button>
					{/if}
				</div>
			</Horizontal>
			<Typography>
				This secret seed is used in combination with your wallet to restore your Swarm ID account. <b
					>Store it in a password manager or write it down on a piece of paper hidden in a secure
					location. Never disclose it to anyone.</b
				>
			</Typography>
		</Vertical>

		{#if error}
			<Typography style="color: var(--colors-red)"
				>There was an error during authentication</Typography
			>
		{/if}

		<Horizontal --horizontal-gap="var(--padding)" --horizontal-justify-content="start">
			<Button dimension="compact" variant="strong" onclick={handleClose}>Close</Button>
		</Horizontal>
	</Vertical>
</Modal>
