/**
 * Backup encryption key derivation — Phase 4
 *
 * Derives an X25519 keypair used to ECIES-encrypt the account backup payload.
 * The derivation method differs per account type, but the resulting keypair
 * interface is identical so the caller does not need to know the source.
 *
 * Passkey users:
 *   HKDF(masterKey, info="swarm-id/backup-enc/v1") → 32-byte X25519 private key
 *   No EIP-712 needed — masterKey is already in session from passkey auth.
 *
 * Web3 wallet users:
 *   EIP-712 (fixed nonce) → secp256k1 signature bytes
 *   → HKDF(sig[0..64], info="swarm-id/backup-enc/v1") → 32-byte X25519 private key
 *   MetaMask handles the EIP-712 popup natively — no custom UI needed.
 *
 * Para wallet users:
 *   Same as web3, but Para SDK must be called explicitly via custom UI.
 *   The signEip712ForBackup() function accepts the signature bytes regardless of source.
 *
 * The X25519 private key is 32 bytes. @noble/curves handles clamping at use time.
 * The keypair is ephemeral in memory — never persisted.
 */

import { x25519 } from '@noble/curves/ed25519'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'
import { BrowserProvider, TypedDataEncoder } from 'ethers'
import type { Eip1193Provider, TypedDataField } from 'ethers'

// ============================================================================
// Constants
// ============================================================================

const BACKUP_ENC_INFO = new TextEncoder().encode('swarm-id/backup-enc/v1')

/**
 * Fixed EIP-712 domain and message — deterministic across all signings.
 * No chainId: backup keys are chain-agnostic (not used in any on-chain tx).
 * No nonce: intentional — same wallet must always produce the same key.
 */
const EIP712_DOMAIN = {
	name: 'Swarm ID Backup',
	version: '1',
} as const

const EIP712_TYPES: Record<string, TypedDataField[]> = {
	BackupKey: [
		{ name: 'purpose', type: 'string' },
		{ name: 'version', type: 'uint256' },
	],
}

const EIP712_MESSAGE = {
	purpose: 'Account backup encryption key — off-chain only, never broadcast',
	version: 1n,
} as const

// ============================================================================
// Types
// ============================================================================

export interface BackupKeypair {
	/** X25519 private key (32 bytes) — keep in memory only, never persist */
	privateKey: Uint8Array
	/** X25519 public key (32 bytes) — safe to share, used for encryption */
	publicKey: Uint8Array
}

// ============================================================================
// Shared derivation
// ============================================================================

function deriveX25519FromBytes(entropy: Uint8Array): BackupKeypair {
	const privateKey = hkdf(sha256, entropy, new Uint8Array(0), BACKUP_ENC_INFO, 32)
	const publicKey = x25519.getPublicKey(privateKey)
	return { privateKey, publicKey }
}

// ============================================================================
// Per-account-type derivation
// ============================================================================

/**
 * Derive backup keypair for passkey accounts.
 * masterKey is already available in session after passkey auth — no extra signing.
 */
export function deriveBackupKeypairFromMasterKey(masterKey: Uint8Array): BackupKeypair {
	return deriveX25519FromBytes(masterKey)
}

/**
 * Derive backup keypair for web3 wallet (MetaMask) accounts.
 * Requests MetaMask to sign the fixed EIP-712 message, then derives X25519 from the sig.
 *
 * The signature is deterministic: same wallet + fixed message → same sig → same keypair.
 * MetaMask shows its own popup — no custom UI needed in swarm-ui.
 */
export async function deriveBackupKeypairFromWallet(
	provider: Eip1193Provider,
): Promise<BackupKeypair> {
	const ethersProvider = new BrowserProvider(provider, 'any')
	const signer = await ethersProvider.getSigner()

	const signature: string = await signer.signTypedData(EIP712_DOMAIN, EIP712_TYPES, EIP712_MESSAGE)

	// Signature is 65 bytes (r + s + v) hex-encoded with 0x prefix.
	// Use all 64 bytes of r+s as entropy (drop the 1-byte v).
	const sigBytes = hexToBytes(signature.slice(2, 130))
	return deriveX25519FromBytes(sigBytes)
}

/**
 * Derive backup keypair from a raw EIP-712 signature (65 bytes, hex).
 * Used by Para wallet users after their custom UI has called the Para SDK.
 * The signature MUST be produced from the same fixed EIP-712 domain/message above.
 */
export function deriveBackupKeypairFromSignature(signatureHex: string): BackupKeypair {
	const hex = signatureHex.startsWith('0x') ? signatureHex.slice(2) : signatureHex
	const sigBytes = hexToBytes(hex.slice(0, 128)) // r+s only (64 bytes)
	return deriveX25519FromBytes(sigBytes)
}

/**
 * Returns the EIP-712 typed data that Para (or any other signer) must sign.
 * Use this to construct the Para SDK signing request.
 */
export function getBackupEip712Payload(): {
	domain: typeof EIP712_DOMAIN
	types: Record<string, TypedDataField[]>
	message: { purpose: string; version: string }
	primaryType: 'BackupKey'
} {
	return {
		domain: EIP712_DOMAIN,
		types: EIP712_TYPES,
		// Para SDK expects serialisable values — convert bigint to string
		message: { purpose: EIP712_MESSAGE.purpose, version: EIP712_MESSAGE.version.toString() },
		primaryType: 'BackupKey',
	}
}

/**
 * Returns the EIP-712 hash for display / verification purposes.
 */
export function getBackupEip712Hash(): string {
	return TypedDataEncoder.hash(EIP712_DOMAIN, EIP712_TYPES, {
		purpose: EIP712_MESSAGE.purpose,
		version: EIP712_MESSAGE.version,
	})
}

// ============================================================================
// Backup SOC signer (secp256k1) — user owns their backup SOC from day one
// ============================================================================

import { PrivateKey } from '@ethersphere/bee-js'

const BACKUP_SIGNER_INFO = new TextEncoder().encode('swarm-id/backup-signer/v1')

/**
 * Derive the secp256k1 key that OWNS and SIGNS the user's backup SOC.
 * Deterministic from masterKey — same key on every device, every session.
 * User controls their backup SOC. Platform never signs it.
 * Platform only signs a separate discovery registry feed.
 */
export function deriveBackupSigner(masterKey: Uint8Array): PrivateKey {
	const keyBytes = hkdf(sha256, masterKey, new Uint8Array(0), BACKUP_SIGNER_INFO, 32)
	return new PrivateKey(keyBytes)
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
