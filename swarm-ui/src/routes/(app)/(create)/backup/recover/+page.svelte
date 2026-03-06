<script lang="ts">
	import { goto } from '$app/navigation'
	import { resolve } from '$app/paths'
	import { Bee, EthAddress, Bytes } from '@ethersphere/bee-js'
	import { BaseWallet, SigningKey } from 'ethers'
	import CreationLayout from '$lib/components/creation-layout.svelte'
	import Vertical from '$lib/components/ui/vertical.svelte'
	import Horizontal from '$lib/components/ui/horizontal.svelte'
	import Typography from '$lib/components/ui/typography.svelte'
	import Button from '$lib/components/ui/button.svelte'
	import Input from '$lib/components/ui/input/input.svelte'
	import Select from '$lib/components/ui/select/select.svelte'
	import ErrorMessage from '$lib/components/ui/error-message.svelte'
	import Divider from '$lib/components/ui/divider.svelte'
	import ArrowRight from 'carbon-icons-svelte/lib/ArrowRight.svelte'
	import Checkmark from 'carbon-icons-svelte/lib/Checkmark.svelte'
	import routes from '$lib/routes'
	import { sessionStore } from '$lib/stores/session.svelte'
	import { accountsStore } from '$lib/stores/accounts.svelte'
	import { identitiesStore } from '$lib/stores/identities.svelte'
	import { connectedAppsStore } from '$lib/stores/connected-apps.svelte'
	import { networkSettingsStore } from '$lib/stores/network-settings.svelte'
	import { deriveBackupKeypair } from '$lib/utils/backup-encryption'
	import { readAccountBackup } from '$lib/utils/account-backup'
	import type { BackupPayload } from '$lib/utils/account-backup'
	import { deriveEncryptionSeed, connectAndSign } from '$lib/ethereum'
	import { authenticateWithPasskey } from '$lib/passkey'
	import {
		deriveFromSeedPhrase,
		validateSeedPhrase,
		countSeedPhraseWords,
	} from '$lib/agent-account'
	import {
		generateEncryptionSalt,
		deriveEncryptionKey,
		encryptMasterKey,
		deriveSecretSeedEncryptionKey,
		encryptSecretSeed,
	} from '$lib/utils/encryption'
	import { deriveAccountSwarmEncryptionKey } from '@swarm-id/lib'

	type AccountTypeOption = 'ethereum' | 'passkey' | 'agent'
	type Phase = 'idle' | 'decrypting' | 'preview' | 'restoring' | 'done'

	const accountTypeItems = [
		{ value: 'ethereum', label: 'Ethereum wallet' },
		{ value: 'passkey', label: 'Passkey' },
		{ value: 'agent', label: 'Agent (seed phrase)' },
	]

	let phase = $state<Phase>('idle')
	let hash = $state('')
	let accountType = $state<AccountTypeOption>('ethereum')
	let seedPhrase = $state('')
	let error = $state<string | undefined>(undefined)

	// Held in memory between decrypt step and restore step
	let payload = $state<BackupPayload | undefined>(undefined)
	let recoveredMasterKey = $state<Bytes | undefined>(undefined) // passkey + agent (not ethereum)
	let recoveredCredentialId = $state<string | undefined>(undefined) // passkey only
	let recoveredAddress = $state<EthAddress | undefined>(undefined)

	const hashValid = $derived(/^[0-9a-fA-F]{64}$/.test(hash.trim()))
	const wordCount = $derived(countSeedPhraseWords(seedPhrase))

	const seedPhraseValid = $derived.by(() => {
		if (accountType !== 'agent') return true
		if (!seedPhrase.trim()) return false
		return validateSeedPhrase(seedPhrase).valid && wordCount >= 12
	})

	const canDecrypt = $derived(
		hashValid && (accountType !== 'agent' || seedPhraseValid) && phase === 'idle',
	)

	const existingAccount = $derived.by(() => {
		if (!recoveredAddress) return undefined
		return accountsStore.accounts.find((a) => a.id.equals(recoveredAddress!))
	})

	const newIdentityCount = $derived.by(() => {
		if (!payload) return 0
		const existingIds = new Set(identitiesStore.identities.map((i) => i.id))
		return payload.identities.filter((i) => !existingIds.has(i.id)).length
	})

	const newAppCount = $derived.by(() => {
		if (!payload) return 0
		const existingKeys = new Set(connectedAppsStore.apps.map((a) => `${a.appUrl}|${a.identityId}`))
		return payload.connectedApps.filter((a) => !existingKeys.has(`${a.appUrl}|${a.identityId}`))
			.length
	})

	async function handleDecrypt() {
		if (!canDecrypt) return

		try {
			phase = 'decrypting'
			error = undefined
			payload = undefined
			recoveredMasterKey = undefined
			recoveredCredentialId = undefined
			recoveredAddress = undefined

			const bee = new Bee(networkSettingsStore.beeNodeUrl)
			const trimmedHash = hash.trim()

			let keypair: ReturnType<typeof deriveBackupKeypair>

			if (accountType === 'ethereum') {
				const entropy = await deriveEncryptionSeed()
				keypair = deriveBackupKeypair(entropy)
				// masterAddress derived from payload after decryption
			} else if (accountType === 'passkey') {
				const result = await authenticateWithPasskey({ rpId: window.location.hostname })
				recoveredMasterKey = result.masterKey
				recoveredCredentialId = result.credentialId
				recoveredAddress = result.ethereumAddress
				keypair = deriveBackupKeypair(result.masterKey.toUint8Array())
			} else {
				// agent
				const result = deriveFromSeedPhrase(seedPhrase)
				recoveredMasterKey = result.masterKey
				recoveredAddress = result.ethereumAddress
				keypair = deriveBackupKeypair(result.masterKey.toUint8Array())
			}

			const result = await readAccountBackup(bee, trimmedHash, keypair)

			if (!result) {
				error = 'Could not decrypt this backup. Check that the hash and account type are correct.'
				phase = 'idle'
				return
			}

			payload = result

			// Derive account address for ethereum from masterKeyHex in payload
			if (accountType === 'ethereum') {
				if (!result.masterKeyHex) {
					error =
						'Backup does not contain a master key. This backup may belong to a passkey account.'
					phase = 'idle'
					return
				}
				const wallet = new BaseWallet(new SigningKey('0x' + result.masterKeyHex))
				recoveredAddress = new EthAddress(wallet.address)
			}

			phase = 'preview'
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to decrypt backup'
			phase = 'idle'
		}
	}

	async function handleRestore() {
		if (!payload || !recoveredAddress) return

		try {
			phase = 'restoring'
			error = undefined

			// 1. Get or create account
			let account = accountsStore.accounts.find((a) => a.id.equals(recoveredAddress!))

			if (!account) {
				if (accountType === 'passkey') {
					if (!recoveredMasterKey || !recoveredCredentialId) {
						throw new Error('Missing passkey credentials — try decrypting again')
					}
					const swarmEncryptionKey = await deriveAccountSwarmEncryptionKey(
						recoveredMasterKey.toHex(),
					)
					account = accountsStore.addAccount({
						id: recoveredAddress,
						name: 'Recovered Account',
						createdAt: Date.now(),
						type: 'passkey',
						credentialId: recoveredCredentialId,
						swarmEncryptionKey,
					})
				} else if (accountType === 'agent') {
					if (!recoveredMasterKey) {
						throw new Error('Missing master key — try decrypting again')
					}
					const swarmEncryptionKey = await deriveAccountSwarmEncryptionKey(
						recoveredMasterKey.toHex(),
					)
					account = accountsStore.addAccount({
						id: recoveredAddress,
						name: 'Recovered Account',
						createdAt: Date.now(),
						type: 'agent',
						swarmEncryptionKey,
					})
				} else {
					// ethereum: sign SIWE to re-encrypt masterKey into a proper account
					if (!payload.masterKeyHex) {
						throw new Error('No master key in backup')
					}
					const masterKey = new Bytes(payload.masterKeyHex)
					const signed = await connectAndSign()
					const encryptionSalt = generateEncryptionSalt()
					const encryptionKey = await deriveEncryptionKey(signed.publicKey, encryptionSalt)
					const encryptedMasterKey = await encryptMasterKey(masterKey, encryptionKey)
					// secretSeed not in backup — encrypt empty placeholder (does not affect key recovery)
					const secretSeedEncKey = await deriveSecretSeedEncryptionKey(masterKey)
					const encryptedSecretSeed = await encryptSecretSeed('', secretSeedEncKey)
					const swarmEncryptionKey = await deriveAccountSwarmEncryptionKey(masterKey.toHex())
					account = accountsStore.addAccount({
						id: recoveredAddress,
						name: 'Recovered Account',
						createdAt: Date.now(),
						type: 'ethereum',
						ethereumAddress: new EthAddress(signed.address),
						encryptedMasterKey,
						encryptionSalt,
						encryptedSecretSeed,
						swarmEncryptionKey,
					})
				}
			}

			// 2. Restore identities — skip any already in store (matched by ID)
			const existingIdentityIds = new Set(identitiesStore.identities.map((i) => i.id))
			for (const identity of payload.identities) {
				if (!existingIdentityIds.has(identity.id)) {
					identitiesStore.addIdentity({
						id: identity.id,
						accountId: recoveredAddress,
						name: identity.name,
						feedSignerAddress: identity.feedSignerAddress,
					})
				}
			}

			// 3. Restore connected apps — skip existing (matched by appUrl + identityId)
			const existingAppKeys = new Set(
				connectedAppsStore.apps.map((a) => `${a.appUrl}|${a.identityId}`),
			)
			for (const app of payload.connectedApps) {
				const key = `${app.appUrl}|${app.identityId}`
				if (!existingAppKeys.has(key)) {
					// Preserve original connectedUntil if still in the future, else 0
					const remainingMs = Math.max(0, app.connectedUntil - Date.now())
					connectedAppsStore.addOrUpdateApp(
						{
							appUrl: app.appUrl,
							appName: app.appName,
							identityId: app.identityId,
							appSecret: app.appSecret,
						},
						remainingMs,
					)
				}
			}

			// 4. Set session
			sessionStore.setAccount(account)
			sessionStore.setCurrentAccount(account.id.toHex())
			if (recoveredMasterKey) {
				sessionStore.setTemporaryMasterKey(recoveredMasterKey)
			}

			phase = 'done'
		} catch (err) {
			error = err instanceof Error ? err.message : 'Restore failed. Please try again.'
			phase = 'preview'
		}
	}

	function handleGoHome() {
		if (sessionStore.data.appOrigin) {
			goto(resolve(routes.CONNECT))
		} else {
			goto(resolve(routes.HOME))
		}
	}

	function formatDate(ts: number) {
		return new Date(ts).toLocaleString()
	}
