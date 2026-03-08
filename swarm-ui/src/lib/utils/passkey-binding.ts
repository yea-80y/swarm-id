/**
 * Passkey binding for wallet users (Option A)
 *
 * Lets ethereum/Para wallet users authenticate with a device passkey (Touch ID,
 * Face ID, Windows Hello) instead of a wallet popup at session start.
 *
 * The passkey binding is ADDITIVE — it does not replace the wallet. If the user
 * deletes their passkey, they fall back to normal wallet authentication. No data
 * is lost. The wallet can always re-derive the masterKey.
 *
 * See: https://blog.timcappalli.me/p/passkeys-prf-warning/
 * We avoid the "blast radius" problem because PRF is NOT the sole custodian of
 * any data. The wallet, BIP-39 mnemonic, and Swarm backup are all independent
 * recovery paths.
 *
 * Flow:
 *   Setup:   wallet auth → get masterKey → register passkey → PRF(salt) → AES-GCM encrypt → IndexedDB
 *   Use:     passkey auth → PRF(salt) → AES-GCM decrypt → masterKey → derive appSecret + feedSigner
 *   Revoke:  delete from IndexedDB (wallet auth still works)
 *   Recover: wallet → re-derive masterKey → bind a new passkey
 */

import { Bytes } from '@ethersphere/bee-js'

// ============================================================================
// Constants
// ============================================================================

const PRF_SALT_INPUT = 'feed-signer-v1'
const DB_NAME = 'swarm-id-passkey-binding'
const DB_VERSION = 1
const STORE_NAME = 'bindings'

// ============================================================================
// Types
// ============================================================================

interface StoredBinding {
	accountId: string
	credentialId: string
	iv: number[]
	encryptedMasterKey: number[]
}

// ============================================================================
// PRF salt derivation (deterministic, different from passkey account salt)
// ============================================================================

async function generateBindingPRFSalt(): Promise<Uint8Array> {
	const saltBytes = new TextEncoder().encode(PRF_SALT_INPUT)
	const digest = await crypto.subtle.digest('SHA-256', saltBytes)
	return new Uint8Array(digest)
}

// ============================================================================
// Base64url encoding (matching passkey.ts conventions)
// ============================================================================

function bufferToBase64url(buffer: ArrayBuffer | Uint8Array): string {
	const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer
	const base64 = btoa(String.fromCharCode(...bytes))
	return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function base64urlToBuffer(base64url: string): Uint8Array {
	const padding = '='.repeat((4 - (base64url.length % 4)) % 4)
	const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/') + padding
	const binary = atob(base64)
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i)
	}
	return bytes
}

function toUint8Array(buffer: BufferSource): Uint8Array {
	return buffer instanceof ArrayBuffer
		? new Uint8Array(buffer)
		: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
}

// ============================================================================
// IndexedDB
// ============================================================================

function openBindingDB(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION)
		request.onupgradeneeded = (event) => {
			const db = (event.target as IDBOpenDBRequest).result
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME, { keyPath: 'accountId' })
			}
		}
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error)
	})
}

// ============================================================================
// WebAuthn error handling (matching passkey.ts)
// ============================================================================

function handleWebAuthnError(error: unknown): never {
	if (error instanceof DOMException) {
		switch (error.name) {
			case 'NotAllowedError':
				throw new Error('Authentication was cancelled or denied by the user.')
			case 'InvalidStateError':
				throw new Error('This credential is already registered on this device.')
			case 'NotSupportedError':
				throw new Error('Your device does not support the required authentication features.')
			case 'SecurityError':
				throw new Error('Authentication requires HTTPS.')
			case 'AbortError':
				throw new Error('Authentication was aborted.')
			default:
				throw new Error(`Authentication error: ${error.message}`)
		}
	}
	throw error instanceof Error ? error : new Error('Unknown authentication error.')
}

// ============================================================================
// Bind passkey to account (one-time setup)
// ============================================================================

/**
 * Register a new device passkey and encrypt the account's masterKey with it.
 *
 * The user must have already authenticated with their wallet to provide the
 * masterKey. This is a one-time setup step per account.
 *
 * @param accountId  - Account identifier (hex string)
 * @param masterKey  - Account master key (32 bytes, from wallet auth)
 * @param rpId       - Relying party ID (hostname of the identity origin)
 */
