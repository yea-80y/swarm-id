<script lang="ts">
	import { goto } from '$app/navigation'
	import { resolve } from '$app/paths'
	import Typography from '$lib/components/ui/typography.svelte'
	import Button from '$lib/components/ui/button.svelte'
	import Input from '$lib/components/ui/input/input.svelte'
	import Select from '$lib/components/ui/select/select.svelte'
	import WorkflowAutomation from 'carbon-icons-svelte/lib/WorkflowAutomation.svelte'
	import ArrowRight from 'carbon-icons-svelte/lib/ArrowRight.svelte'
	import ErrorMessage from '$lib/components/ui/error-message.svelte'
	import CreationLayout from '$lib/components/creation-layout.svelte'
	import Vertical from '$lib/components/ui/vertical.svelte'
	import Horizontal from '$lib/components/ui/horizontal.svelte'
	import GenerateSeedModal from '$lib/components/generate-seed-modal.svelte'
	import routes from '$lib/routes'
	import { sessionStore } from '$lib/stores/session.svelte'
	import { accountsStore } from '$lib/stores/accounts.svelte'
	import { para, connectAndSignWithPara, deriveEncryptionSeedWithPara } from '$lib/para'
	import { deriveMasterKey } from '$lib/ethereum'
	import { validateSecretSeed } from '$lib/utils/secret-seed'
	import { EthAddress } from '@ethersphere/bee-js'
	import {
		generateEncryptionSalt,
		deriveMasterKeyEncryptionKeyFromEIP712,
		encryptMasterKey,
		deriveSecretSeedEncryptionKeyFromEIP712,
		encryptSecretSeed,
	} from '$lib/utils/encryption'
	import { deriveAccountSwarmEncryptionKey } from '@swarm-id/lib'
	import type { AccountSyncType } from '$lib/types'
	import { onMount } from 'svelte'

	type Phase = 'input' | 'authenticating' | 'processing'

	let phase = $state<Phase>('input')
	let accountName = $state('Para')
	let accountType = $state<AccountSyncType>('local')
	let email = $state('')
	let secretSeed = $state('')
	let error = $state<string | undefined>(undefined)
	let loginUrl = $state<string | undefined>(undefined)
	let isNewUser = $state(false)
	let canceled = $state(false)
	let showSeedModal = $state(false)

	const accountTypeItems = [
		{ value: 'local', label: 'Local' },
		{ value: 'synced', label: 'Synced' },
	]

	onMount(() => {
		const taken = accountsStore.accounts.some((a) => a.name === accountName)
		if (taken) {
			accountName = `${accountName} ${accountsStore.accounts.filter((a) => a.type === 'ethereum').length + 1}`
		}
	})

	const secretSeedError = $derived.by(() => {
		if (!secretSeed) return undefined
		if (!validateSecretSeed(secretSeed)) {
			return 'Use 20 to 128 characters with a mix of uppercase letters, lowercase letters, numbers, and special characters.'
		}
		return undefined
	})

	const isFormDisabled = $derived(
		!accountName || !email || !secretSeed || !!secretSeedError || phase !== 'input',
	)

	async function handleStartAuth() {
		if (isFormDisabled) return

		try {
			phase = 'authenticating'
			error = undefined
			canceled = false
			loginUrl = undefined

			const authState = await para.signUpOrLogIn({ auth: { email } })

			if (authState.stage !== 'verify' || !authState.loginUrl) {
				throw new Error('Unexpected Para auth state: ' + authState.stage)
			}

			isNewUser = authState.nextStage === 'signup'
			loginUrl = authState.loginUrl

			if (isNewUser) {
				await para.waitForWalletCreation({ isCanceled: () => canceled })
			} else {
				await para.waitForLogin({ isCanceled: () => canceled })
			}

			await handleParaAuthenticated()
		} catch (err) {
			if (canceled) {
				phase = 'input'
				return
			}
			error = err instanceof Error ? err.message : 'Para authentication failed'
			phase = 'input'
		}
	}

	async function handleParaAuthenticated() {
		phase = 'processing'
		try {
			const signed = await connectAndSignWithPara()
			const encryptionSeed = await deriveEncryptionSeedWithPara()

			const { masterKey, masterAddress } = deriveMasterKey(secretSeed, signed.publicKey)
			const swarmEncryptionKey = await deriveAccountSwarmEncryptionKey(masterKey.toHex())
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

			const newAccount = accountsStore.addAccount({
				id: masterAddress,
				createdAt: Date.now(),
				name: accountName.trim(),
				type: 'ethereum',
				ethereumAddress: new EthAddress(signed.address),
				encryptedMasterKey,
				encryptionSalt,
				encryptedSecretSeed,
				swarmEncryptionKey,
				encryptionScheme: 'eip712',
				walletProvider: 'para',
			})

			sessionStore.setAccount(newAccount)
			sessionStore.setSyncedCreation(accountType === 'synced')
			sessionStore.setTemporaryMasterKey(masterKey)
			goto(resolve(routes.IDENTITY_NEW))
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to create account'
			phase = 'input'
		}
	}

	function handleCancel() {
		canceled = true
		phase = 'input'
		loginUrl = undefined
	}
