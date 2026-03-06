<script lang="ts">
	import { Bee } from '@ethersphere/bee-js'
	import Vertical from '$lib/components/ui/vertical.svelte'
	import Horizontal from '$lib/components/ui/horizontal.svelte'
	import Typography from '$lib/components/ui/typography.svelte'
	import Button from '$lib/components/ui/button.svelte'
	import Modal from '$lib/components/ui/modal.svelte'
	import Input from '$lib/components/ui/input/input.svelte'
	import Select from '$lib/components/ui/select/select.svelte'
	import CopyButton from '$lib/components/copy-button.svelte'
	import { Close } from 'carbon-icons-svelte'
	import { identitiesStore } from '$lib/stores/identities.svelte'
	import { connectedAppsStore } from '$lib/stores/connected-apps.svelte'
	import { postageStampsStore } from '$lib/stores/postage-stamps.svelte'
	import { networkSettingsStore } from '$lib/stores/network-settings.svelte'
	import {
		getMasterKeyFromAccount,
		getMasterKeyFromAgentAccount,
		SeedPhraseRequiredError,
	} from '$lib/utils/account-auth'
	import { deriveEncryptionSeed } from '$lib/ethereum'
	import { deriveBackupKeypair } from '$lib/utils/backup-encryption'
	import { writeAccountBackup } from '$lib/utils/account-backup'
	import type { BackupPayload } from '$lib/utils/account-backup'
	import type { Account } from '$lib/types'

	interface Props {
		open: boolean
		drawerOpen: boolean
		account: Account
		onClose: () => void
	}

	let { open = $bindable(false), drawerOpen = $bindable(false), account, onClose }: Props = $props()

	type State = 'loading' | 'ready' | 'working' | 'done' | 'error'
	type BatchItem = { value: string; label: string }

	let phase = $state<State>('loading')
	let batchItems = $state<BatchItem[]>([])
	let selectedBatchId = $state('')
	let manualBatchId = $state('')
	let useManualInput = $state(false)
	let agentSeedPhrase = $state('')
	let reference = $state('')
	let lastBackup = $state<{ reference: string; timestamp: number } | undefined>(undefined)
	let error = $state<string | undefined>(undefined)

	const BACKUP_KEY = $derived(`swarm-id-backup-${account.id.toHex()}`)
	const effectiveBatchId = $derived(useManualInput ? manualBatchId : selectedBatchId)
	const batchIdValid = $derived(/^[0-9a-fA-F]{64}$/.test(effectiveBatchId))
	const canBackup = $derived(
		batchIdValid &&
			(account.type !== 'agent' || agentSeedPhrase.length >= 12) &&
			(phase === 'ready' || phase === 'error'),
	)

	$effect(() => {
		if (open) {
			loadLastBackup()
			fetchStamps()
		}
	})

	function loadLastBackup() {
		const stored = localStorage.getItem(BACKUP_KEY)
		if (stored) {
			try {
				lastBackup = JSON.parse(stored) as { reference: string; timestamp: number }
			} catch {
				lastBackup = undefined
			}
		} else {
			lastBackup = undefined
		}
	}

	async function fetchStamps() {
		phase = 'loading'
		error = undefined
		try {
			const bee = new Bee(networkSettingsStore.beeNodeUrl)
			const batches = await bee.getAllPostageBatch()
			const usable = batches.filter((b) => b.usable)
			batchItems = usable.map((b) => {
				const id = String(b.batchID)
				return { value: id, label: `${id.slice(0, 8)}…${id.slice(-6)}` }
			})
			if (batchItems.length > 0) {
				selectedBatchId = batchItems[0].value
				useManualInput = false
			} else {
				useManualInput = true
			}
		} catch {
			useManualInput = true
		}
		phase = 'ready'
	}

	async function handleBackup() {
		if (!canBackup) return

		try {
			phase = 'working'
			error = undefined

			// Close temporarily so wallet / passkey popups can appear
			open = false
			drawerOpen = false

			let encryptionEntropy: Uint8Array
			let masterKeyHex: string | undefined

			if (account.type === 'ethereum') {
				// Ethereum accounts: two wallet interactions
				// 1. SIWE → masterKey (to include in payload for recovery)
				// 2. EIP-712 → deterministic encryption seed (independent of secretSeed)
				const masterKey = await getMasterKeyFromAccount(account)
				masterKeyHex = masterKey.toHex()

				// EIP-712 signature — wallet already connected, just one more popup
				encryptionEntropy = await deriveEncryptionSeed()
			} else if (account.type === 'agent') {
				const masterKey = getMasterKeyFromAgentAccount(account, agentSeedPhrase)
				masterKeyHex = masterKey.toHex()
				encryptionEntropy = masterKey.toUint8Array()
			} else {
				// Passkey: masterKey is deterministic from PRF — use directly
				const masterKey = await getMasterKeyFromAccount(account)
				encryptionEntropy = masterKey.toUint8Array()
			}

			open = true
			drawerOpen = true

			const keypair = deriveBackupKeypair(encryptionEntropy)

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
				masterKeyHex,
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
			const result = await writeAccountBackup(bee, effectiveBatchId, payload, keypair)

			reference = result.reference
			lastBackup = { reference: result.reference, timestamp: Date.now() }
			localStorage.setItem(BACKUP_KEY, JSON.stringify(lastBackup))
			phase = 'done'
		} catch (err) {
			if (err instanceof SeedPhraseRequiredError) {
				open = true
				drawerOpen = true
				phase = 'ready'
				return
			}
			error = err instanceof Error ? err.message : 'Backup failed. Please try again.'
			phase = 'error'
			open = true
			drawerOpen = true
		}
	}

	function handleClose() {
		phase = 'ready'
		error = undefined
		agentSeedPhrase = ''
		onClose()
	}

	function formatDate(ts: number) {
		return new Date(ts).toLocaleString()
	}

	function truncate(ref: string) {
		return `${ref.slice(0, 10)}…${ref.slice(-8)}`
	}