</script>

<CreationLayout
	title="Restore from Swarm backup"
	description="Enter your backup hash and authenticate to restore your account"
	onClose={() => goto(resolve(routes.HOME))}
>
	{#snippet content()}
		<Vertical --vertical-gap="var(--padding)">
			{#if phase === 'idle' || phase === 'decrypting'}
				<Vertical --vertical-gap="var(--half-padding)">
					<Input
						label="Swarm backup hash"
						variant="outline"
						dimension="compact"
						placeholder="64-character hex hash"
						bind:value={hash}
						disabled={phase === 'decrypting'}
					/>
					{#if hash && !hashValid}
						<ErrorMessage>Must be a 64-character hex string</ErrorMessage>
					{/if}
				</Vertical>

				<Select
					label="Account type"
					variant="outline"
					dimension="compact"
					items={accountTypeItems}
					bind:value={accountType}
				/>

				{#if accountType === 'agent'}
					<Vertical --vertical-gap="var(--quarter-padding)">
						<Horizontal --horizontal-justify-content="space-between">
							<Typography variant="small">BIP-39 seed phrase</Typography>
							<Typography variant="small" style="color: var(--colors-medium)"
								>{wordCount} words</Typography
							>
						</Horizontal>
						<textarea
							class="phrase-input"
							bind:value={seedPhrase}
							placeholder="Enter your 12 or 24 words separated by spaces…"
							rows={3}
							disabled={phase === 'decrypting'}
						></textarea>
						{#if seedPhrase && !seedPhraseValid}
							<ErrorMessage>Valid 12 or 24 word BIP-39 phrase required</ErrorMessage>
						{/if}
					</Vertical>
				{/if}

				{#if accountType === 'ethereum'}
					<Typography variant="small" style="color: var(--colors-medium)">
						You will be asked to sign a message with your wallet to decrypt the backup.
						{#if !existingAccount}
							A second signature creates your local account record.
						{/if}
					</Typography>
				{:else if accountType === 'passkey'}
					<Typography variant="small" style="color: var(--colors-medium)">
						Your passkey will be used to decrypt the backup — the same credential you used when
						creating the account.
					</Typography>
				{:else}
					<Typography variant="small" style="color: var(--colors-medium)">
						Your seed phrase derives the decryption key. It is not sent anywhere.
					</Typography>
				{/if}

				{#if error}
					<ErrorMessage>{error}</ErrorMessage>
				{/if}
			{/if}

			{#if phase === 'preview' || phase === 'restoring'}
				{#if payload && recoveredAddress}
					<Vertical --vertical-gap="var(--half-padding)">
						<Typography>Backup found</Typography>
						<Typography variant="small" style="color: var(--colors-medium)">
							Saved {formatDate(payload.timestamp)}
						</Typography>
					</Vertical>

					<Divider />

					<Vertical --vertical-gap="var(--quarter-padding)">
						<Horizontal --horizontal-justify-content="space-between">
							<Typography variant="small">Identities</Typography>
							<Typography variant="small" font="mono">{payload.identities.length}</Typography>
						</Horizontal>
						{#each payload.identities as identity (identity.id)}
							<Horizontal
								--horizontal-gap="var(--half-padding)"
								--horizontal-align-items="center"
								style="padding-left: var(--half-padding)"
							>
								<Typography variant="small" style="color: var(--colors-medium)">
									{identity.name}
								</Typography>
							</Horizontal>
						{/each}
					</Vertical>

					<Vertical --vertical-gap="var(--quarter-padding)">
						<Horizontal --horizontal-justify-content="space-between">
							<Typography variant="small">Connected apps</Typography>
							<Typography variant="small" font="mono">{payload.connectedApps.length}</Typography>
						</Horizontal>
					</Vertical>

					{#if existingAccount}
						<Typography variant="small" style="color: var(--colors-medium)">
							This account already exists on this device. Only new identities ({newIdentityCount})
							and new apps ({newAppCount}) will be added.
						</Typography>
					{/if}

					{#if error}
						<ErrorMessage>{error}</ErrorMessage>
					{/if}
				{/if}
			{/if}

			{#if phase === 'done'}
				<Vertical --vertical-gap="var(--half-padding)">
					<Typography style="color: var(--colors-green)">Account restored.</Typography>
					{#if payload}
						<Typography variant="small">
							{newIdentityCount}
							{newIdentityCount === 1 ? 'identity' : 'identities'} and {newAppCount}
							{newAppCount === 1 ? 'app' : 'apps'} added to this device.
						</Typography>
					{/if}
				</Vertical>
			{/if}
		</Vertical>
	{/snippet}

	{#snippet buttonContent()}
		{#if phase === 'idle' || phase === 'decrypting'}
			<Button
				dimension="compact"
				onclick={handleDecrypt}
				disabled={!canDecrypt || phase === 'decrypting'}
				class="mobile-full-width"
			>
				{phase === 'decrypting' ? 'Decrypting…' : 'Decrypt backup'}
				{#if phase === 'idle'}
					<span class="mobile-only"><ArrowRight size={20} /></span>
				{/if}
			</Button>
		{:else if phase === 'preview' || phase === 'restoring'}
			<Horizontal --horizontal-gap="var(--half-padding)">
				<Button
					dimension="compact"
					variant="strong"
					onclick={handleRestore}
					disabled={phase === 'restoring'}
					class="mobile-full-width"
				>
					{phase === 'restoring'
						? 'Restoring…'
						: existingAccount
							? 'Merge backup'
							: 'Restore account'}
					{#if phase === 'preview'}
						<span class="mobile-only"><ArrowRight size={20} /></span>
					{/if}
				</Button>
				<Button
					dimension="compact"
					variant="ghost"
					onclick={() => {
						phase = 'idle'
						error = undefined
					}}
					disabled={phase === 'restoring'}
				>
					Back
				</Button>
			</Horizontal>
		{:else if phase === 'done'}
			<Button dimension="compact" variant="strong" onclick={handleGoHome} class="mobile-full-width">
				<Checkmark size={20} />
				Go to account
			</Button>
		{/if}
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
		min-height: 72px;
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
