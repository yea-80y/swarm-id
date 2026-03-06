/**
 * Backup encryption key derivation — Phase 4
 *
 * Derives an X25519 keypair from a 32-byte entropy seed via HKDF.
 * Used to ECIES-encrypt the backup payload before uploading to Swarm.
 *
 * The encrypted blob is uploaded as a plain content-addressed chunk
 * (bee.uploadData). No SOC signer needed — security comes entirely
 * from the encryption, not from who owns the chunk. The returned
 * Swarm hash is logged and stored externally for retrieval.
 *
 * Entropy source by account type:
 *
 * Passkey users:
 *   entropy = masterKey (32 bytes from passkey PRF → HKDF)
 *   Already in session — no wallet popup needed.
 *
 * Web3 / Para wallet users:
 *   entropy = hexToBytes(podSeedHex)
 *   podSeed = keccak256(EIP-712 "DerivePodIdentity" signature, fixed nonce)
 *   Same seed WoCo uses for ed25519 POD signing. Re-derived on demand
 *   from wallet — not stored. One popup per backup operation.
 *
 * Security:
 *   HKDF with a unique info string produces a key that is cryptographically
 *   independent of any other key derived from the same seed (e.g. ed25519,
 *   woco/encryption/v1). Knowing this X25519 key reveals nothing about the seed.
 *   X25519 clamping applied internally by @noble/curves at use time.
 */

import { x25519 } from '@noble/curves/ed25519'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'

const BACKUP_ENC_INFO = new TextEncoder().encode('swarm-id/backup-enc/v1')

export interface BackupKeypair {
	/** X25519 private key (32 bytes) — keep in memory only, never persist */
	privateKey: Uint8Array
	/** X25519 public key (32 bytes) — safe to share, used as ECIES recipient key */
	publicKey: Uint8Array
}

/**
 * Derive the X25519 keypair used to ECIES-encrypt the backup payload.
 *
 * @param entropy  32-byte seed:
 *   - passkey users:    masterKey (from passkey PRF)
 *   - web3/Para users:  hexToBytes(podSeedHex) — keccak256 of EIP-712 sig
 */
export function deriveBackupKeypair(entropy: Uint8Array): BackupKeypair {
	const privateKey = hkdf(sha256, entropy, new Uint8Array(0), BACKUP_ENC_INFO, 32)
	const publicKey = x25519.getPublicKey(privateKey)
	return { privateKey, publicKey }
}