</script>

{#if phase === 'authenticating' && loginUrl}
	<div class="para-auth-wrapper">
		<iframe src={loginUrl} title="Para authentication" class="para-frame"></iframe>
		<div class="para-cancel">
			<Button dimension="compact" variant="ghost" onclick={handleCancel}>Cancel</Button>
		</div>
	</div>
{:else}
	<CreationLayout
		title="Sign up with Para"
		description="Create a Swarm ID account using your Para email wallet"
		onClose={() =>
			sessionStore.data.appOrigin ? goto(resolve(routes.CONNECT)) : goto(resolve(routes.HOME))}
	>
		{#snippet content()}
			<Vertical --vertical-gap="var(--padding)">
				<div class="form-row">
					<div class="form-field">
						<Input
							variant="outline"
							dimension="compact"
							label="Account name"
							bind:value={accountName}
							disabled={phase === 'processing'}
						/>
					</div>
					<div class="form-field">
						<Select
							variant="outline"
							dimension="compact"
							label="Account type"
							bind:value={accountType}
							items={accountTypeItems}
						/>
					</div>
				</div>

				<Input
					variant="outline"
					dimension="compact"
					label="Email address"
					type="email"
					placeholder="your@email.com"
					bind:value={email}
					disabled={phase === 'processing'}
				/>

				<Vertical --vertical-gap="var(--quarter-padding)">
					<Typography>Secret seed</Typography>
					<Horizontal --horizontal-gap="var(--half-padding)">
						<div style="flex: 1">
							<Input
								variant="outline"
								dimension="compact"
								bind:value={secretSeed}
								error={secretSeedError}
								disabled={phase === 'processing'}
							/>
						</div>
						<Button
							dimension="compact"
							variant="ghost"
							onclick={() => (showSeedModal = true)}
							disabled={phase === 'processing'}
						>
							<WorkflowAutomation size={20} />
						</Button>
					</Horizontal>
					{#if secretSeedError}
						<ErrorMessage>{secretSeedError}</ErrorMessage>
					{:else}
						<Typography variant="small" class="accent">
							Generate one with the button above or use your own. Store it securely — you need it to
							recover your account without a Swarm backup.
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
				onclick={handleStartAuth}
				disabled={isFormDisabled}
				class="mobile-full-width"
			>
				{phase === 'processing' ? 'Creating account…' : 'Continue with Para'}
				{#if phase === 'input'}
					<span class="mobile-only"><ArrowRight size={20} /></span>
				{/if}
			</Button>
		{/snippet}
	</CreationLayout>
{/if}

<GenerateSeedModal bind:open={showSeedModal} onUseSeed={(seed) => (secretSeed = seed)} />

<style>
	.para-auth-wrapper {
		display: flex;
		flex-direction: column;
		height: 100dvh;
		padding: var(--padding);
		gap: var(--half-padding);
	}

	.para-frame {
		flex: 1;
		width: 100%;
		border: 1px solid var(--colors-low);
		border-radius: 4px;
		min-height: 400px;
	}

	.para-cancel {
		display: flex;
		justify-content: center;
	}

	.form-row {
		display: flex;
		gap: var(--half-padding);
		align-items: flex-end;
	}

	.form-field {
		flex: 1;
		min-width: 0;
	}

	.mobile-only {
		display: none;
	}

	@media screen and (max-width: 640px) {
		.form-row {
			flex-wrap: wrap;
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