export async function bindPasskeyToAccount(
	accountId: string,
	masterKey: Bytes,
	rpId: string,
): Promise<void> {
	const prfSalt = await generateBindingPRFSalt()
	const challenge = new Uint8Array(32)
	crypto.getRandomValues(challenge)

	const publicKeyOptions: PublicKeyCredentialCreationOptions = {
		challenge,
		rp: {
			name: 'Identity — Fast Signing',
			id: rpId,
		},
		user: {
			id: new TextEncoder().encode(`binding-${accountId}`),
			name: `Fast signing (${accountId.slice(0, 8)}…)`,
			displayName: 'Fast signing passkey',
		},
		pubKeyCredParams: [
			{ alg: -7, type: 'public-key' },
			{ alg: -257, type: 'public-key' },
		],
		authenticatorSelection: {
			authenticatorAttachment: 'platform',
			requireResidentKey: true,
			residentKey: 'required',
			userVerification: 'required',
		},
		extensions: {
			prf: {
				eval: { first: prfSalt },
			},
		},
		timeout: 60000,
		attestation: 'none',
	}

	let credential: Credential | null
	try {
		credential = await navigator.credentials.create({ publicKey: publicKeyOptions })
	} catch (error) {
		handleWebAuthnError(error)
	}

	if (!credential || !(credential instanceof PublicKeyCredential)) {
		throw new Error('Failed to create passkey credential')
	}

	const extensionResults = credential.getClientExtensionResults()
	const prfEnabled = extensionResults.prf?.enabled ?? false

	if (!prfEnabled) {
		throw new Error(
			'PRF extension not available. Your device must support Touch ID, Face ID, or Windows Hello.',
		)
	}

	const credentialId = bufferToBase64url(credential.rawId)
	const prfOutput = extensionResults.prf?.results?.first

	if (!prfOutput) {
		throw new Error('PRF output not returned during registration. Please try again.')
	}

	// Derive AES-256-GCM key from PRF output
	const prfBytes = toUint8Array(prfOutput)
	const aesKey = await crypto.subtle.importKey('raw', prfBytes, { name: 'AES-GCM' }, false, [
		'encrypt',
	])

	// Encrypt masterKey
	const iv = new Uint8Array(12)
	crypto.getRandomValues(iv)

	const encryptedBuffer = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv },
		aesKey,
		masterKey.toUint8Array(),
	)

	// Store in IndexedDB
	const record: StoredBinding = {
		accountId,
		credentialId,
		iv: Array.from(iv),
		encryptedMasterKey: Array.from(new Uint8Array(encryptedBuffer)),
	}

	const db = await openBindingDB()
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, 'readwrite')
		const store = tx.objectStore(STORE_NAME)
		const req = store.put(record)
		req.onsuccess = () => resolve()
		req.onerror = () => reject(req.error)
	})
	db.close()
}

// ============================================================================
// Authenticate with bound passkey (session start)
// ============================================================================

/**
 * Authenticate using the bound passkey and decrypt the masterKey.
 *
 * Returns the masterKey, from which the caller derives appSecret + feedSigner
 * through the normal key derivation path.
 *
 * @param accountId - Account identifier (hex string)
 * @param rpId      - Relying party ID (hostname of the identity origin)
 * @returns masterKey (32 bytes) or undefined if no binding exists
 * @throws If passkey auth fails or decryption fails
 */
export async function authenticateWithPasskeyBinding(
	accountId: string,
	rpId: string,
): Promise<Bytes | undefined> {
	const binding = await loadBinding(accountId)
	if (!binding) return undefined

	const prfSalt = await generateBindingPRFSalt()
	const challenge = new Uint8Array(32)
	crypto.getRandomValues(challenge)

	const publicKeyOptions: PublicKeyCredentialRequestOptions = {
		challenge,
		rpId,
		timeout: 60000,
		userVerification: 'required',
		allowCredentials: [
			{
				id: base64urlToBuffer(binding.credentialId),
				type: 'public-key' as const,
				transports: ['internal'] as AuthenticatorTransport[],
			},
		],
		extensions: {
			prf: {
				eval: { first: prfSalt },
			},
		},
	}

	let credential: Credential | null
	try {
		credential = await navigator.credentials.get({ publicKey: publicKeyOptions })
	} catch (error) {
		handleWebAuthnError(error)
	}

	if (!credential || !(credential instanceof PublicKeyCredential)) {
		throw new Error('Passkey authentication failed')
	}

	const extensionResults = credential.getClientExtensionResults()
	const prfOutput = extensionResults.prf?.results?.first

	if (!prfOutput) {
		throw new Error('PRF output not returned. The passkey binding may be corrupted.')
	}

	// Derive same AES key from PRF output
	const prfBytes = toUint8Array(prfOutput)
	const aesKey = await crypto.subtle.importKey('raw', prfBytes, { name: 'AES-GCM' }, false, [
		'decrypt',
	])

	// Decrypt masterKey
	const iv = new Uint8Array(binding.iv)
	const encryptedMasterKey = new Uint8Array(binding.encryptedMasterKey)

	try {
		const decryptedBuffer = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv },
			aesKey,
			encryptedMasterKey,
		)
		return new Bytes(new Uint8Array(decryptedBuffer))
	} catch {
		throw new Error(
			'Failed to decrypt master key. The passkey binding may be corrupted — ' +
				'use your wallet to sign in and re-bind a new passkey.',
		)
	}
}

// ============================================================================
// Query / Remove bindings
// ============================================================================

/**
 * Check whether an account has a passkey binding.
 */
export async function hasPasskeyBinding(accountId: string): Promise<boolean> {
	const binding = await loadBinding(accountId)
	return binding !== undefined
}

/**
 * Remove the passkey binding for an account.
 * The user falls back to normal wallet authentication.
 */
export async function removePasskeyBinding(accountId: string): Promise<void> {
	const db = await openBindingDB()
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, 'readwrite')
		const store = tx.objectStore(STORE_NAME)
		const req = store.delete(accountId)
		req.onsuccess = () => resolve()
		req.onerror = () => reject(req.error)
	})
	db.close()
}

// ============================================================================
// Internal helpers
// ============================================================================

async function loadBinding(accountId: string): Promise<StoredBinding | undefined> {
	const db = await openBindingDB()
	const record = await new Promise<StoredBinding | undefined>((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, 'readonly')
		const store = tx.objectStore(STORE_NAME)
		const req = store.get(accountId)
		req.onsuccess = () => resolve(req.result as StoredBinding | undefined)
		req.onerror = () => reject(req.error)
	})
	db.close()
	return record
}
