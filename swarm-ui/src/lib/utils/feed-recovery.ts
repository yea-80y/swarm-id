/**
 * Feed signer recovery on Swarm — Option A
 *
 * Seals the user's secp256k1 feed signer private key using X25519 ECIES
 * then uploads the sealed box as encrypted data to a Swarm epoch feed.
 *
 * Recovery flow:
 *   1. Re-derive masterKey (wallet re-auth + secretSeed for ethereum users)
 *   2. Re-derive X25519 recovery keypair from masterKey (deterministic)
 *   3. Read reference from Swarm epoch feed
 *   4. Download + decrypt → parse sealed box
 *   5. open(x25519PrivKey, sealedBox) → feed signer private key
 *
 * Passkey users are covered by the BIP-39 mnemonic backup (Phase 1).
 * This Option A path is primarily for web3 / ethereum / Para users.
 *
 * Topic: "swarm-id-feed-recovery-v1:{ethAddress.toHex()}"
 */

import { Bee, PrivateKey, Topic, Reference, Bytes } from '@ethersphere/bee-js'
import type { EthAddress } from '@ethersphere/bee-js'
import type { Stamper } from '@ethersphere/bee-js'
import {
	BasicEpochUpdater,
	AsyncEpochFinder,
	deriveSecret,
	hexToUint8Array,
	uploadEncryptedDataWithSigning,
} from '@swarm-id/lib'
import { sealJson, openJson } from './ecies'
import { deriveFeedRecoveryX25519 } from './feed-signer'
import type { FeedSignerResult } from './feed-signer'
import type { SealedBox } from './ecies'

// ============================================================================
// Constants
// ============================================================================

export const FEED_RECOVERY_TOPIC_PREFIX = 'swarm-id-feed-recovery-v1:'

// ============================================================================
// Types
// ============================================================================

export interface FeedRecoveryPayload {
	/** secp256k1 feed signer private key (64-char hex) */
	feedSignerKey: string
	/** Ethereum address of the feed signer */
	feedSignerAddress: string
	/** BIP-44 derivation path (if applicable) */
	path?: string
	/** Unix ms timestamp when written */
	timestamp: number
}

// ============================================================================
// Helpers
// ============================================================================

function makeRecoveryTopic(ethAddress: EthAddress): Topic {
	return Topic.fromString(`${FEED_RECOVERY_TOPIC_PREFIX}${ethAddress.toHex()}`)
}

async function deriveBackupKey(swarmEncryptionKey: string): Promise<PrivateKey> {
	const hex = await deriveSecret(swarmEncryptionKey, 'backup-key')
	return new PrivateKey(hex)
}

// ============================================================================
// Write
// ============================================================================

/**
 * Seal and write the feed signer to a Swarm recovery feed.
 *
 * Requires an active postage stamper. Call this from the settings page
 * when both masterKey (in session) and a valid stamp are available.
 *
 * @param bee                - Bee client
 * @param stamper            - Postage stamper
 * @param feedSigner         - The feed signer to back up
 * @param masterKey          - Account master key (derives the X25519 keypair)
 * @param swarmEncryptionKey - 64-char hex Swarm encryption key
 * @param ethAddress         - Account Ethereum address (used as feed topic)
 */
export async function writeFeedRecovery(
	bee: Bee,
	stamper: Stamper,
	feedSigner: FeedSignerResult,
	masterKey: Bytes,
	swarmEncryptionKey: string,
	ethAddress: EthAddress,
): Promise<string> {
	// 1. Derive X25519 encryption keypair from masterKey
	const { publicKey } = deriveFeedRecoveryX25519(masterKey)

	// 2. Seal the feed signer payload
	const payload: FeedRecoveryPayload = {
		feedSignerKey: feedSigner.privateKey.toHex(),
		feedSignerAddress: feedSigner.address.toHex(),
		path: feedSigner.path,
		timestamp: Date.now(),
	}
	const sealedBox = await sealJson(publicKey, payload)

	// 3. Encrypt + upload the sealed box bytes to Swarm
	//    (double-encrypted: ECIES on the content + Swarm encryption on the chunks)
	const sealedBytes = new TextEncoder().encode(JSON.stringify(sealedBox))
	const encryptionKey = hexToUint8Array(swarmEncryptionKey)
	const uploadResult = await uploadEncryptedDataWithSigning(
		{ bee, stamper },
		sealedBytes,
		encryptionKey,
	)

	// 4. Update the epoch feed owned by the backup key
	const backupKey = await deriveBackupKey(swarmEncryptionKey)
	const topic = makeRecoveryTopic(ethAddress)
	const updater = new BasicEpochUpdater(bee, topic, backupKey)
	const feedTimestamp = BigInt(Math.floor(Date.now() / 1000))
	const refBytes = new Reference(uploadResult.reference).toUint8Array()

	await updater.update(feedTimestamp, refBytes, stamper)

	return uploadResult.reference
}

// ============================================================================
// Read
// ============================================================================

/**
 * Read and decrypt the feed signer from the Swarm recovery feed.
 *
 * Returns undefined if no recovery feed exists or on any error.
 *
 * @param bee                - Bee client
 * @param ethAddress         - Account Ethereum address
 * @param masterKey          - Account master key (for X25519 decryption)
 * @param swarmEncryptionKey - 64-char hex Swarm encryption key (for backup key)
 */
export async function readFeedRecovery(
	bee: Bee,
	ethAddress: EthAddress,
	masterKey: Bytes,
	swarmEncryptionKey: string,
): Promise<FeedRecoveryPayload | undefined> {
	try {
		// 1. Derive keys
		const { privateKey } = deriveFeedRecoveryX25519(masterKey)
		const backupKey = await deriveBackupKey(swarmEncryptionKey)
		const owner = backupKey.publicKey().address()
		const topic = makeRecoveryTopic(ethAddress)

		// 2. Find the latest epoch feed update
		const now = BigInt(Math.floor(Date.now() / 1000))
		const finder = new AsyncEpochFinder(bee, topic, owner)
		const refBytes = await finder.findAt(now)
		if (!refBytes) return undefined

		// 3. Download the encrypted blob
		const refHex = Array.from(refBytes)
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('')
		const rawBytes = await bee.downloadData(refHex)

		// 4. Decrypt the Swarm-side encryption
		//    The uploadEncryptedDataWithSigning uses bee-js encrypted references (64 bytes).
		//    The raw download of an encrypted reference returns the decrypted data.
		//    bee.downloadData() handles the decryption transparently for encrypted refs.

		// 5. Parse and open the sealed box
		const sealedBox = JSON.parse(new TextDecoder().decode(rawBytes.toUint8Array())) as SealedBox
		return await openJson<FeedRecoveryPayload>(privateKey, sealedBox)
	} catch (error) {
		console.warn('[FeedRecovery] Failed to read recovery feed:', error)
		return undefined
	}
}
