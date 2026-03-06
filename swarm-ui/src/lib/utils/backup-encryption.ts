/**
 * Backup encryption key derivation — Phase 4
 *
 * Derives two keys from a 32-byte entropy seed via HKDF domain separation:
 *
 *   HKDF(entropy, "swarm-id/backup-enc/v1")    → X25519 private key  (ECIES payload encryption)
 *   HKDF(entropy, "swarm-id/backup-signer/v1") → secp256k1 private key (backup SOC owner/signer)
 *
 * The entropy source differs by account type — the derivation is identical:
 *
 * Passkey users:
 *   entropy = masterKey (32 bytes from passkey PRF → HKDF)
 *   Already in session after passkey auth. No wallet popup needed.
 *
 * Web3 / Para wallet users:
 *   entropy = hexToBytes(podSeedHex)
 *   podSeed = keccak256(EIP-712 "DerivePodIdentity" signature, fixed nonce)
 *   This is the same seed WoCo already uses for ed25519 POD signing and attendee
 *   data encryption (via HKDF "woco/encryption/v1"). No extra wallet popup:
 *   the seed is cached in IndexedDB from initial POD identity setup
 *   (restorePodSeed()), or re-derived with one popup if not cached.
 *
 * Why this is secure:
 *   - HKDF with distinct info strings is cryptographically independent: knowing
 *     one derived key tells you nothing about the others or the seed.
 *   - secp256k1 from 32 HKDF bytes: valid. @noble/curves handles the negligible
 *     edge case where bytes ≥ curve order (probability ≈ 4 × 10⁻³⁸).
 *   - X25519 clamping is applied internally by @noble/curves at use time.
 *   - Same security model as BIP-32: seed compromise = all children compromised,
 *     but child compromise does not reveal seed or siblings.
 *
 * No circular dependency on restore:
 *   Web3/Para: wallet → POD identity EIP-712 → podSeed → backup signer address
 *     → find SOC on Swarm → decrypt payload → restore account. No masterKey needed
 *     to locate the SOC.
 *   Passkey: passkey PRF → masterKey → backup signer address → find SOC → restore.
 */

import { x25519 } from '@noble/curves/ed25519'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'
import { PrivateKey } from '@ethersphere/bee-js'

// ============================================================================
// Constants
// ============================================================================

const BACKUP_ENC_INFO = new TextEncoder().encode('swarm-id/backup-enc/v1')
const BACKUP_SIGNER_INFO = new TextEncoder().encode('swarm-id/backup-signer/v1')

// ============================================================================
// Types
// ============================================================================

export interface BackupKeypair {
	/** X25519 private key (32 bytes) — keep in memory only, never persist */
	privateKey: Uint8Array
	/** X25519 public key (32 bytes) — safe to share, used as ECIES recipient key */
	publicKey: Uint8Array
}

// ============================================================================
// Derivation
// ============================================================================

/**
 * Derive the X25519 keypair used to ECIES-encrypt the backup payload.
 *
 * @param entropy  32-byte seed:
 *   - passkey users:    masterKey (from passkey PRF)
 *   - web3/Para users:  hexToBytes(podSeedHex) from restorePodSeed()
 */
export function deriveBackupKeypair(entropy: Uint8Array): BackupKeypair {
	const privateKey = hkdf(sha256, entropy, new Uint8Array(0), BACKUP_ENC_INFO, 32)
	const publicKey = x25519.getPublicKey(privateKey)
	return { privateKey, publicKey }
}

/**
 * Derive the secp256k1 key that OWNS and SIGNS the user's backup SOC.
 *
 * User controls their backup SOC from day one. Platform never signs it.
 * Platform only signs a separate discovery registry feed.
 *
 * The SOC owner address = deriveBackupSigner(entropy).publicKey().address().
 * This address is computable without masterKey for web3/Para users (use podSeed),
 * which avoids the circular dependency: "need masterKey to find SOC that holds masterKey".
 *
 * @param entropy  Same 32-byte seed as deriveBackupKeypair.
 */
export function deriveBackupSigner(entropy: Uint8Array): PrivateKey {
	const keyBytes = hkdf(sha256, entropy, new Uint8Array(0), BACKUP_SIGNER_INFO, 32)
	return new PrivateKey(keyBytes)
}
