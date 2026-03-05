/**
 * Private key export helpers
 *
 * Formats keys for export to MetaMask, hardware wallets, and other tools.
 *
 * For passkey accounts:
 *   - Feed signer:   hex private key (from BIP-44 m/44'/60'/1'/0/0)
 *   - Parent/funds:  hex private key (from BIP-44 m/44'/60'/0'/0/0)
 *   - Recovery phrase: 24-word BIP-39 mnemonic (covers ALL BIP-44 paths)
 *
 * For ethereum accounts:
 *   - Feed signer:   hex private key (HKDF-derived, domain-separated)
 *   - Parent key:    masterKey as hex (which IS the secp256k1 private key)
 *   - No mnemonic (SIWE-based, not BIP-39)
 *
 * For agent accounts:
 *   - Same as passkey (BIP-44 derivation from BIP-39 seed)
 *   - The user's BIP-39 phrase is the master backup
 */

import { Bytes } from '@ethersphere/bee-js'
import type { Account } from '@swarm-id/lib'
import {
	deriveBip44FeedSigner,
	deriveBip44ParentKey,
	deriveFeedSigner,
	FEED_SIGNER_PATH_DEFAULT,
	FEED_SIGNER_PATH_WOCO,
} from './feed-signer'
import type { FeedSignerResult } from './feed-signer'
import { masterKeyToMnemonic } from './passkey-mnemonic'

// ============================================================================
// Types
// ============================================================================

export interface ExportedKeys {
	/** Feed signer secp256k1 private key (64-char hex) — for Swarm feed writes */
	feedSignerHex: string
	/** Feed signer Ethereum address */
	feedSignerAddress: string
	/** BIP-44 path (if applicable) */
	feedSignerPath?: string
	/** Parent / funds account private key (64-char hex) */
	parentKeyHex: string
	/** Parent / funds Ethereum address */
	parentAddress: string
	/** 24-word BIP-39 mnemonic (passkey/agent only) */
	mnemonic?: string
}

// ============================================================================
// Key derivation for export
// ============================================================================

/**
 * Derive all exportable keys from the account master key.
 * Only call this when masterKey is available (after authentication).
 *
 * @param account   - Account record (for type dispatch)
 * @param masterKey - Account master key (from session or re-auth)
 */
export async function deriveExportedKeys(
	account: Account,
	masterKey: Bytes,
): Promise<ExportedKeys> {
	if (account.type === 'passkey' || account.type === 'agent') {
		// BIP-44 derivation from the raw BIP-32 seed
		const feedSigner = deriveBip44FeedSigner(masterKey, FEED_SIGNER_PATH_DEFAULT)
		const parentKey = deriveBip44ParentKey(masterKey)
		const mnemonic = masterKeyToMnemonic(masterKey)

		return {
			feedSignerHex: feedSigner.privateKey.toHex(),
			feedSignerAddress: feedSigner.address.toHex(),
			feedSignerPath: feedSigner.path,
			parentKeyHex: parentKey.privateKey.toHex(),
			parentAddress: parentKey.address.toHex(),
			mnemonic,
		}
	}

	// ethereum account — HKDF derivation
	const feedSigner = await deriveFeedSigner('ethereum', masterKey)
	return {
		feedSignerHex: feedSigner.privateKey.toHex(),
		feedSignerAddress: feedSigner.address.toHex(),
		parentKeyHex: masterKey.toHex(),
		parentAddress: account.id.toHex(),
	}
}

// ============================================================================
// WoCo-specific feed signer (opt-in path)
// ============================================================================

/**
 * Derive the WoCo-specific feed signer at m/44'/60'/2'/0/0.
 * Only for passkey/agent accounts. Opt-in, for privacy isolation.
 */
export function deriveWocoFeedSigner(masterKey: Bytes): FeedSignerResult {
	return deriveBip44FeedSigner(masterKey, FEED_SIGNER_PATH_WOCO)
}

// ============================================================================
// Formatting helpers
// ============================================================================

/** Format hex private key with 0x prefix for MetaMask import */
export function toMetaMaskHex(privateKeyHex: string): string {
	return privateKeyHex.startsWith('0x') ? privateKeyHex : `0x${privateKeyHex}`
}

/** Format Ethereum address with EIP-55 checksum for display */
export function formatAddress(address: string): string {
	return address.startsWith('0x') ? address : `0x${address}`
}
