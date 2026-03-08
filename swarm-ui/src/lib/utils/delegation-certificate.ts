/**
 * EIP-712 Delegation Certificate
 *
 * Allows a wallet owner (individual or business) to publicly bind a
 * feedSignerAddress to their wallet address. Third parties can verify:
 *
 *   walletAddress → download certificate → verify EIP-712 signature → trust feedSigner
 *
 * OPT-IN ONLY. Default mode stays private/unlinkable (no certificate published).
 * Once published to Swarm, the certificate is immutable. The user must create a
 * new identity to go private again.
 *
 * Serves both individual users (alice.eth) and business entities (pret.eth).
 *
 * This is the same pattern as devconnect-profile-sandbox's "AuthorizeSafeSigner"
 * capability, but published to Swarm so ANY reader can verify — no server needed.
 *
 * EIP-712 schema:
 *   Domain: { name: "WoCo Identity", version: "1" }
 *   Types:  BindFeedSigner: [walletAddress, feedSignerAddress, identityId, purpose]
 *   Value:  { walletAddress, feedSignerAddress, identityId, purpose: "woco/feed-signer/v1" }
 */

import { verifyTypedData } from 'ethers'
import { Bee } from '@ethersphere/bee-js'
import type { BatchId } from '@ethersphere/bee-js'

// ============================================================================
// EIP-712 Domain & Types
// ============================================================================

export const DELEGATION_DOMAIN = {
	name: 'WoCo Identity',
	version: '1',
} as const

export const DELEGATION_TYPES = {
	BindFeedSigner: [
		{ name: 'walletAddress', type: 'address' },
		{ name: 'feedSignerAddress', type: 'address' },
		{ name: 'identityId', type: 'string' },
		{ name: 'purpose', type: 'string' },
	],
}

export const DELEGATION_PURPOSE = 'woco/feed-signer/v1'

// ============================================================================
// Types
// ============================================================================

export interface DelegationCertificate {
	walletAddress: string
	feedSignerAddress: string
	identityId: string
	purpose: string
	signature: string
	timestamp: number
}

export interface DelegationCertificatePayload {
	version: 1
	certificates: DelegationCertificate[]
}

// ============================================================================
// Signing (requires connected wallet)
// ============================================================================

/**
 * Sign a delegation certificate binding a feedSignerAddress to a wallet.
 *
 * @param signer          - ethers Signer (from MetaMask, Para, etc.)
 * @param walletAddress   - Wallet address (checksummed)
 * @param feedSignerAddress - Feed signer address to delegate to (0x-prefixed)
 * @param identityId      - Identity ID being made public
 * @returns Signed DelegationCertificate
 */
export async function signDelegationCertificate(
	signer: {
		signTypedData: (
			domain: Record<string, unknown>,
			types: Record<string, Array<{ name: string; type: string }>>,
			value: Record<string, unknown>,
		) => Promise<string>
		address: string
	},
	feedSignerAddress: string,
	identityId: string,
): Promise<DelegationCertificate> {
	const value = {
		walletAddress: signer.address,
		feedSignerAddress,
		identityId,
		purpose: DELEGATION_PURPOSE,
	}

	const signature = await signer.signTypedData(
		{ ...DELEGATION_DOMAIN },
		{ ...DELEGATION_TYPES },
		value,
	)

	return {
		...value,
		signature,
		timestamp: Date.now(),
	}
}

// ============================================================================
// Verification (no wallet needed — pure crypto)
// ============================================================================

/**
 * Verify a delegation certificate's EIP-712 signature.
 *
 * Recovers the signer from the signature and checks it matches walletAddress.
 * This can be done by anyone — no wallet connection needed.
 *
 * @returns true if the certificate is valid
 */
export function verifyDelegationCertificate(cert: DelegationCertificate): boolean {
	try {
		const value = {
			walletAddress: cert.walletAddress,
			feedSignerAddress: cert.feedSignerAddress,
			identityId: cert.identityId,
			purpose: cert.purpose,
		}

		const recoveredAddress = verifyTypedData(
			{ ...DELEGATION_DOMAIN },
			{ ...DELEGATION_TYPES },
			value,
			cert.signature,
		)

		return recoveredAddress.toLowerCase() === cert.walletAddress.toLowerCase()
	} catch {
		return false
	}
}

// ============================================================================
// Serialization (for Swarm storage)
// ============================================================================

