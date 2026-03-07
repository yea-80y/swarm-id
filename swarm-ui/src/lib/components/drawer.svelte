<script lang="ts">
	import Vertical from '$lib/components/ui/vertical.svelte'
	import Horizontal from '$lib/components/ui/horizontal.svelte'
	import Button from '$lib/components/ui/button.svelte'
	import { page } from '$app/state'
	import { goto } from '$app/navigation'
	import { resolve } from '$app/paths'
	import routes from '$lib/routes'
	import { accountsStore } from '$lib/stores/accounts.svelte'
	import IdentityList from '$lib/components/identity-list.svelte'
	import CreateIdentityButton from '$lib/components/create-identity-button.svelte'
	import { notImplemented } from '$lib/utils/not-implemented'
	import { connectAndSign, deriveEncryptionSeed } from '$lib/ethereum'
	import {
		deriveEncryptionKey,
		deriveSecretSeedEncryptionKey,
		decryptMasterKey,
		decryptSecretSeed,
		generateEncryptionSalt,
		deriveMasterKeyEncryptionKeyFromEIP712,
		deriveSecretSeedEncryptionKeyFromEIP712,
		encryptMasterKey,
		encryptSecretSeed,
	} from '$lib/utils/encryption'
	import {
		Add,
		Checkmark,
		ChevronLeft,
		ChevronRight,
		CloseLarge,
		CloudUpload,
		IbmCloudHyperProtectCryptoServices,
		Information,
		Rocket,
		Security,
		TrashCan,
	} from 'carbon-icons-svelte'
	import { identitiesStore } from '$lib/stores/identities.svelte'
	import { connectedAppsStore } from '$lib/stores/connected-apps.svelte'
	import { deleteMnemonicBackup } from '$lib/utils/passkey-mnemonic'
	import { sessionStore } from '$lib/stores/session.svelte'
	import NetworkSettingsModal from './network-settings-modal.svelte'
	import ThemeToggle from './theme-toggle.svelte'
	import FlexItem from '$lib/components/ui/flex-item.svelte'
	import Divider from '$lib/components/ui/divider.svelte'
	import Badge from '$lib/components/ui/badge.svelte'
	import type { Account, Identity } from '$lib/types'
	import EthereumLogo from './ethereum-logo.svelte'
	import PasskeyLogo from './passkey-logo.svelte'
	import Input from './ui/input/input.svelte'
	import Typography from './ui/typography.svelte'
	import CopyButton from './copy-button.svelte'
	import Tooltip from './ui/tooltip.svelte'
	import ViewGenerationDetailsModal from './view-generation-details-modal.svelte'
	import BackupAccountModal from './backup-account-modal.svelte'
	import Bot from 'carbon-icons-svelte/lib/Bot.svelte'

	type Props = {
		drawerOpen: boolean
		account: Account
		identities: Identity[]
		identityId?: string
	}

	let { drawerOpen = $bindable(), identities, account, identityId }: Props = $props()

	let screen = $state<'main' | 'all-accounts' | 'account-details'>('main')
	// eslint-disable-next-line svelte/prefer-writable-derived
	let accountName = $state('')
	let showUpgradeTooltip = $state(false)
	let networkSettingsModalOpen = $state(false)
	let showGenerationDetailsModal = $state(false)
	let showBackupModal = $state(false)
	let isMigrating = $state(false)
	let migrationError = $state<string | undefined>(undefined)
	let migrationDone = $state(false)

	$effect(() => {
		accountName = account.name
	})

	function handleIdentityClick(clickedIdentity: (typeof identities)[number]) {
		const currentPath = page.url.pathname

		// Determine which page we're on and navigate to the same page type with the new identity
		if (currentPath.includes('/apps')) {
			goto(resolve(routes.IDENTITY_APPS, { id: clickedIdentity.id }))
		} else if (currentPath.includes('/stamps')) {
			goto(resolve(routes.IDENTITY_STAMPS, { id: clickedIdentity.id }))
		} else if (currentPath.includes('/settings')) {
			goto(resolve(routes.IDENTITY_SETTINGS, { id: clickedIdentity.id }))
		} else {
			goto(resolve(routes.IDENTITY_APPS, { id: clickedIdentity.id }))
		}
	}

	function selectAccount(acc: Account) {
		const firstAccountIdentity = identitiesStore.identities.find((i) => i.accountId.equals(acc.id))
		if (firstAccountIdentity) {
			handleIdentityClick(firstAccountIdentity)
		}
	}

	async function deleteAccount(acc: Account) {
		// Remove all connected apps for this account's identities
		const accountIdentities = identitiesStore.getIdentitiesByAccount(acc.id)
		for (const identity of accountIdentities) {
			const appsForIdentity = connectedAppsStore.apps.filter((a) => a.identityId === identity.id)
			for (const app of appsForIdentity) {
				connectedAppsStore.removeApp(app.appUrl, identity.id)
			}
			identitiesStore.removeIdentity(identity.id)
		}

		// Clean up passkey mnemonic backup from IndexedDB if applicable
		if (acc.type === 'passkey') {
			await deleteMnemonicBackup(acc.id.toHex())
		}

		accountsStore.removeAccount(acc.id)

		// If we deleted the active account, navigate away
		if (sessionStore.data.account?.id.equals(acc.id)) {
			drawerOpen = false
			const remaining = accountsStore.accounts
			if (remaining.length > 0) {
				selectAccount(remaining[0])
			} else {
				goto(resolve(routes.ACCOUNT_NEW))
			}
		}
	}

	function onAccountNameChange() {
		accountsStore.setAccountName(account.id, accountName)
	}

	async function handleMigrateToEIP712() {
		if (account.type !== 'ethereum' || account.encryptionScheme === 'eip712') return
		try {
			isMigrating = true
			migrationError = undefined

			// Step 1: SIWE — decrypt old masterKey (publicKey-based scheme)
			const signed = await connectAndSign()
			const oldMasterKeyKey = await deriveEncryptionKey(signed.publicKey, account.encryptionSalt)
			const masterKey = await decryptMasterKey(account.encryptedMasterKey, oldMasterKeyKey)

			// Step 2: Decrypt old secretSeed (v1: HKDF(masterKey, "swarm-id-secretseed-encryption-v1"))
			const oldSeedKey = await deriveSecretSeedEncryptionKey(masterKey)
			const secretSeed = await decryptSecretSeed(account.encryptedSecretSeed, oldSeedKey)

			// Step 3: EIP-712 — derive new deterministic encryption seed
			const encryptionSeed = await deriveEncryptionSeed()
			const newEncryptionSalt = generateEncryptionSalt()

			// Step 4: Re-encrypt both with EIP-712 scheme
			const masterKeyEncKey = await deriveMasterKeyEncryptionKeyFromEIP712(
				encryptionSeed,
				newEncryptionSalt,
			)
			const newEncryptedMasterKey = await encryptMasterKey(masterKey, masterKeyEncKey)

			const secretSeedEncKey = await deriveSecretSeedEncryptionKeyFromEIP712(
				encryptionSeed,
				newEncryptionSalt,
			)
			const newEncryptedSecretSeed = await encryptSecretSeed(secretSeed, secretSeedEncKey)

			// Step 5: Persist updated account
			accountsStore.upgradeEthereumAccountEncryption(
				account.id,
				newEncryptedMasterKey,
				newEncryptedSecretSeed,
				newEncryptionSalt,
			)

			migrationDone = true
		} catch (err) {
			migrationError = err instanceof Error ? err.message : 'Upgrade failed. Please try again.'
		} finally {
			isMigrating = false
		}
	}
