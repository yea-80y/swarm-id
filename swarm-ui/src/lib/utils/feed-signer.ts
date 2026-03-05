/**
 * Feed signer derivation
 *
 * Each account type has a different derivation strategy:
 *
 *   passkey / agent  →  BIP-44 from masterKey (which IS the BIP-32 seed)
 *                       m/44'/60'/1'/0/0 = cross-platform Swarm feed signer
 *                       m/44'/60'/2'/0/0 = WoCo-specific (opt-in, power users)
 *                       m/44'/60'/0'/0/0 = funds / parent wallet
 *
 *   ethereum (SIWE)  →  HKDF from masterKey
 *                       masterKey is a 32-byte hash, not a BIP-32 seed
 *                       HKDF derives a domain-separated child key
 *
 * The X25519 recovery keypair (for Option A Swarm backup) is derived
 * the same way for all account types: HKDF(masterKey, info=RECOVERY_INFO).
 *
 * WoCo integration:
 *   - BIP-44 paths are the same as WoCo's planned feed paths
 *   - X25519 recovery key is compatible with WoCo's ECIES (same algorithm,
 *     different HKDF info string — see ecies.ts)
 */

import { HDNodeWallet, SigningKey, BaseWallet } from 'ethers'
import { EthAddress, Bytes, PrivateKey } from '@ethersphere/bee-js'
import { x25519 } from '@noble/curves/ed25519'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'
import type { Account } from '@swarm-id/lib'

// ============================================================================
// BIP-44 paths
// ============================================================================

/** Cross-platform Swarm feed signer — default for all Swarm apps */
export const FEED_SIGNER_PATH_DEFAULT = "m/44'/60'/1'/0/0"

/** WoCo-specific feed signer — opt-in, privacy isolation */
export const FEED_SIGNER_PATH_WOCO = "m/44'/60'/2'/0/0"

/** Funds / parent wallet — standard Ethereum account */
export const FEED_SIGNER_PATH_FUNDS = "m/44'/60'/0'/0/0"

// ============================================================================
// HKDF info strings
// ============================================================================

/** Domain separator for ethereum-account feed signer derivation */
const FEED_SIGNER_HKDF_INFO = 'swarm-feed-signer-v1'

/** Domain separator for X25519 recovery key derivation (all account types) */
const FEED_RECOVERY_X25519_INFO = 'swarm-feed-recovery-x25519-v1'

// ============================================================================
// Types
// ============================================================================

export interface FeedSignerResult {
	/** secp256k1 private key (32 bytes) */
	privateKey: Bytes
	/** Ethereum address derived from the feed signer public key */
	address: EthAddress
	/** BIP-44 derivation path (if applicable) */
	path?: string
}

export interface FeedRecoveryX25519 {
	privateKey: Uint8Array
	publicKey: Uint8Array
	publicKeyHex: string
}

// ============================================================================
// BIP-44 derivation (passkey / agent accounts)
// ============================================================================

/**
 * Derive a feed signer using BIP-44 from the raw BIP-32 seed.
 * masterKey is the 32-byte PRF-derived seed stored in PasskeyAccount.
 *
 * @param masterKey - Raw BIP-32 seed (32 bytes)
 * @param path      - BIP-44 derivation path (defaults to cross-platform)
 */
export function deriveBip44FeedSigner(
	masterKey: Bytes,
	path = FEED_SIGNER_PATH_DEFAULT,
): FeedSignerResult {
	const seedHex = '0x' + masterKey.toHex()
	const wallet = HDNodeWallet.fromSeed(seedHex).derivePath(path)

	if (!wallet.privateKey) {
		throw new Error('BIP-44 derivation produced no private key')
	}

	const privateKeyHex = wallet.privateKey.startsWith('0x')
		? wallet.privateKey.slice(2)
		: wallet.privateKey

	return {
		privateKey: new Bytes(privateKeyHex),
		address: new EthAddress(wallet.address),
		path,
	}
}

/**
 * Derive the parent / funds wallet using BIP-44.
 * m/44'/60'/0'/0/0 — standard Ethereum account, MetaMask-compatible.
 */
export function deriveBip44ParentKey(masterKey: Bytes): FeedSignerResult {
	return deriveBip44FeedSigner(masterKey, FEED_SIGNER_PATH_FUNDS)
}