</script>

<Modal bind:open oncancel={handleClose}>
	<Vertical --vertical-gap="var(--padding)" style="padding: var(--padding)">
		<Horizontal --horizontal-justify-content="space-between" --horizontal-align-items="center">
			<Typography variant="h5">Backup Account</Typography>
			<Button variant="ghost" dimension="compact" onclick={handleClose}><Close size={24} /></Button>
		</Horizontal>

		<Typography variant="small">
			Encrypts your account data and uploads it to Swarm. Save the resulting hash — it is the only
			way to restore your account on a new device.
		</Typography>

		{#if lastBackup}
			<Vertical --vertical-gap="var(--quarter-padding)">
				<Typography variant="small" style="color: var(--colors-medium)">
					Last backup: {formatDate(lastBackup.timestamp)}
				</Typography>
				<Horizontal --horizontal-gap="var(--half-padding)" --horizontal-align-items="center">
					<Typography variant="small" font="mono">{truncate(lastBackup.reference)}</Typography>
					<CopyButton text={lastBackup.reference} />
				</Horizontal>
			</Vertical>
		{/if}

		{#if phase !== 'done'}
			<Vertical --vertical-gap="var(--half-padding)">
				{#if phase === 'loading'}
					<Typography variant="small">Fetching available stamps…</Typography>
				{:else if !useManualInput && batchItems.length > 0}
					<Select
						label="Postage stamp"
						dimension="compact"
						variant="outline"
						items={batchItems}
						bind:value={selectedBatchId}
					/>
					<Button
						variant="ghost"
						dimension="compact"
						onclick={() => (useManualInput = true)}
						style="align-self: flex-start"
					>
						Enter batch ID manually
					</Button>
				{:else}
					<Input
						label="Batch ID (64-char hex)"
						variant="outline"
						dimension="compact"
						placeholder="0000…0000"
						bind:value={manualBatchId}
					/>
					{#if batchItems.length > 0}
						<Button
							variant="ghost"
							dimension="compact"
							onclick={() => (useManualInput = false)}
							style="align-self: flex-start"
						>
							Choose from available stamps
						</Button>
					{/if}
				{/if}

				{#if account.type === 'agent'}
					<Input
						label="Seed phrase"
						variant="outline"
						dimension="compact"
						type="password"
						placeholder="Enter your BIP-39 seed phrase"
						bind:value={agentSeedPhrase}
					/>
				{/if}
			</Vertical>
		{/if}

		{#if phase === 'done'}
			<Vertical --vertical-gap="var(--half-padding)">
				<Typography style="color: var(--colors-green)">Backup complete.</Typography>
				<Typography variant="small">
					Store this hash securely. Without it you cannot recover this account.
				</Typography>
				<Horizontal --horizontal-gap="var(--half-padding)" --horizontal-align-items="center">
					<Input
						variant="outline"
						dimension="compact"
						value={reference}
						class="grower"
						label="Swarm backup hash"
						disabled
					/>
					<div style="border: 1px solid transparent">
						<CopyButton text={reference} />
					</div>
				</Horizontal>
			</Vertical>
		{/if}

		{#if error}
			<Typography style="color: var(--colors-red)">{error}</Typography>
		{/if}

		<Horizontal --horizontal-gap="var(--half-padding)" --horizontal-justify-content="start">
			{#if phase !== 'done'}
				<Button
					dimension="compact"
					variant="strong"
					onclick={handleBackup}
					disabled={!canBackup || phase === 'working'}
				>
					{phase === 'working' ? 'Backing up…' : lastBackup ? 'Update backup' : 'Create backup'}
				</Button>
			{/if}
			<Button
				dimension="compact"
				variant={phase === 'done' ? 'strong' : 'ghost'}
				onclick={handleClose}
			>
				Close
			</Button>
		</Horizontal>
	</Vertical>
</Modal>
