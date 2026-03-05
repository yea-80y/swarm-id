/**
 * BIP-39 mnemonic backup for passkey accounts
 *
 * The 32-byte masterKey (HKDF output) IS the BIP-39 entropy:
 *   masterKey (32 bytes) → Mnemonic.fromEntropy() → 24 words
 *   24 words → Mnemonic.fromPhrase() → .entropy → same 32 bytes
 *
 * The mnemonic is encrypted with a random AES-GCM device key and stored in
 * IndexedDB (same-origin, not shared across tabs via storage events).
 * The device key is also stored in IndexedDB — the security model is
 * same-origin isolation, not HSM-grade non-extractability.
 */

import { Mnemonic } from 'ethers'
import { Bytes } from '@ethersphere/bee-js'

// ============================================================================
// Mnemonic ↔ Master Key conversion
// ============================================================================

/**
 * Derive a 24-word BIP-39 mnemonic from the 32-byte passkey master key.
 * The master key bytes are used directly as BIP-39 entropy.
 * Recovery: enter the phrase → derive the same master key → same Ethereum address.
 */
export function masterKeyToMnemonic(masterKey: Bytes): string {
	return Mnemonic.fromEntropy(masterKey.toUint8Array()).phrase
}

/**
 * Recover the master key from a 24-word BIP-39 phrase.
 * Returns the same Bytes that were originally used as entropy.
 *
 * @throws If the phrase is invalid or not a 24-word passkey backup phrase
 */
export function mnemonicToMasterKey(phrase: string): Bytes {
	const mnemonic = Mnemonic.fromPhrase(phrase.trim().toLowerCase())
	// mnemonic.entropy is a 0x-prefixed hex string
	const entropyHex = mnemonic.entropy.startsWith('0x')
		? mnemonic.entropy.slice(2)
		: mnemonic.entropy
	if (entropyHex.length !== 64) {
		throw new Error(
			'Recovery phrase must be 24 words (256-bit entropy). This appears to be a 12-word phrase.',
		)
	}
	return new Bytes(entropyHex)
}

// ============================================================================
// IndexedDB storage
// ============================================================================

const DB_NAME = 'swarm-id-passkey-backup'
const DB_VERSION = 1
const STORE_NAME = 'mnemonic-backups'

interface StoredBackup {
	credentialId: string
	deviceKey: number[]
	iv: number[]
	encryptedMnemonic: number[]
}

function openBackupDB(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION)
		request.onupgradeneeded = (event) => {
			const db = (event.target as IDBOpenDBRequest).result
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME, { keyPath: 'credentialId' })
			}
		}
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error)
	})
}

/**
 * Encrypt + store mnemonic backup in IndexedDB, keyed by credentialId.
 * Idempotent: overwrites any existing backup for this credentialId.
 */
export async function storeMnemonicBackup(credentialId: string, masterKey: Bytes): Promise<void> {
	const mnemonic = masterKeyToMnemonic(masterKey)

	// Generate a random device key for AES-GCM
	const deviceKeyBytes = new Uint8Array(32)
	crypto.getRandomValues(deviceKeyBytes)

	const aesKey = await crypto.subtle.importKey('raw', deviceKeyBytes, { name: 'AES-GCM' }, false, [
		'encrypt',
	])

	const iv = new Uint8Array(12)
	crypto.getRandomValues(iv)

	const encryptedBuffer = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv },
		aesKey,
		new TextEncoder().encode(mnemonic),
	)

	const record: StoredBackup = {
		credentialId,
		deviceKey: Array.from(deviceKeyBytes),
		iv: Array.from(iv),
		encryptedMnemonic: Array.from(new Uint8Array(encryptedBuffer)),
	}

	const db = await openBackupDB()
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, 'readwrite')
		const store = tx.objectStore(STORE_NAME)
		const req = store.put(record)
		req.onsuccess = () => resolve()
		req.onerror = () => reject(req.error)
	})
	db.close()
}

/**
 * Load and decrypt the mnemonic backup for a given credentialId.
 * Returns undefined if no backup exists.
 */
export async function loadMnemonicBackup(credentialId: string): Promise<string | undefined> {
	const db = await openBackupDB()
	const record = await new Promise<StoredBackup | undefined>((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, 'readonly')
		const store = tx.objectStore(STORE_NAME)
		const req = store.get(credentialId)
		req.onsuccess = () => resolve(req.result as StoredBackup | undefined)
		req.onerror = () => reject(req.error)
	})
	db.close()

	if (!record) return undefined

	const deviceKeyBytes = new Uint8Array(record.deviceKey)
	const iv = new Uint8Array(record.iv)
	const encryptedMnemonic = new Uint8Array(record.encryptedMnemonic)

	const aesKey = await crypto.subtle.importKey('raw', deviceKeyBytes, { name: 'AES-GCM' }, false, [
		'decrypt',
	])

	const decryptedBuffer = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv },
		aesKey,
		encryptedMnemonic,
	)
	return new TextDecoder().decode(decryptedBuffer)
}

/**
 * Delete the mnemonic backup for a given credentialId (e.g. on account removal).
 */
export async function deleteMnemonicBackup(credentialId: string): Promise<void> {
	const db = await openBackupDB()
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, 'readwrite')
		const store = tx.objectStore(STORE_NAME)
		const req = store.delete(credentialId)
		req.onsuccess = () => resolve()
		req.onerror = () => reject(req.error)
	})
	db.close()
}
