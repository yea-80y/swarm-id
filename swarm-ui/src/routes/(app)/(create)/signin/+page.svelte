<script lang="ts">
	import { goto } from '$app/navigation'
	import { resolve } from '$app/paths'
	import CreationLayout from '$lib/components/creation-layout.svelte'
	import Vertical from '$lib/components/ui/vertical.svelte'
	import Horizontal from '$lib/components/ui/horizontal.svelte'
	import Typography from '$lib/components/ui/typography.svelte'
	import Button from '$lib/components/ui/button.svelte'
	import ErrorMessage from '$lib/components/ui/error-message.svelte'
	import PasskeyLogo from '$lib/components/passkey-logo.svelte'
	import EthereumLogo from '$lib/components/ethereum-logo.svelte'
	import Divider from '$lib/components/ui/divider.svelte'
	import routes from '$lib/routes'
	import { sessionStore } from '$lib/stores/session.svelte'
	import { accountsStore } from '$lib/stores/accounts.svelte'
	import { authenticateWithPasskey } from '$lib/passkey'
	import { deriveAccountSwarmEncryptionKey } from '@swarm-id/lib'

	let isAuthenticating = $state(false)
	let error = $state<string | undefined>(undefined)

	/**
	 * Passkey sign-in: authenticate with any synced credential.
	 * If the account is already in localStorage, restore session.
	 * If not (e.g. incognito / new device), create the account record.
	 */
	async function handlePasskeySignIn() {
		try {
			isAuthenticating = true
			error = undefined

			const result = await authenticateWithPasskey({ rpId: window.location.hostname })

			let account = accountsStore.accounts.find((a) => a.id.equals(result.ethereumAddress))
			const isNewOnThisDevice = !account

			if (!account) {
				// First time on this device — create account record from passkey
				const swarmEncryptionKey = await deriveAccountSwarmEncryptionKey(result.masterKey.toHex())
				account = accountsStore.addAccount({
					id: result.ethereumAddress,
					name: 'Passkey Account',
					createdAt: Date.now(),
					type: 'passkey',
					credentialId: result.credentialId,
					swarmEncryptionKey,
				})
			}

			sessionStore.setAccount(account)
			sessionStore.setCurrentAccount(account.id.toHex())
			sessionStore.setTemporaryMasterKey(result.masterKey)

			if (sessionStore.data.appOrigin) {
				goto(resolve(routes.CONNECT))
			} else if (isNewOnThisDevice) {
				// No data on this device for this passkey — guide them to create an identity
				// or restore from Swarm backup rather than showing a blank home screen
				goto(resolve(routes.IDENTITY_NEW))
			} else {
				goto(resolve(routes.HOME))
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Passkey authentication failed'
			isAuthenticating = false
		}
	}
</script>

<CreationLayout
	title="Sign in"
	description="Access your existing Swarm ID account"
	onClose={() => goto(resolve(routes.ACCOUNT_NEW))}
>
	{#snippet content()}
		<Vertical --vertical-gap="var(--padding)">
			<!-- Passkey -->
			<Vertical --vertical-gap="var(--half-padding)">
				<Horizontal --horizontal-gap="var(--half-padding)" --horizontal-align-items="center">
					<PasskeyLogo fill="var(--colors-ultra-high)" width={24} height={24} />
					<Typography>Sign in with Passkey</Typography>
				</Horizontal>
				<Typography variant="small" style="color: var(--colors-medium)">
					Use your synced passkey (iCloud, Google Password Manager, or hardware key). Works on any
					device where your passkey is available.
				</Typography>
				<Button
					dimension="compact"
					variant="strong"
					onclick={handlePasskeySignIn}
					disabled={isAuthenticating}
				>
					{isAuthenticating ? 'Authenticating…' : 'Continue with Passkey'}
				</Button>
				{#if error}
					<ErrorMessage>{error}</ErrorMessage>
				{/if}
			</Vertical>

			<Divider />

			<!-- Ethereum -->
			<Vertical --vertical-gap="var(--half-padding)">
				<Horizontal --horizontal-gap="var(--half-padding)" --horizontal-align-items="center">
					<EthereumLogo fill="var(--colors-ultra-high)" width={24} height={24} />
					<Typography>Sign in with Ethereum wallet</Typography>
				</Horizontal>
				<Typography variant="small" style="color: var(--colors-medium)">
					Re-derive your account using your wallet and the secret seed you chose at creation.
				</Typography>
				<Button
					dimension="compact"
					variant="ghost"
					onclick={() => goto(resolve(routes.ETH_RECOVER))}
				>
					Continue with wallet + secret seed
				</Button>
			</Vertical>

			<Divider />

			<!-- Swarm backup -->
			<Vertical --vertical-gap="var(--half-padding)">
				<Typography>Restore from Swarm backup</Typography>
				<Typography variant="small" style="color: var(--colors-medium)">
					Enter a backup hash to restore your account and identities from an encrypted Swarm backup.
				</Typography>
				<Button
					dimension="compact"
					variant="ghost"
					onclick={() => goto(resolve(routes.BACKUP_RECOVER))}
				>
					Restore from backup hash
				</Button>
			</Vertical>
		</Vertical>
	{/snippet}

	{#snippet buttonContent()}
		<Button dimension="compact" variant="ghost" onclick={() => goto(resolve(routes.ACCOUNT_NEW))}>
			Create new account instead
		</Button>
	{/snippet}
</CreationLayout>