// ============================================================================
// HKDF derivation (ethereum / SIWE accounts)
// ============================================================================

/**
 * Derive a feed signer using HKDF from the ethereum masterKey.
 * masterKey for ethereum accounts is a 32-byte hash (not a BIP-32 seed).
 *
 * @param masterKey - 32-byte master key (from SIWE derivation)
 */
export async function deriveHkdfFeedSigner(masterKey: Bytes): Promise<FeedSignerResult> {
	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		masterKey.toUint8Array(),
		'HKDF',
		false,
		['deriveBits'],
	)

	const derivedBits = await crypto.subtle.deriveBits(
		{
			name: 'HKDF',
			salt: new Uint8Array(0),
			hash: 'SHA-256',
			info: new TextEncoder().encode(FEED_SIGNER_HKDF_INFO),
		},
		keyMaterial,
		256,
	)

	const privateKeyBytes = new Uint8Array(derivedBits)
	const signingKey = new SigningKey(privateKeyBytes)
	const wallet = new BaseWallet(signingKey)

	return {
		privateKey: new Bytes(privateKeyBytes),
		address: new EthAddress(wallet.address),
	}
}

// ============================================================================
// X25519 recovery key (all account types)
// ============================================================================

/**
 * Derive the X25519 encryption keypair used to seal the feed signer
 * onto a Swarm recovery feed.
 *
 * Same masterKey → same X25519 keypair → can always re-derive without
 * storing the private key anywhere.
 *
 * @param masterKey - 32-byte master key (any account type)
 */
export function deriveFeedRecoveryX25519(masterKey: Bytes): FeedRecoveryX25519 {
	const encSeed = hkdf(
		sha256,
		masterKey.toUint8Array(),
		new Uint8Array(0),
		FEED_RECOVERY_X25519_INFO,
		32,
	)
	const publicKey = x25519.getPublicKey(encSeed)
	const publicKeyHex = Array.from(publicKey)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('')

	return { privateKey: encSeed, publicKey, publicKeyHex }
}

// ============================================================================
// Identity-level feed signer (per-identity, all account types)
// ============================================================================

/** Domain separator for identity-level feed signer derivation */
const IDENTITY_FEED_SIGNER_INFO_PREFIX = 'swarm-id/identity-feed-signer/v1:'

/**
 * Derive a feed signer scoped to a specific identity.
 *
 * Uses HKDF with the identity ID as part of the info string, producing a
 * unique secp256k1 feed signer per identity. Works for all account types
 * (passkey, ethereum, agent) — no index needed.
 *
 * The identity's feed signer address is safe to display (public info).
 * The private key is only held in session / ConnectedApp storage.
 *
 * @param masterKey  - Account master key (32 bytes)
 * @param identityId - Identity ID (Ethereum address string, e.g. "0xAbCd...")
 */
export function deriveIdentityFeedSigner(masterKey: Bytes, identityId: string): FeedSignerResult {
	const info = IDENTITY_FEED_SIGNER_INFO_PREFIX + identityId.toLowerCase()
	const derived = hkdf(sha256, masterKey.toUint8Array(), new Uint8Array(0), info, 32)
	const signingKey = new SigningKey(derived)
	const wallet = new BaseWallet(signingKey)

	return {
		privateKey: new Bytes(derived),
		address: new EthAddress(wallet.address),
	}
}

// ============================================================================
// Unified entry point
// ============================================================================

/**
 * Derive the feed signer for any account type.
 *
 * @param accountType - Account type ('passkey' | 'agent' | 'ethereum')
 * @param masterKey   - Account master key
 * @param path        - Optional BIP-44 path override (passkey/agent only)
 */
export async function deriveFeedSigner(
	accountType: Account['type'],
	masterKey: Bytes,
	path?: string,
): Promise<FeedSignerResult> {
	if (accountType === 'passkey' || accountType === 'agent') {
		return deriveBip44FeedSigner(masterKey, path ?? FEED_SIGNER_PATH_DEFAULT)
	}
	return deriveHkdfFeedSigner(masterKey)
}

/**
 * Validate that a feed signer private key is a valid secp256k1 key
 * by attempting to use it with PrivateKey.
 */
export function validateFeedSignerKey(privateKeyHex: string): boolean {
	try {
		new PrivateKey(privateKeyHex)
		return true
	} catch {
		return false
	}
}
