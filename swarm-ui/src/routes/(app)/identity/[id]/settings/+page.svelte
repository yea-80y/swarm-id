<script lang="ts">
	import Vertical from '$lib/components/ui/vertical.svelte'
	import Typography from '$lib/components/ui/typography.svelte'
	import ResponsiveLayout from '$lib/components/ui/responsive-layout.svelte'
	import Horizontal from '$lib/components/ui/horizontal.svelte'
	import { layoutStore } from '$lib/stores/layout.svelte'
	import { accountsStore } from '$lib/stores/accounts.svelte'
	import Input from '$lib/components/ui/input/input.svelte'
	import { page } from '$app/state'
	import { identitiesStore } from '$lib/stores/identities.svelte'
	import Hashicon from '$lib/components/hashicon.svelte'
	import CopyButton from '$lib/components/copy-button.svelte'
	import Divider from '$lib/components/ui/divider.svelte'
	import CreateIdentityButton from '$lib/components/create-identity-button.svelte'
	import Button from '$lib/components/ui/button.svelte'
	import { sessionStore } from '$lib/stores/session.svelte'
	import {
		getMasterKeyFromAccount,
		getMasterKeyFromWallet,
		SeedPhraseRequiredError,
	} from '$lib/utils/account-auth'
	import { deriveExportedKeys, toMetaMaskHex } from '$lib/utils/key-export'
	import type { ExportedKeys } from '$lib/utils/key-export'
	import {
		bindPasskeyToAccount,
		hasPasskeyBinding,
		removePasskeyBinding,
	} from '$lib/utils/passkey-binding'
	import {
		signDelegationCertificate,
		createDelegationPayload,
		writeDelegationCertificate,
		storeDelegationReference,
		getDelegationReference,
	} from '$lib/utils/delegation-certificate'
	import { connectWalletSigner } from '$lib/ethereum'
	import { networkSettingsStore } from '$lib/stores/network-settings.svelte'
	import { postageStampsStore } from '$lib/stores/postage-stamps.svelte'
	import { Bee } from '@ethersphere/bee-js'

	const identityId = $derived(page.params.id)
	const identity = $derived(identityId ? identitiesStore.getIdentity(identityId) : undefined)
	const account = $derived(identity ? accountsStore.getAccount(identity.accountId) : undefined)
	const isWalletAccount = $derived(account?.type === 'ethereum')

	// Feed signer address from identity (stored at creation — no masterKey needed)
	const feedSignerAddress = $derived(identity?.feedSignerAddress)

	// masterKey is available in session right after account creation or re-auth.
	// If present, we can offer private key export.
	const masterKey = $derived(sessionStore.data.temporaryMasterKey)

	let identityName = $state('')

	// Exported key data — populated on demand when user clicks export
	let exportedKeys = $state<ExportedKeys | undefined>(undefined)
	let exportError = $state<string | undefined>(undefined)
	let isExporting = $state(false)

	// Passkey binding state (Option A)
	let passkeyBound = $state(false)
	let isBindingPasskey = $state(false)
	let bindingError = $state<string | undefined>(undefined)
	let bindingSuccess = $state(false)

	// Delegation certificate state
	let delegationRef = $state<string | undefined>(undefined)
	let isPublishing = $state(false)
	let publishError = $state<string | undefined>(undefined)
	let showDelegationConfirm = $state(false)
	let manualBatchId = $state('')

	// Re-check passkey binding whenever the account changes
	$effect(() => {
		const currentAccount = account
		const walletType = isWalletAccount
		passkeyBound = false
		bindingSuccess = false
		bindingError = undefined
		if (currentAccount && walletType) {
			hasPasskeyBinding(currentAccount.id.toString()).then((bound) => {
				passkeyBound = bound
			})
		}
	})

	// Re-check delegation reference whenever identity changes
	$effect(() => {
		const currentIdentityId = identityId
		delegationRef = undefined
		showDelegationConfirm = false
		publishError = undefined
		if (currentIdentityId) {
			delegationRef = getDelegationReference(currentIdentityId)
		}
	})

	$effect(() => {
		if (identity) {
			identityName = identity.name
		} else {
			identityName = ''
		}
	})

	function onNameChange() {
		if (identity) {
			identitiesStore.updateIdentity(identity.id, { name: identityName })
		}
	}

	/**
	 * Derive and reveal all exportable keys.
	 * If masterKey is in session, use it directly.
	 * Otherwise, re-authenticate (passkey prompt / wallet sign) to get it.
	 */
	async function handleExportKeys() {
		if (!account) return

		try {
			isExporting = true
			exportError = undefined

			let key = masterKey
			if (!key) {
				key = await getMasterKeyFromAccount(account)
				sessionStore.setTemporaryMasterKey(key)
			}

			exportedKeys = await deriveExportedKeys(account, key)
		} catch (err) {
			if (err instanceof SeedPhraseRequiredError) {
				exportError = 'Agent accounts require seed phrase — use recovery page.'
			} else {
				exportError = err instanceof Error ? err.message : 'Failed to derive keys'
			}
			console.error('[Settings] Key export failed:', err)
		} finally {
			isExporting = false
		}
	}

	/** Hide exported keys from the UI */
	function handleHideKeys() {
		exportedKeys = undefined
		exportError = undefined
	}

	/**
	 * Bind a device passkey for fast session start (Option A).
	 * Requires wallet auth to get the masterKey, then registers a new
	 * platform passkey and encrypts the masterKey with PRF output.
	 */
	async function handleBindPasskey() {
		if (!account || account.type !== 'ethereum') return

		try {
			isBindingPasskey = true
			bindingError = undefined
			bindingSuccess = false

			let key = masterKey
			if (!key) {
				key = await getMasterKeyFromWallet(account)
				sessionStore.setTemporaryMasterKey(key)
			}

			const rpId = window.location.hostname
			await bindPasskeyToAccount(account.id.toString(), key, rpId)
			passkeyBound = true
			bindingSuccess = true
		} catch (err) {
			bindingError = err instanceof Error ? err.message : 'Failed to bind passkey'
			console.error('[Settings] Passkey binding failed:', err)
		} finally {
			isBindingPasskey = false
		}
	}

	/** Remove the passkey binding — user falls back to wallet auth */
	async function handleRemovePasskeyBinding() {
		if (!account) return

		try {
			await removePasskeyBinding(account.id.toString())
			passkeyBound = false
			bindingSuccess = false
			bindingError = undefined
		} catch (err) {
			bindingError = err instanceof Error ? err.message : 'Failed to remove binding'
		}
	}

	/**
	 * Publish a delegation certificate to Swarm.
	 * Connects wallet → EIP-712 sign → upload to Swarm → store reference.
	 */
	async function handlePublishDelegation() {
		if (!identity || !feedSignerAddress || !isWalletAccount) return

		try {
			isPublishing = true
			publishError = undefined

			const signer = await connectWalletSigner()

			const cert = await signDelegationCertificate(signer, `0x${feedSignerAddress}`, identity.id)

			const payload = createDelegationPayload(cert)

			const stamps = postageStampsStore.stamps
			const stamp = manualBatchId.trim() || (stamps.length > 0 ? stamps[0].batchID : '')
			if (!stamp) {
				throw new Error('No postage stamp available. Enter a batch ID or create a stamp first.')
			}

			const bee = new Bee(networkSettingsStore.beeNodeUrl)
			const result = await writeDelegationCertificate(bee, stamp, payload)

			storeDelegationReference(signer.address, identity.id, result.reference)
			delegationRef = result.reference
			showDelegationConfirm = false
		} catch (err) {
			publishError = err instanceof Error ? err.message : 'Failed to publish certificate'
			console.error('[Settings] Delegation publish failed:', err)
		} finally {
			isPublishing = false
		}
	}
