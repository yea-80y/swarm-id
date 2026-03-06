<script lang="ts">
	import { browser } from '$app/environment'
	import { Bee } from '@ethersphere/bee-js'
	import { onMount } from 'svelte'
	import Vertical from '$lib/components/ui/vertical.svelte'
	import Typography from '$lib/components/ui/typography.svelte'
	import ResponsiveLayout from '$lib/components/ui/responsive-layout.svelte'
	import Horizontal from '$lib/components/ui/horizontal.svelte'
	import { layoutStore } from '$lib/stores/layout.svelte'
	import { accountsStore } from '$lib/stores/accounts.svelte'
	import Input from '$lib/components/ui/input/input.svelte'
	import { page } from '$app/state'
	import { identitiesStore } from '$lib/stores/identities.svelte'
	import { connectedAppsStore } from '$lib/stores/connected-apps.svelte'
	import { postageStampsStore } from '$lib/stores/postage-stamps.svelte'
	import { networkSettingsStore } from '$lib/stores/network-settings.svelte'
	import ErrorMessage from '$lib/components/ui/error-message.svelte'
	import Hashicon from '$lib/components/hashicon.svelte'
	import CopyButton from '$lib/components/copy-button.svelte'
	import Divider from '$lib/components/ui/divider.svelte'
	import CreateIdentityButton from '$lib/components/create-identity-button.svelte'
	import Button from '$lib/components/ui/button.svelte'
	import { sessionStore } from '$lib/stores/session.svelte'
	import { deriveExportedKeys, toMetaMaskHex } from '$lib/utils/key-export'
	import type { ExportedKeys } from '$lib/utils/key-export'
	import { deriveBackupKeypair } from '$lib/utils/backup-encryption'
	import { writeAccountBackup } from '$lib/utils/account-backup'
	import type { BackupPayload } from '$lib/utils/account-backup'

	const identityId = $derived(page.params.id)
	const identity = $derived(identityId ? identitiesStore.getIdentity(identityId) : undefined)
	const account = $derived(identity ? accountsStore.getAccount(identity.accountId) : undefined)

	// Feed signer address from identity (stored at creation — no masterKey needed)
	const feedSignerAddress = $derived(identity?.feedSignerAddress)

	// masterKey is available in session right after account creation or re-auth.
	// If present, we can offer private key export and backup.
	const masterKey = $derived(sessionStore.data.temporaryMasterKey)

	// Batch ID entered by user for backup upload — just the 64-char hex, no signer needed
	let backupBatchId = $state('')
	const backupBatchIdValid = $derived(/^[0-9a-fA-F]{64}$/.test(backupBatchId))

	let identityName = $state('')

	// Exported key data — populated on demand when user clicks export
	let exportedKeys = $state<ExportedKeys | undefined>(undefined)
	let exportError = $state<string | undefined>(undefined)
	let isExporting = $state(false)

	// Backup state
	let backupReference = $state<string | undefined>(undefined)
	let backupTimestamp = $state<number | undefined>(undefined)
	let isBackingUp = $state(false)
	let backupError = $state<string | undefined>(undefined)

	const BACKUP_REF_KEY = $derived(account ? `swarm-id-backup-${account.id.toHex()}` : '')

	onMount(() => {
		if (!browser) return
		const stored = localStorage.getItem(BACKUP_REF_KEY)
		if (stored) {
			const parsed = JSON.parse(stored) as { reference: string; timestamp: number }
			backupReference = parsed.reference
			backupTimestamp = parsed.timestamp
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
	 * Derive and reveal all exportable keys from the account master key.
	 * Requires masterKey to be present in session (available after account
	 * creation or explicit re-authentication).
	 */
	async function handleExportKeys() {
		if (!account || !masterKey) return

		try {
			isExporting = true
			exportError = undefined
			exportedKeys = await deriveExportedKeys(account, masterKey)
		} catch (err) {
			exportError = err instanceof Error ? err.message : 'Failed to derive keys'
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

	/** Encrypt and upload account backup to Swarm, log the returned hash. */
	async function handleBackup() {
		if (!account || !masterKey || !backupBatchIdValid) return

		try {
			isBackingUp = true
			backupError = undefined

			const entropy = masterKey.toUint8Array()
			const keypair = deriveBackupKeypair(entropy)

			const accountIdentities = identitiesStore.identities.filter((i) =>
				i.accountId.equals(account.id),
			)
			const accountApps = accountIdentities.flatMap((i) =>
				connectedAppsStore.getAppsByIdentityId(i.id),
			)
			const accountStamps = postageStampsStore.getStampsByAccount(account.id.toHex())

			const payload: BackupPayload = {
				version: 1,
				timestamp: Date.now(),
				masterKeyHex: account.type !== 'passkey' ? masterKey.toHex() : undefined,
				identities: accountIdentities.map((i) => ({
					id: i.id,
					accountId: i.accountId.toHex(),
					name: i.name,
					createdAt: i.createdAt,
					feedSignerAddress: i.feedSignerAddress,
					defaultPostageStampBatchID: i.defaultPostageStampBatchID?.toHex(),
				})),
				connectedApps: accountApps.map((a) => ({
					appUrl: a.appUrl,
					appName: a.appName,
					identityId: a.identityId,
					appSecret: a.appSecret ?? '',
					connectedUntil: a.connectedUntil ?? 0,
				})),
				postageStamps: accountStamps.map((s) => ({
					batchId: s.batchID.toHex(),
				})),
			}

			const bee = new Bee(networkSettingsStore.beeNodeUrl)
			const result = await writeAccountBackup(bee, backupBatchId, payload, keypair)

			backupReference = result.reference
			backupTimestamp = Date.now()
			localStorage.setItem(
				BACKUP_REF_KEY,
				JSON.stringify({ reference: backupReference, timestamp: backupTimestamp }),
			)
		} catch (err) {
			backupError = err instanceof Error ? err.message : 'Backup failed. Try again.'
			console.error('[Backup] Failed:', err)
		} finally {
			isBackingUp = false
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

		<!-- Export private keys — only available when masterKey is in session -->
		{#if masterKey}
			{#if !exportedKeys}
				<Horizontal --horizontal-gap="var(--half-padding)">
					<Button
						variant="ghost"
						dimension="compact"
						onclick={handleExportKeys}
						disabled={isExporting}
					>
						{isExporting ? 'Deriving keys…' : 'Show private keys'}
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
										<span class="mnemonic-word"
											><span class="mnemonic-n">{i + 1}.</span> {word}</span
										>
									{/each}
								</div>
								<CopyButton text={exportedKeys.mnemonic} />
							</Vertical>
						</ResponsiveLayout>
					{/if}

					<Button variant="ghost" dimension="compact" onclick={handleHideKeys}>Hide keys</Button>
				</Vertical>
			{/if}
		{:else}
			<!-- masterKey not in session — inform user how to access export -->
			<Typography variant="small" style="color: var(--color-text-secondary)">
				Private key export is available immediately after account creation or after
				re-authentication.
			</Typography>
		{/if}
	</Vertical>

	<Divider --margin="0" />

	<!-- ===== Swarm Backup ===== -->
	<Vertical --vertical-gap="var(--padding)">
		<Typography variant="h5">Swarm Backup</Typography>
		<Typography variant="small">
			Encrypts your identities, connected apps, and stamps and uploads them to Swarm. Only you can
			decrypt the backup — it is encrypted with a key only you can derive.
			{#if account?.type !== 'passkey'}
				Your master key is included so you can restore on a new device without your passphrase.
			{/if}
		</Typography>

		{#if !masterKey}
			<Typography variant="small" style="color: var(--colors-medium)">
				Backup is available immediately after account creation or re-authentication.
			</Typography>
		{:else}
			<!-- Batch ID input — no signer key needed, plain upload only needs the batch ID -->
			<ResponsiveLayout
				--responsive-align-items="start"
				--responsive-justify-content="stretch"
				--responsive-gap="var(--quarter-padding)"
			>
				<Typography class={!layoutStore.mobile ? 'flex50 input-layout' : ''}
					>Postage batch ID</Typography
				>
				<Input
					variant="outline"
					dimension="compact"
					name="backup-batch-id"
					placeholder="64-char hex batch ID"
					bind:value={backupBatchId}
					class={!layoutStore.mobile ? 'flex50' : ''}
				/>
			</ResponsiveLayout>

			{#if backupReference}
				<!-- Previous backup hash -->
				<ResponsiveLayout
					--responsive-align-items="start"
					--responsive-justify-content="stretch"
					--responsive-gap="var(--quarter-padding)"
				>
					<Vertical class={!layoutStore.mobile ? 'flex50 input-layout' : ''}>
						<Typography>Backup hash</Typography>
						{#if backupTimestamp}
							<Typography variant="small" style="color: var(--colors-medium)">
								Last backed up {new Date(backupTimestamp).toLocaleString()}
							</Typography>
						{/if}
					</Vertical>
					<Horizontal
						class={!layoutStore.mobile ? 'flex50' : ''}
						--horizontal-gap="var(--half-padding)"
					>
						<Input
							variant="outline"
							dimension="compact"
							name="backup-ref"
							value={backupReference}
							class="grower key-input"
							disabled
						/>
						<CopyButton text={backupReference} />
					</Horizontal>
				</ResponsiveLayout>
			{/if}

			<Horizontal --horizontal-gap="var(--half-padding)">
				<Button
					variant={backupReference ? 'ghost' : 'strong'}
					dimension="compact"
					onclick={handleBackup}
					disabled={isBackingUp || !backupBatchIdValid}
				>
					{isBackingUp ? 'Backing up…' : backupReference ? 'Back up again' : 'Back up now'}
				</Button>
			</Horizontal>

			{#if backupError}
				<ErrorMessage>{backupError}</ErrorMessage>
			{/if}
		{/if}
	</Vertical>

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
