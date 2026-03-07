/**
 * Para MPC Wallet integration for Swarm ID
 *
 * Para is an embedded MPC wallet accessed via email — no MetaMask popup.
 * This module provides Para-equivalents of the ethereum.ts signing functions.
 */

import Para, { Environment } from '@getpara/web-sdk'
import { ParaEthersSigner } from '@getpara/ethers-v6-integration'
import { keccak256, toUtf8Bytes, hashMessage, SigningKey } from 'ethers'
import { hexToBytes } from '@noble/hashes/utils'
import {
	createSIWEMessage,
	ENCRYPTION_DOMAIN,
	ENCRYPTION_TYPES,
	ENCRYPTION_NONCE,
} from '$lib/ethereum'
import type { SignedMessage } from '$lib/ethereum'

export const para = new Para(Environment.BETA, import.meta.env.VITE_PARA_API_KEY as string)

export class ParaSessionExpiredError extends Error {
	constructor() {
		super('Para session expired. Please sign in again to use this feature.')
		this.name = 'ParaSessionExpiredError'
	}
}

export async function isParaSessionActive(): Promise<boolean> {
	try {
		const isActive = await Promise.race([
			para.isSessionActive(),
			new Promise<false>((resolve) => setTimeout(() => resolve(false), 3000)),
		])
		return isActive
	} catch {
		return false
	}
}

async function getParaAddress(): Promise<string> {
	for (let attempt = 0; attempt < 5; attempt++) {
		try {
			const wallets = Object.values(para.wallets).filter((w) => w.type === 'EVM' && w.address)
			const addr = wallets[0]?.address
			if (addr && typeof addr === 'string') {
				return addr.toLowerCase()
			}
		} catch {
			// continue to retry
		}
		await new Promise((r) => setTimeout(r, 300 * (attempt + 1)))
	}
	throw new Error('No Para wallet found after authentication')
}

function createParaSigner(): InstanceType<typeof ParaEthersSigner> {
	// Provider not needed for EIP-712 signing when domain has no chainId.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return new ParaEthersSigner(para, null as any)
}

/**
 * Sign a SIWE message with the active Para session.
 * Mirrors connectAndSign() from ethereum.ts but uses Para instead of injected wallet.
 */
export async function connectAndSignWithPara(): Promise<SignedMessage> {
	if (!(await isParaSessionActive())) {
		throw new ParaSessionExpiredError()
	}

	const signer = createParaSigner()
	const address = await getParaAddress()

	const message = createSIWEMessage({
		address,
		domain: window.location.host,
		uri: window.location.origin,
	})

	const signature = await signer.signMessage(message)
	const digest = hashMessage(message)
	const publicKey = SigningKey.recoverPublicKey(digest, signature)

	return { message, digest, signature, publicKey, address }
}

/**
 * Sign EIP-712 to derive a deterministic encryption seed via Para.
 * Mirrors deriveEncryptionSeed() from ethereum.ts but uses Para instead of injected wallet.
 *
 * Same wallet + same Para session → same signature → same 32-byte seed.
 */
export async function deriveEncryptionSeedWithPara(): Promise<Uint8Array> {
	if (!(await isParaSessionActive())) {
		throw new ParaSessionExpiredError()
	}

	const signer = createParaSigner()
	const address = await getParaAddress()

	const signature = await signer.signTypedData(
		{ ...ENCRYPTION_DOMAIN },
		{ ...ENCRYPTION_TYPES },
		{
			purpose: 'Derive deterministic encryption identity',
			address,
			nonce: ENCRYPTION_NONCE,
		},
	)

	const seedHex = keccak256(toUtf8Bytes(signature))
	return hexToBytes(seedHex.slice(2))
}