</script>

<Vertical --vertical-gap="var(--double-padding)" style="padding-top: var(--double-padding);">
	<!-- ===== Identity / Account Info ===== -->
	<Vertical --vertical-gap="var(--padding)">
		<ResponsiveLayout
			--responsive-align-items="start"
			--responsive-justify-content="stretch"
			--responsive-gap="var(--quarter-padding)"
		>
			<Horizontal
				class={!layoutStore.mobile ? 'flex50 input-layout' : ''}
				--horizontal-gap="var(--half-padding)"><Typography>Account</Typography></Horizontal
			>
			<Input
				variant="outline"
				dimension="compact"
				name="account"
				value={account?.name}
				disabled
				class="flex50"
			/>
		</ResponsiveLayout>

		<ResponsiveLayout
			--responsive-align-items="start"
			--responsive-justify-content="stretch"
			--responsive-gap="var(--quarter-padding)"
		>
			<Typography class={!layoutStore.mobile ? 'flex50 input-layout' : ''}
				>Identity display name</Typography
			>
			<Vertical
				class={!layoutStore.mobile ? 'flex50' : ''}
				--vertical-gap="var(--quarter-gap)"
				--vertical-align-items={layoutStore.mobile ? 'stretch' : 'start'}
			>
				<Horizontal --horizontal-gap="var(--half-padding)">
					<Input
						variant="outline"
						dimension="compact"
						name="id-name"
						bind:value={identityName}
						class="grower"
						oninput={onNameChange}
					/>
					{#if identity}
						<Hashicon value={identity.id} size={40} />
					{/if}
				</Horizontal>
			</Vertical>
		</ResponsiveLayout>

		<ResponsiveLayout
			--responsive-align-items="start"
			--responsive-justify-content="stretch"
			--responsive-gap="var(--quarter-padding)"
		>
			<Typography class={!layoutStore.mobile ? 'flex50 input-layout' : ''}
				>Identity address</Typography
			>
			<Vertical
				class={!layoutStore.mobile ? 'flex50' : ''}
				--vertical-gap="var(--quarter-gap)"
				--vertical-align-items={layoutStore.mobile ? 'stretch' : 'start'}
			>
				<Horizontal --horizontal-gap="var(--half-padding)">
					<Input
						variant="outline"
						dimension="compact"
						name="id-name"
						value={identity?.id}
						class="grower"
						disabled
					/>
					{#if identity}
						<CopyButton text={identity.id} />
					{/if}
				</Horizontal>
				<Typography variant="small">Unique identifier for this identity</Typography>
			</Vertical>
		</ResponsiveLayout>
	</Vertical>

	<Divider --margin="0" />

	<!-- ===== Signing Keys ===== -->
	<!--
		This section shows the user's Swarm feed signer address and allows
		private key export when the masterKey is available in session.

		The feed signer address is safe to display (public info — it's just an
		Ethereum address). The private key is only shown after user explicitly
		clicks "Show private keys" and only when masterKey is in session.

		masterKey is in session:
		  - Right after account creation (before navigating away)
		  - After re-authentication (re-auth flow, Phase 3)

		If masterKey is NOT in session, we show the address only, with a note
		that re-authentication is needed to export the private key.
	-->
	<Vertical --vertical-gap="var(--padding)">
		<Typography variant="h5">Signing Keys</Typography>
		<Typography variant="small" style="color: var(--color-text-secondary)">
			Your Swarm feed signer is used to sign writes to your personal Swarm feeds.
			{#if account?.type === 'passkey' || account?.type === 'agent'}
				Derived from your passkey at BIP-44 path m/44'/60'/1'/0/0.
			{:else}
				Derived from your account master key.
			{/if}
		</Typography>

		{#if feedSignerAddress}
			<!-- Feed signer address — always visible (public info) -->
			<ResponsiveLayout
				--responsive-align-items="start"
				--responsive-justify-content="stretch"
				--responsive-gap="var(--quarter-padding)"
			>
				<Typography class={!layoutStore.mobile ? 'flex50 input-layout' : ''}
					>Feed signer address</Typography
				>
				<Vertical
					class={!layoutStore.mobile ? 'flex50' : ''}
					--vertical-gap="var(--quarter-gap)"
					--vertical-align-items={layoutStore.mobile ? 'stretch' : 'start'}
				>
					<Horizontal --horizontal-gap="var(--half-padding)">
						<Input
							variant="outline"
							dimension="compact"
							name="feed-signer"
							value={`0x${feedSignerAddress}`}
							class="grower"
							disabled
						/>
						<CopyButton text={`0x${feedSignerAddress}`} />
					</Horizontal>
					<Typography variant="small">Your Swarm identity address for personal feeds</Typography>
				</Vertical>
			</ResponsiveLayout>
		{/if}

		<!-- Export private keys — re-authenticates if masterKey not in session -->
		{#if !exportedKeys}
			<Horizontal --horizontal-gap="var(--half-padding)">
				<Button
					variant="ghost"
					dimension="compact"
					onclick={handleExportKeys}
					disabled={isExporting}
				>
					{isExporting ? 'Authenticating…' : 'Show private keys'}
				</Button>
			</Horizontal>
			{#if exportError}
				<Typography variant="small" style="color: var(--color-danger)">{exportError}</Typography>
			{/if}
		{:else}
			<!-- Exported key display -->
			<Vertical
				--vertical-gap="var(--padding)"
				class="key-export-panel"
				style="padding: var(--padding); border: 1px solid var(--color-border); border-radius: var(--border-radius);"
			>
				<Typography variant="small" style="color: var(--color-warning)">
					Keep these keys secret. Anyone with access can write to your Swarm feeds and spend your
					funds.
				</Typography>

				<!-- Feed signer private key -->
				<ResponsiveLayout
					--responsive-align-items="start"
					--responsive-justify-content="stretch"
					--responsive-gap="var(--quarter-padding)"
				>
					<Typography class={!layoutStore.mobile ? 'flex50 input-layout' : ''}
						>Feed signer private key</Typography
					>
					<Horizontal
						class={!layoutStore.mobile ? 'flex50' : ''}
						--horizontal-gap="var(--half-padding)"
					>
						<Input
							variant="outline"
							dimension="compact"
							name="feed-signer-key"
							value={toMetaMaskHex(exportedKeys.feedSignerHex)}
							class="grower key-input"
							disabled
						/>
						<CopyButton text={toMetaMaskHex(exportedKeys.feedSignerHex)} />
					</Horizontal>
				</ResponsiveLayout>

				<!-- Parent / funds account key -->
				<ResponsiveLayout
					--responsive-align-items="start"
					--responsive-justify-content="stretch"
					--responsive-gap="var(--quarter-padding)"
				>
					<Vertical class={!layoutStore.mobile ? 'flex50 input-layout' : ''}>
						<Typography>Parent account key</Typography>
						<Typography variant="small" style="color: var(--color-text-secondary)">
							{#if account?.type === 'passkey' || account?.type === 'agent'}
								m/44'/60'/0'/0/0 — import into MetaMask as funds wallet
							{:else}
								Your SIWE-derived master key
							{/if}
						</Typography>
					</Vertical>
					<Horizontal
						class={!layoutStore.mobile ? 'flex50' : ''}
						--horizontal-gap="var(--half-padding)"
					>
						<Input
							variant="outline"
							dimension="compact"
							name="parent-key"
							value={toMetaMaskHex(exportedKeys.parentKeyHex)}
							class="grower key-input"
							disabled
						/>
						<CopyButton text={toMetaMaskHex(exportedKeys.parentKeyHex)} />
					</Horizontal>
				</ResponsiveLayout>

				<!-- BIP-39 mnemonic (passkey/agent only) -->
				{#if exportedKeys.mnemonic}
					<ResponsiveLayout
						--responsive-align-items="start"
						--responsive-justify-content="stretch"
						--responsive-gap="var(--quarter-padding)"
					>
						<Vertical class={!layoutStore.mobile ? 'flex50 input-layout' : ''}>
							<Typography>Recovery phrase</Typography>
							<Typography variant="small" style="color: var(--color-text-secondary)">
								24-word BIP-39 phrase — recovers all keys including feed signer
							</Typography>
						</Vertical>
						<Vertical
							class={!layoutStore.mobile ? 'flex50' : ''}
							--vertical-gap="var(--quarter-gap)"
						>
							<div class="mnemonic-grid">
								{#each exportedKeys.mnemonic.split(' ') as word, i (i)}
									<span class="mnemonic-word"><span class="mnemonic-n">{i + 1}.</span> {word}</span>
								{/each}
							</div>
							<CopyButton text={exportedKeys.mnemonic} />
						</Vertical>
					</ResponsiveLayout>
				{/if}

				<Button variant="ghost" dimension="compact" onclick={handleHideKeys}>Hide keys</Button>
			</Vertical>
		{/if}
	</Vertical>

	<!-- ===== Passkey Sign-in (Option A — wallet accounts only) ===== -->
	{#if isWalletAccount}
		<Divider --margin="0" />

		<Vertical --vertical-gap="var(--padding)">
			<Typography variant="h5">Passkey Sign-in</Typography>
			<Typography variant="small" style="color: var(--color-text-secondary)">
				Use a device passkey (Touch ID, Face ID, Windows Hello) to sign in and start sessions
				instead of connecting your wallet each time. Your account credentials are stored securely on
				your device. Your wallet remains the primary authentication and recovery method.
			</Typography>

			{#if passkeyBound}
				<Vertical --vertical-gap="var(--half-padding)">
					<Typography variant="small" style="color: var(--color-success)">
						Passkey active — sign in with biometrics instead of your wallet.
					</Typography>
					<Horizontal --horizontal-gap="var(--half-padding)">
						<Button variant="ghost" dimension="compact" onclick={handleRemovePasskeyBinding}>
							Remove passkey
						</Button>
					</Horizontal>
				</Vertical>
			{:else}
				<Vertical --vertical-gap="var(--half-padding)">
					<Horizontal --horizontal-gap="var(--half-padding)">
						<Button
							variant="ghost"
							dimension="compact"
							onclick={handleBindPasskey}
							disabled={isBindingPasskey}
						>
							{isBindingPasskey ? 'Setting up…' : 'Set up passkey sign-in'}
						</Button>
					</Horizontal>
					{#if bindingSuccess}
						<Typography variant="small" style="color: var(--color-success)">
							Passkey set up. You can now sign in with biometrics instead of your wallet.
						</Typography>
					{/if}
					<Typography variant="small" style="color: var(--color-text-secondary)">
						Requires a one-time wallet signature to set up. If you lose your passkey, you can always
						sign in with your wallet and set up a new one.
					</Typography>
				</Vertical>
			{/if}

			{#if bindingError}
				<Typography variant="small" style="color: var(--color-danger)">{bindingError}</Typography>
			{/if}
		</Vertical>
	{/if}

	<!-- ===== Delegation Certificate (opt-in public identity — wallet accounts only) ===== -->
	{#if isWalletAccount && feedSignerAddress}
		<Divider --margin="0" />

		<Vertical --vertical-gap="var(--padding)">
			<Typography variant="h5">Public Identity</Typography>

			{#if delegationRef}
				<Typography variant="small" style="color: var(--color-success)">
					This identity is publicly linked to your wallet. Anyone with the reference below can
					verify that your feed signer is authorised by your wallet.
				</Typography>
				<ResponsiveLayout
					--responsive-align-items="start"
					--responsive-justify-content="stretch"
					--responsive-gap="var(--quarter-padding)"
				>
					<Typography class={!layoutStore.mobile ? 'flex50 input-layout' : ''}
						>Certificate reference</Typography
					>
					<Horizontal
						class={!layoutStore.mobile ? 'flex50' : ''}
						--horizontal-gap="var(--half-padding)"
					>
						<Input
							variant="outline"
							dimension="compact"
							name="delegation-ref"
							value={delegationRef}
							class="grower key-input"
							disabled
						/>
						<CopyButton text={delegationRef} />
					</Horizontal>
				</ResponsiveLayout>
			{:else if showDelegationConfirm}
				<Vertical
					--vertical-gap="var(--padding)"
					style="padding: var(--padding); border: 1px solid var(--color-warning); border-radius: var(--border-radius);"
				>
					<Typography variant="small" style="color: var(--color-warning)">
						This will publicly link your feed signer address to your wallet address on Swarm. Once
						published, this cannot be undone — Swarm data is immutable. To go private again, you
						would need to create a new identity.
					</Typography>
					<Typography variant="small">
						Your wallet will ask you to sign an EIP-712 message to prove you authorise this binding.
						A postage stamp is required for the Swarm upload.
					</Typography>
					<Input
						variant="outline"
						dimension="compact"
						name="batch-id"
						bind:value={manualBatchId}
						placeholder="Postage batch ID (leave blank to use account stamp)"
						class="key-input"
					/>
					<Horizontal --horizontal-gap="var(--half-padding)">
						<Button
							variant="strong"
							dimension="compact"
							onclick={handlePublishDelegation}
							disabled={isPublishing}
						>
							{isPublishing ? 'Publishing…' : 'Confirm and publish'}
						</Button>
						<Button
							variant="ghost"
							dimension="compact"
							onclick={() => {
								showDelegationConfirm = false
								publishError = undefined
							}}
						>
							Cancel
						</Button>
					</Horizontal>
				</Vertical>
			{:else}
				<Typography variant="small" style="color: var(--color-text-secondary)">
					By default, your identity is private — your feed signer address cannot be linked to your
					wallet. You can opt in to make this identity public, allowing anyone to verify that your
					Swarm content is genuinely from your wallet address.
				</Typography>
				<Horizontal --horizontal-gap="var(--half-padding)">
					<Button
						variant="ghost"
						dimension="compact"
						onclick={() => (showDelegationConfirm = true)}
					>
						Make this identity public
					</Button>
				</Horizontal>
			{/if}

			{#if publishError}
				<Typography variant="small" style="color: var(--color-danger)">{publishError}</Typography>
			{/if}
		</Vertical>
	{/if}

	<Divider --margin="0" />

	<ResponsiveLayout
		--responsive-align-items="start"
		--responsive-justify-content="stretch"
		--responsive-gap="var(--quarter-padding)"
	>
		<CreateIdentityButton {account} showIcon={false} />
	</ResponsiveLayout>
</Vertical>

<style>
	:global(.flex50) {
		flex: 0.5;
	}
	:global(.input-layout) {
		padding: var(--half-padding) 0 !important;
		border: 1px solid transparent;
	}

	/* Monospace display for private key hex strings */
	:global(.key-input input) {
		font-family: var(--font-mono, monospace);
		font-size: 0.75rem;
	}

	/* 24-word mnemonic grid — 3 columns */
	.mnemonic-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--quarter-padding);
		padding: var(--half-padding);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--border-radius);
	}

	.mnemonic-word {
		font-size: 0.85rem;
	}

	.mnemonic-n {
		color: var(--color-text-secondary);
		font-size: 0.75rem;
	}
</style>