/**
 * Serialize a delegation payload to bytes for Swarm upload.
 */
export function serializeDelegationPayload(payload: DelegationCertificatePayload): Uint8Array {
	return new TextEncoder().encode(JSON.stringify(payload))
}

/**
 * Deserialize a delegation payload from Swarm download.
 */
export function deserializeDelegationPayload(data: Uint8Array): DelegationCertificatePayload {
	const text = new TextDecoder().decode(data)
	const parsed = JSON.parse(text)

	if (parsed.version !== 1 || !Array.isArray(parsed.certificates)) {
		throw new Error('Invalid delegation payload format')
	}

	return parsed as DelegationCertificatePayload
}

/**
 * Create a payload containing a single certificate (common case).
 * Additional certificates for other identities can be appended later
 * by reading the existing feed, adding the new cert, and re-writing.
 */
export function createDelegationPayload(cert: DelegationCertificate): DelegationCertificatePayload {
	return { version: 1, certificates: [cert] }
}

/**
 * Add a certificate to an existing payload (for multi-identity wallets).
 * Replaces any existing certificate for the same identityId.
 */
export function addCertificateToPayload(
	payload: DelegationCertificatePayload,
	cert: DelegationCertificate,
): DelegationCertificatePayload {
	const filtered = payload.certificates.filter((c) => c.identityId !== cert.identityId)
	return { version: 1, certificates: [...filtered, cert] }
}

// ============================================================================
// Swarm storage (content-addressed, like backups)
// ============================================================================

export interface DelegationWriteResult {
	/** Swarm content-addressed hash (64-char hex) — share for verification */
	reference: string
}

/**
 * Upload a delegation certificate payload to Swarm.
 *
 * The certificate is NOT encrypted — it's public by design. Anyone with the
 * hash can download and verify it. The hash is the discovery mechanism until
 * ENS integration (Phase 6) provides a named lookup.
 */
export async function writeDelegationCertificate(
	bee: Bee,
	stamp: BatchId | string,
	payload: DelegationCertificatePayload,
): Promise<DelegationWriteResult> {
	const data = serializeDelegationPayload(payload)
	const result = await bee.uploadData(stamp, data)
	return { reference: result.reference.toString() }
}

/**
 * Download and parse a delegation certificate payload from Swarm.
 * Verifies all certificates in the payload.
 *
 * @returns Payload with only valid certificates, or undefined if not found
 */
export async function readDelegationCertificate(
	bee: Bee,
	reference: string,
): Promise<DelegationCertificatePayload | undefined> {
	try {
		const data = await bee.downloadData(reference)
		const payload = deserializeDelegationPayload(data.toUint8Array())

		const validCerts = payload.certificates.filter(verifyDelegationCertificate)
		if (validCerts.length === 0) return undefined

		return { version: 1, certificates: validCerts }
	} catch {
		return undefined
	}
}

// ============================================================================
// LocalStorage for certificate references (same pattern as backup hashes)
// ============================================================================

const DELEGATION_STORAGE_KEY = 'swarm-id-delegation-refs'

interface StoredDelegationRef {
	walletAddress: string
	identityId: string
	reference: string
	timestamp: number
}

/**
 * Store a delegation certificate Swarm reference in localStorage.
 */
export function storeDelegationReference(
	walletAddress: string,
	identityId: string,
	reference: string,
): void {
	const refs = loadDelegationReferences()
	const existing = refs.findIndex(
		(r) =>
			r.walletAddress.toLowerCase() === walletAddress.toLowerCase() && r.identityId === identityId,
	)

	const entry: StoredDelegationRef = {
		walletAddress,
		identityId,
		reference,
		timestamp: Date.now(),
	}

	if (existing >= 0) {
		refs[existing] = entry
	} else {
		refs.push(entry)
	}

	localStorage.setItem(DELEGATION_STORAGE_KEY, JSON.stringify(refs))
}

/**
 * Get the delegation certificate reference for an identity, if published.
 */
export function getDelegationReference(identityId: string): string | undefined {
	const refs = loadDelegationReferences()
	return refs.find((r) => r.identityId === identityId)?.reference
}

function loadDelegationReferences(): StoredDelegationRef[] {
	try {
		const raw = localStorage.getItem(DELEGATION_STORAGE_KEY)
		return raw ? (JSON.parse(raw) as StoredDelegationRef[]) : []
	} catch {
		return []
	}
}
