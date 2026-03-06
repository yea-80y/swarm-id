/**
 * Account backup — write and read to/from Swarm
 *
 * Stores the full account state as an ECIES-encrypted blob uploaded as a
 * plain content-addressed chunk (bee.uploadData). No SOC signer needed —
 * security comes entirely from the X25519 ECIES encryption, not from chunk
 * ownership. The returned Swarm hash is logged and stored externally.
 *
 * Flow:
 *   deriveBackupKeypair(entropy) → X25519 keypair
 *   → ECIES encrypt payload → bee.uploadData() → hash
 *   → log hash (show to user / store in platform registry)
 *
 * Recovery:
 *   have hash + entropy → re-derive X25519 → fetch hash → decrypt
 *
 * Hash storage (short-term): shown to user + platform discovery registry feed.
 * Hash storage (medium-term): sub-ENS text record.
 */

import { Bee } from '@ethersphere/bee-js'
import type { BatchId } from '@ethersphere/bee-js'
import { sealJson, openJson } from './ecies'
import type { SealedBox } from './ecies'
import type { BackupKeypair } from './backup-encryption'

// ============================================================================
// Types
// ============================================================================

export interface BackupIdentity {
	id: string
	accountId: string
	name: string
	createdAt: number
	feedSignerAddress?: string
	defaultPostageStampBatchID?: string
}

export interface BackupConnectedApp {
	appUrl: string
	appName: string
	identityId: string
	appSecret: string
	connectedUntil: number
}

export interface BackupPayload {
	version: number
	timestamp: number
	/** Only present for web3/Para accounts — passkey re-derives from PRF */
	masterKeyHex?: string
	identities: BackupIdentity[]
	connectedApps: BackupConnectedApp[]
	postageStamps: { batchId: string; label?: string }[]
}

export interface BackupWriteResult {
	/** Swarm content-addressed hash (64-char hex) — log this for retrieval */
	reference: string
}

// ============================================================================
// Write
// ============================================================================

/**
 * Encrypt and upload the account backup to Swarm.
 *
 * The chunk is content-addressed — no signer needed. The returned hash is
 * the only way to retrieve the backup; log it or store it in a registry feed.
 *
 * @param bee      Bee client
 * @param stamp    Postage stamp batch ID
 * @param payload  Full account state to back up
 * @param keypair  X25519 keypair for encryption (from deriveBackupKeypair)
 */
export async function writeAccountBackup(
	bee: Bee,
	stamp: BatchId | string,
	payload: BackupPayload,
	keypair: BackupKeypair,
): Promise<BackupWriteResult> {
	const sealedBox: SealedBox = await sealJson(keypair.publicKey, {
		...payload,
		version: 1,
		timestamp: Date.now(),
	})

	const data = new TextEncoder().encode(JSON.stringify(sealedBox))
	const result = await bee.uploadData(stamp, data)

	return { reference: result.reference.toString() }
}

// ============================================================================
// Read
// ============================================================================

/**
 * Fetch and decrypt the account backup from Swarm.
 *
 * Returns undefined if the hash is not found or decryption fails.
 *
 * @param bee      Bee client
 * @param reference  Swarm hash returned by writeAccountBackup
 * @param keypair  X25519 keypair for decryption (same derivation as write)
 */
export async function readAccountBackup(
	bee: Bee,
	reference: string,
	keypair: BackupKeypair,
): Promise<BackupPayload | undefined> {
	try {
		const data = await bee.downloadData(reference)
		const sealedBox = JSON.parse(new TextDecoder().decode(data.toUint8Array())) as SealedBox
		return await openJson<BackupPayload>(keypair.privateKey, sealedBox)
	} catch {
		return undefined
	}
}

/**
 * Check whether a backup exists at the given Swarm hash.
 * Does not decrypt — just checks presence.
 */
export async function backupExists(bee: Bee, reference: string): Promise<boolean> {
	try {
		await bee.downloadData(reference)
		return true
	} catch {
		return false
	}
}
