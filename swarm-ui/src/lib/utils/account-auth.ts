import type { Account } from '$lib/types'
import { authenticateWithPasskey } from '$lib/passkey'
import { connectAndSign, deriveEncryptionSeed } from '$lib/ethereum'
import { deriveEncryptionSeedWithPara, ParaSessionExpiredError } from '$lib/para'
import {
	decryptMasterKey,
	deriveEncryptionKey,
	deriveMasterKeyEncryptionKeyFromEIP712,
} from '$lib/utils/encryption'
import { authenticateAgentAccount } from '$lib/agent-account'
import { authenticateWithPasskeyBinding } from '$lib/utils/passkey-binding'
import { keccak256 } from 'ethers'
import { Bytes } from '@ethersphere/bee-js'

export { ParaSessionExpiredError }

/**
 * Error thrown when an agent account requires seed phrase authentication.
 * The caller should show a UI to collect the seed phrase, then call
 * getMasterKeyFromAgentAccount with the collected phrase.
 */
export class SeedPhraseRequiredError extends Error {
	constructor(public readonly accountId: string) {
		super('Seed phrase required for agent account authentication')
		this.name = 'SeedPhraseRequiredError'
	}
}

/**
 * Authenticates an agent account with the provided seed phrase.
 * Use this after catching SeedPhraseRequiredError and collecting the seed phrase from the user.
 */
export function getMasterKeyFromAgentAccount(account: Account, seedPhrase: string): Bytes {
	if (account.type !== 'agent') {
		throw new Error('getMasterKeyFromAgentAccount can only be used with agent accounts')
	}
	const result = authenticateAgentAccount(seedPhrase, account.id)
	return result.masterKey
}

/**
 * Retrieves the master key from an account by authenticating the user.
 *
 * For ethereum/para accounts, tries passkey binding first (Option A — fast
 * biometric auth). Falls back to wallet auth if no binding exists or if the
 * passkey prompt is cancelled.
 *
 * For passkey accounts: Re-authenticates using WebAuthn PRF
 * For ethereum accounts: Passkey binding → wallet fallback
 * For agent accounts: Throws SeedPhraseRequiredError
 */
export async function getMasterKeyFromAccount(account: Account): Promise<Bytes> {
	if (account.type === 'passkey') {
		const swarmIdDomain = window.location.hostname
		const challenge = new Bytes(keccak256(new TextEncoder().encode(swarmIdDomain))).toUint8Array()
		const passkeyAccount = await authenticateWithPasskey({
			rpId: swarmIdDomain,
			challenge,
			allowCredentialIds: [account.credentialId],
		})
		return passkeyAccount.masterKey
	} else if (account.type === 'agent') {
		throw new SeedPhraseRequiredError(account.id.toString())
	} else {
		// Ethereum/Para — try passkey binding first (Option A)
		const bindingResult = await tryPasskeyBinding(account)
		if (bindingResult) return bindingResult

		// Fall back to wallet authentication
		return await getMasterKeyFromWallet(account)
	}
}

/**
 * Authenticate via wallet only, bypassing passkey binding.
 * Used when the caller explicitly needs a wallet interaction
 * (e.g., during passkey binding setup, where we need the wallet
 * to provide the masterKey to encrypt).
 */
export async function getMasterKeyFromWallet(account: Account): Promise<Bytes> {
	if (account.type !== 'ethereum') {
		throw new Error('getMasterKeyFromWallet only works with ethereum accounts')
	}

	if (account.walletProvider === 'para') {
		const encryptionSeed = await deriveEncryptionSeedWithPara()
		const encryptionKey = await deriveMasterKeyEncryptionKeyFromEIP712(
			encryptionSeed,
			account.encryptionSalt,
		)
		return await decryptMasterKey(account.encryptedMasterKey, encryptionKey)
	} else if (account.encryptionScheme === 'eip712') {
		const encryptionSeed = await deriveEncryptionSeed()
		const encryptionKey = await deriveMasterKeyEncryptionKeyFromEIP712(
			encryptionSeed,
			account.encryptionSalt,
		)
		return await decryptMasterKey(account.encryptedMasterKey, encryptionKey)
	} else {
		const signed = await connectAndSign()
		const encryptionKey = await deriveEncryptionKey(signed.publicKey, account.encryptionSalt)
		return await decryptMasterKey(account.encryptedMasterKey, encryptionKey)
	}
}

/**
 * Try passkey binding for ethereum/para accounts.
 * Returns masterKey if binding exists and auth succeeds, undefined otherwise.
 * Silently falls back on any error (cancelled, no binding, corrupted, etc.).
 */
async function tryPasskeyBinding(account: Account): Promise<Bytes | undefined> {
	try {
		const rpId = window.location.hostname
		return await authenticateWithPasskeyBinding(account.id.toString(), rpId)
	} catch {
		return undefined
	}
}
