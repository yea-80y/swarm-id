/**
 * ECIES (Elliptic Curve Integrated Encryption Scheme) — X25519
 *
 * Standard construction:
 *   seal:  ephemeral X25519 ECDH  →  HKDF-SHA256  →  AES-256-GCM encrypt
 *   open:  recipient X25519 ECDH  →  HKDF-SHA256  →  AES-256-GCM decrypt
 *
 * Wire format (SealedBox) is identical to WoCo's @woco/shared ecies.ts
 * so sealed boxes can be opened by either implementation.
 *
 * Domain separator: "swarm-id/feed-recovery/v1" (different from WoCo's
 * "woco/order/v1" — use a different info string when integrating).
 */

import { x25519 } from '@noble/curves/ed25519'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'

/** HKDF info string — domain-separated from WoCo order encryption */
const ECIES_INFO = new TextEncoder().encode('swarm-id/feed-recovery/v1')

/** Sealed box wire format — identical to WoCo's SealedBox type */
export interface SealedBox {
	ephemeralPublicKey: string // hex-encoded X25519 ephemeral public key (32 bytes)
	iv: string // hex-encoded AES-GCM IV (12 bytes)
	ciphertext: string // hex-encoded ciphertext + GCM auth tag
}

/** Strip optional 0x prefix and convert hex to bytes */
function toBytes(hex: string): Uint8Array {
	return hexToBytes(hex.startsWith('0x') ? hex.slice(2) : hex)
}

/**
 * Copy bytes into a fresh ArrayBuffer.
 * Required because @noble libs return Uint8Array<ArrayBufferLike> but
 * Web Crypto's BufferSource expects ArrayBuffer (not SharedArrayBuffer).
 */
function buf(bytes: Uint8Array): ArrayBuffer {
	const ab = new ArrayBuffer(bytes.byteLength)
	new Uint8Array(ab).set(bytes)
	return ab
}

/**
 * Encrypt data to a recipient's X25519 public key.
 *
 * @param recipientPublicKey - X25519 public key (hex string or Uint8Array)
 * @param plaintext          - Data to encrypt (raw bytes)
 */
export async function seal(
	recipientPublicKey: Uint8Array | string,
	plaintext: Uint8Array,
): Promise<SealedBox> {
	const pubKeyBytes =
		typeof recipientPublicKey === 'string' ? toBytes(recipientPublicKey) : recipientPublicKey

	// Fresh ephemeral X25519 keypair (forward secrecy per message)
	const ephPrivate = crypto.getRandomValues(new Uint8Array(32))
	const ephPublic = x25519.getPublicKey(ephPrivate)

	// ECDH shared secret
	const shared = x25519.getSharedSecret(ephPrivate, pubKeyBytes)

	// HKDF key derivation (salt = ephemeral public key for domain separation)
	const aesKeyBytes = hkdf(sha256, shared, ephPublic, ECIES_INFO, 32)

	const aesKey = await crypto.subtle.importKey(
		'raw',
		buf(aesKeyBytes),
		{ name: 'AES-GCM' },
		false,
		['encrypt'],
	)

	const iv = crypto.getRandomValues(new Uint8Array(12))
	const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, buf(plaintext))

	return {
		ephemeralPublicKey: bytesToHex(ephPublic),
		iv: bytesToHex(iv),
		ciphertext: bytesToHex(new Uint8Array(ciphertext)),
	}
}

/**
 * Decrypt a sealed box with the recipient's X25519 private key.
 *
 * @param recipientPrivateKey - X25519 private key (hex string or Uint8Array)
 * @param box                 - SealedBox to decrypt
 * @throws If decryption fails (wrong key, tampered data, etc.)
 */
export async function open(
	recipientPrivateKey: Uint8Array | string,
	box: SealedBox,
): Promise<Uint8Array> {
	const privKeyBytes =
		typeof recipientPrivateKey === 'string' ? toBytes(recipientPrivateKey) : recipientPrivateKey

	const ephPublic = hexToBytes(box.ephemeralPublicKey)
	const iv = hexToBytes(box.iv)
	const ciphertext = hexToBytes(box.ciphertext)

	// ECDH shared secret (same as seal, reversed roles)
	const shared = x25519.getSharedSecret(privKeyBytes, ephPublic)

	// Same HKDF parameters → same AES key
	const aesKeyBytes = hkdf(sha256, shared, ephPublic, ECIES_INFO, 32)

	const aesKey = await crypto.subtle.importKey(
		'raw',
		buf(aesKeyBytes),
		{ name: 'AES-GCM' },
		false,
		['decrypt'],
	)

	const plaintext = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: buf(iv) },
		aesKey,
		buf(ciphertext),
	)

	return new Uint8Array(plaintext)
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Encrypt a JSON-serialisable value to a recipient's public key. */
export async function sealJson(
	recipientPublicKey: Uint8Array | string,
	data: unknown,
): Promise<SealedBox> {
	return seal(recipientPublicKey, encoder.encode(JSON.stringify(data)))
}

/** Decrypt a sealed box and parse as JSON. */
export async function openJson<T = unknown>(
	recipientPrivateKey: Uint8Array | string,
	box: SealedBox,
): Promise<T> {
	const plaintext = await open(recipientPrivateKey, box)
	return JSON.parse(decoder.decode(plaintext)) as T
}