</script>

{#if drawerOpen}
	<div class="drawer">
		<Vertical --vertical-gap="0">
			{#if screen === 'main'}
				<Horizontal
					--horizontal-gap="var(--double-padding)"
					--horizontal-justify-content="space-between"
					--horizontal-align-items="center"
					style="padding: var(--padding)"
				>
					<Horizontal --horizontal-gap="var(--half-padding)">
						{account.type === 'ethereum'
							? 'Ethereum'
							: account.type === 'agent'
								? 'Agent'
								: 'Passkey'}
						<Badge>Local</Badge>
					</Horizontal>
					<Button variant="ghost" dimension="compact" onclick={() => (drawerOpen = false)}
						><CloseLarge size={20} /></Button
					>
				</Horizontal>

				<div style="padding: 0 var(--padding);">
					<IdentityList
						{identities}
						currentIdentityId={identityId}
						onIdentityClick={handleIdentityClick}
						showBorder={false}
						showArrow={false}
					/>
				</div>

				<Vertical
					--vertical-gap="0"
					--vertical-align-items="stretch"
					style="padding: var(--padding)"
				>
					<CreateIdentityButton {account} showIcon={false} />
					<Button variant="ghost" dimension="compact" onclick={() => (screen = 'account-details')}>
						<Horizontal
							--horizontal-gap="var(--half-padding)"
							--horizontal-align-items="center"
							--horizontal-justify-content="stretch"
							style="flex: 1"
						>
							Account details
							<FlexItem />
							<ChevronRight size={20} />
						</Horizontal></Button
					>
				</Vertical>
				<Divider --margin="0" />
				<Vertical
					--vertical-gap="0"
					--vertical-align-items="stretch"
					style="padding: var(--padding)"
				>
					<Button variant="ghost" dimension="compact" onclick={() => (screen = 'all-accounts')}>
						<Horizontal
							--horizontal-gap="var(--half-padding)"
							--horizontal-align-items="center"
							--horizontal-justify-content="stretch"
							style="flex: 1"
						>
							All accounts
							<FlexItem />
							<ChevronRight size={20} />
						</Horizontal></Button
					>
				</Vertical>
				<Divider --margin="0" />
				<Vertical
					--vertical-gap="0"
					--vertical-align-items="stretch"
					style="padding: var(--padding)"
				>
					<Button
						variant="ghost"
						dimension="compact"
						onclick={() => (networkSettingsModalOpen = true)}
					>
						<Horizontal
							--horizontal-gap="var(--half-padding)"
							--horizontal-align-items="center"
							--horizontal-justify-content="stretch"
							style="flex: 1"
						>
							Network settings
						</Horizontal></Button
					>
				</Vertical>
				<Divider --margin="0" />
				<Vertical
					--vertical-gap="0"
					--vertical-align-items="stretch"
					style="padding: var(--padding)"
				>
					<Horizontal
						--horizontal-gap="var(--half-padding)"
						--horizontal-align-items="center"
						--horizontal-justify-content="stretch"
						style="flex: 1;"
					>
						<Typography style="padding: var(--half-padding)">Appearance</Typography>
						<FlexItem />
						<ThemeToggle />
					</Horizontal>
				</Vertical>
			{:else if screen === 'all-accounts'}
				<Horizontal
					--horizontal-gap="var(--double-padding)"
					--horizontal-justify-content="space-between"
					--horizontal-align-items="center"
					style="padding: var(--padding)"
				>
					<Horizontal --horizontal-gap="var(--half-padding)">
						<Button variant="ghost" dimension="compact" onclick={() => (screen = 'main')}
							><ChevronLeft size={20} /></Button
						>
						All accounts
					</Horizontal>
					<Button variant="ghost" dimension="compact" onclick={() => (drawerOpen = false)}
						><CloseLarge size={20} /></Button
					>
				</Horizontal>
				<Vertical --vertical-gap="0" style="padding: var(--padding)">
					{#each accountsStore.accounts as acc (acc.id)}
						{@const hasIdentities = identitiesStore.identities.some((i) =>
							i.accountId.equals(acc.id),
						)}
						{@const isActive = account.id.equals(acc.id)}
						<Horizontal --horizontal-gap="0" --horizontal-align-items="center">
							<Button
								variant="ghost"
								dimension="compact"
								onclick={() => selectAccount(acc)}
								style="flex: 1; min-width: 0"
							>
								<Horizontal
									--horizontal-gap="var(--half-padding)"
									--horizontal-align-items="center"
									--horizontal-justify-content="stretch"
									style="flex: 1"
								>
									{#if acc.type === 'ethereum'}
										<EthereumLogo size={20} />
									{:else if acc.type === 'agent'}
										<Bot size={20} />
									{:else}
										<PasskeyLogo size={20} />
									{/if}
									<span class="account-name-text">{acc.name}</span>
									<FlexItem />
									{#if isActive}
										<Checkmark size={20} />
									{:else if !hasIdentities}
										<Typography variant="small" style="color: var(--colors-medium)"
											>empty</Typography
										>
									{/if}
								</Horizontal>
							</Button>
							{#if !isActive}
								<Button
									variant="ghost"
									dimension="compact"
									danger
									onclick={() => deleteAccount(acc)}
									title="Delete {acc.name}"
								>
									<TrashCan size={16} />
								</Button>
							{/if}
						</Horizontal>
					{/each}
				</Vertical>
				<Divider --margin="0" />
				<Vertical
					--vertical-gap="0"
					--vertical-align-items="stretch"
					style="padding: var(--padding)"
				>
					<Button
						variant="ghost"
						dimension="compact"
						onclick={() => {
							drawerOpen = false
							goto(resolve(routes.ACCOUNT_NEW))
						}}
					>
						<Horizontal
							--horizontal-gap="var(--half-padding)"
							--horizontal-align-items="center"
							--horizontal-justify-content="stretch"
							style="flex: 1"
						>
							<Add size={20} />
							Add account
						</Horizontal></Button
					>
				</Vertical>
			{:else if screen === 'account-details'}
				<Horizontal
					--horizontal-gap="var(--double-padding)"
					--horizontal-justify-content="space-between"
					--horizontal-align-items="center"
					style="padding: var(--padding)"
				>
					<Horizontal --horizontal-gap="var(--half-padding)">
						<Button variant="ghost" dimension="compact" onclick={() => (screen = 'main')}
							><ChevronLeft size={20} /></Button
						>
						Account details
					</Horizontal>
					<Button variant="ghost" dimension="compact" onclick={() => (drawerOpen = false)}
						><CloseLarge size={20} /></Button
					>
				</Horizontal>
				<Vertical --vertical-gap="var(--padding)" style="padding: 0 var(--padding)">
					<Vertical --vertical-gap="var(--half-padding)">
						<Input
							variant="outline"
							dimension="compact"
							name="id-name"
							bind:value={accountName}
							class="grower"
							label="Account name"
							oninput={onAccountNameChange}
						/>
						<Horizontal --horizontal-gap="var(--quarter-padding)">
							{#if account.type === 'ethereum'}
								<EthereumLogo size={20} />Ethereum
							{:else if account.type === 'agent'}
								<Bot size={20} />Agent
							{:else}
								<PasskeyLogo size={20} />Passkey
							{/if}
						</Horizontal>
					</Vertical>
					<Vertical --vertical-gap="var(--quarter-padding)">
						<Horizontal --horizontal-gap="var(--half-padding)" --horizontal-align-items="end">
							<Input
								variant="outline"
								dimension="compact"
								value={account.id.toHex()}
								class="grower"
								label="Account address"
								disabled
							/>
							<div style="border: 1px solid transparent">
								<CopyButton text={account.id.toHex()} />
							</div>
						</Horizontal>
						<Typography variant="small">Used to buy and own stamps</Typography>
					</Vertical>
					<Input
						variant="outline"
						dimension="compact"
						value="Local"
						class="grower"
						label="Account type"
						disabled
						helperText="Limited to viewing only. Upgrade to synced account to upload content and sync across devices."
					/>
				</Vertical>

				<Vertical
					--vertical-gap="0"
					--vertical-align-items="stretch"
					--vertical-justify-content="stretch"
					style="padding: var(--padding)"
				>
					{#if account.type === 'ethereum'}
						<Button
							variant="ghost"
							dimension="compact"
							onclick={() => {
								showGenerationDetailsModal = true
							}}
							leftAlign
						>
							<IbmCloudHyperProtectCryptoServices size={20} />
							View Generation Details
						</Button>
						{#if account.encryptionScheme !== 'eip712'}
							{#if !migrationDone}
								<div class="security-warning">
									<Vertical --vertical-gap="var(--quarter-padding)">
										<Typography variant="small">
											<strong>Security upgrade available.</strong> Your account uses an older encryption
											scheme. Upgrading protects against attackers who know your wallet's public key.
										</Typography>
										{#if migrationError}
											<Typography variant="small" style="color: var(--colors-red)"
												>{migrationError}</Typography
											>
										{/if}
										<Button
											dimension="compact"
											onclick={handleMigrateToEIP712}
											disabled={isMigrating}
										>
											<Security size={20} />
											{isMigrating ? 'Upgrading…' : 'Upgrade account security'}
										</Button>
										<Typography variant="small" style="color: var(--colors-medium)">
											Requires two wallet signatures (SIWE + EIP-712).
										</Typography>
									</Vertical>
								</div>
							{:else}
								<div class="security-ok">
									<Typography variant="small">
										<strong>Security upgraded.</strong> Account now uses EIP-712 encryption.
									</Typography>
								</div>
							{/if}
						{/if}
					{/if}
					<Button
						variant="ghost"
						dimension="compact"
						onclick={() => (showBackupModal = true)}
						leftAlign
					>
						<CloudUpload size={20} />
						Backup account
					</Button>

					<Horizontal
						--horizontal-gap="var(--half-padding)"
						--horizontal-align-items="stretch"
						--horizontal-justify-content="stretch"
						class="grower"
					>
						<Button variant="ghost" dimension="compact" onclick={notImplemented} flexGrow leftAlign>
							<Rocket size={20} />
							Upgrade account
							<FlexItem />
						</Button>
						<Tooltip
							show={showUpgradeTooltip}
							position="top"
							variant="small"
							color="dark"
							maxWidth="279px"
						>
							<Button
								variant="ghost"
								dimension="small"
								onmouseenter={() => (showUpgradeTooltip = true)}
								onmouseleave={() => (showUpgradeTooltip = false)}
								onclick={(e: MouseEvent) => {
									e.stopPropagation()
									showUpgradeTooltip = !showUpgradeTooltip
								}}
							>
								<Information size={16} />
							</Button>
							{#snippet helperText()}
								Upgrading requires a Swarm postage stamp. You'll be able to upload content to Swarm
								and access your account from any device.
							{/snippet}
						</Tooltip>
					</Horizontal>
					<Button
						variant="ghost"
						dimension="compact"
						danger
						leftAlign
						onclick={() => deleteAccount(account)}
					>
						<TrashCan size={20} />
						Delete account
					</Button>
				</Vertical>
			{/if}
		</Vertical>
	</div>
{/if}
{#if account.type === 'ethereum'}
	<ViewGenerationDetailsModal
		bind:open={showGenerationDetailsModal}
		bind:drawerOpen
		{account}
		onClose={() => (showGenerationDetailsModal = false)}
	/>
{/if}

<BackupAccountModal
	bind:open={showBackupModal}
	bind:drawerOpen
	{account}
	onClose={() => (showBackupModal = false)}
/>

<NetworkSettingsModal bind:open={networkSettingsModalOpen} />

<style>
	.account-name-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.drawer {
		position: absolute;
		top: var(--double-padding);
		right: var(--double-padding);
		width: 360px;
		max-height: calc(100dvh - 2 * var(--double-padding));
		background: var(--colors-base);
		border-left: 1px solid var(--colors-low);
		padding: 0;
		overflow-y: auto;
		z-index: 50;
		box-shadow: 0px 4px 12px 4px var(--colors-dark-25);
	}

	.security-warning {
		padding: var(--half-padding);
		border: 1px solid var(--colors-warning, #f59e0b);
		border-radius: 4px;
		background: color-mix(in srgb, var(--colors-warning, #f59e0b) 8%, transparent);
	}

	.security-ok {
		padding: var(--half-padding);
		border: 1px solid var(--colors-green, #22c55e);
		border-radius: 4px;
		background: color-mix(in srgb, var(--colors-green, #22c55e) 8%, transparent);
	}
</style>
