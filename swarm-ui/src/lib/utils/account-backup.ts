/**
 * Account backup — write and read to/from Swarm SOC
 *
 * Stores the full account state (masterKey for web3/Para + metadata for all)
 * as an ECIES-encrypted payload in a Swarm Single Owner Chunk (SOC).
 *
 * SOC structure:
 *   owner   = platform secp256k1 key (short-term; migrates to user key in Phase 5)
 *   topic   = keccak256(userEthAddress + "swarm-id/backup/v1")  [32 bytes]
 *   content = JSON(SealedBox) where SealedBox = ECIES_encrypt(X25519, BackupPayload)
 *
 * Why SOC not CAC: SOC address is deterministic from (owner, topic) — findable from
 * the user's ETH address alone, no hash storage needed. CAC requires storing the hash.
 *
 * Discovery on restore:
 *   connect wallet/passkey → derive userEthAddress
 *   → compute topic → compute SOC address (using known platform address)
 *   → fetch from any Swarm gateway → decrypt
 *
 * Batch: platform batch (short-term). UI slot for user batch in Phase 5.
 */

import { Bee, PrivateKey } from '@ethersphere/bee-js'
import type { EthAddress, BatchId } from '@ethersphere/bee-js'
import { keccak256, toUtf8Bytes } from 'ethers'
import { sealJson, openJson } from './ecies'
import type { SealedBox } from './ecies'
import type { BackupKeypair } from './backup-encryption'

// ============================================================================
// Constants
// ============================================================================

const BACKUP_TOPIC_SUFFIX = 'swarm-id/backup/v1'
const BACKUP_PAYLOAD_VERSION = 1

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
	/** Only present for web3/Para accounts — passkey users omit (passkey re-derives) */
	masterKeyHex?: string
	identities: BackupIdentity[]
	connectedApps: BackupConnectedApp[]
	postageStamps: { batchId: string; label?: string }[]
}

export interface BackupWriteResult {
	/** Hex SOC address on Swarm — informational only, not needed for recovery */
	socAddress: string
}

// ============================================================================
// Topic derivation
// ============================================================================

/**
 * Derives the 32-byte SOC topic for a given user ETH address.
 * Deterministic: same address + same suffix → same topic always.
 */
function deriveBackupTopic(userEthAddress: EthAddress): Uint8Array {
	const input = userEthAddress.toHex().toLowerCase() + ':' + BACKUP_TOPIC_SUFFIX
	const hash = keccak256(toUtf8Bytes(input))
	// keccak256 returns 0x-prefixed 32-byte hex → convert to bytes
	return hexToBytes(hash.slice(2))
}

// ============================================================================
// Write
// ============================================================================

/**
 * Encrypt and write the account backup to Swarm as a platform-signed SOC.
 *
 * Call this from the settings page after the user has opted in to backup.
 * Requires: masterKey in session (for web3/Para, to include in payload),
 *           a platform signing key (from env/config), and a valid stamper.
 *
 * @param bee              Bee client
 * @param stamper          Postage stamper (platform batch, short-term)
 * @param platformKey      Platform secp256k1 key — SOC owner/signer
 * @param userEthAddress   User's root ETH address (derives topic)
 * @param payload          Full account state to back up
 * @param keypair          X25519 keypair for encryption (from backup-encryption.ts)
 */
export async function writeAccountBackup(
	bee: Bee,
	stamp: BatchId | string,
	backupSignerKey: PrivateKey,
	userEthAddress: EthAddress,
	payload: BackupPayload,
	keypair: BackupKeypair,
): Promise<BackupWriteResult> {
	const topic = deriveBackupTopic(userEthAddress)

	// ECIES-encrypt the payload to the user's X25519 public key
	const sealedBox: SealedBox = await sealJson(keypair.publicKey, {
		...payload,
		version: BACKUP_PAYLOAD_VERSION,
		timestamp: Date.now(),
	})

	const content = new TextEncoder().encode(JSON.stringify(sealedBox))

	// User signs their own SOC. Platform only signs discovery registry feed (separate).
	const socWriter = bee.makeSOCWriter(backupSignerKey)
	const result = await socWriter.upload(stamp, topic, content)

	return { socAddress: result.toString() }
}

// ============================================================================
// Read
// ============================================================================

/**
 * Fetch and decrypt the account backup from Swarm.
 *
 * Returns undefined if no backup exists or if decryption fails.
 * Call this on first load when localStorage is empty (new device detection).
 *
 * @param bee              Bee client
 * @param platformAddress  Platform's ETH address (SOC owner — must match write side)
 * @param userEthAddress   User's root ETH address (derives topic)
 * @param keypair          X25519 keypair for decryption (same derivation as write)
 */
export async function readAccountBackup(
	bee: Bee,
	platformAddress: EthAddress,
	userEthAddress: EthAddress,
	keypair: BackupKeypair,
): Promise<BackupPayload | undefined> {
	try {
		const topic = deriveBackupTopic(userEthAddress)

		const socReader = bee.makeSOCReader(platformAddress)
		const soc = await socReader.download(topic)
		const content = soc.payload.toUint8Array()

		const sealedBox = JSON.parse(new TextDecoder().decode(content)) as SealedBox
		return await openJson<BackupPayload>(keypair.privateKey, sealedBox)
	} catch {
		// No backup found or decryption failed — not an error for the caller
		return undefined
	}
}

/**
 * Check whether a backup SOC exists for the given user address.
 * Does not decrypt — just checks presence. Useful for showing "Restore" option.
 */
export async function backupExists(
	bee: Bee,
	platformAddress: EthAddress,
	userEthAddress: EthAddress,
): Promise<boolean> {
	try {
		const topic = deriveBackupTopic(userEthAddress)
		const socReader = bee.makeSOCReader(platformAddress)
		await socReader.download(topic)
		return true
	} catch {
		return false
	}
}

// ============================================================================
// Helpers
// ============================================================================

function hexToBytes(hex: string): Uint8Array {
	const bytes = new Uint8Array(hex.length / 2)
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
	}
	return bytes
}
