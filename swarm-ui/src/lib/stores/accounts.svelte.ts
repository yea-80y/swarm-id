import { browser } from '$app/environment'
import { EthAddress, BatchId, Bytes } from '@ethersphere/bee-js'
import { createAccountsStorageManager, type Account } from '@swarm-id/lib'

// ============================================================================
// Storage Manager
// ============================================================================

const storageManager = createAccountsStorageManager()

function loadAccounts(): Account[] {
	if (!browser) return []
	return storageManager.load()
}

function saveAccounts(data: Account[]): void {
	storageManager.save(data)
}

// ============================================================================
// Reactive Store
// ============================================================================

let accounts = $state<Account[]>(loadAccounts())

export const accountsStore = {
	get accounts() {
		return accounts
	},

	addAccount(account: Account): Account {
		accounts = [...accounts, account]
		saveAccounts(accounts)
		return account
	},

	removeAccount(id: EthAddress) {
		accounts = accounts.filter((a) => !a.id.equals(id))
		saveAccounts(accounts)
	},

	getAccount(id: EthAddress): Account | undefined {
		return accounts.find((a) => a.id.equals(id))
	},

	setAccountName(id: EthAddress, name: string) {
		accounts = accounts.map((account) => (account.id.equals(id) ? { ...account, name } : account))
		saveAccounts(accounts)
	},

	upgradeEthereumAccountEncryption(
		id: EthAddress,
		encryptedMasterKey: Bytes,
		encryptedSecretSeed: Bytes,
		encryptionSalt: Bytes,
	) {
		accounts = accounts.map((account) => {
			if (!account.id.equals(id) || account.type !== 'ethereum') return account
			return {
				...account,
				encryptedMasterKey,
				encryptedSecretSeed,
				encryptionSalt,
				encryptionScheme: 'eip712' as const,
			}
		})
		saveAccounts(accounts)
	},

	setDefaultStamp(id: EthAddress, batchID: BatchId | undefined) {
		accounts = accounts.map((account) =>
			account.id.equals(id)
				? {
						...account,
						defaultPostageStampBatchID: batchID,
					}
				: account,
		)
		saveAccounts(accounts)
	},

	clear() {
		accounts = []
		storageManager.clear()
	},
}
