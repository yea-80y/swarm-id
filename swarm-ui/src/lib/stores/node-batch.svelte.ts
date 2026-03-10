import { browser } from '$app/environment'

const STORAGE_KEY = 'swarm-id-network-batch'

function withNodeBatchStore() {
	let batchId = $state(browser ? (localStorage.getItem(STORAGE_KEY) ?? '') : '')

	function set(id: string) {
		batchId = id
		if (!browser) return
		if (id) {
			localStorage.setItem(STORAGE_KEY, id)
		} else {
			localStorage.removeItem(STORAGE_KEY)
		}
	}

	function clear() {
		set('')
	}

	return {
		get batchId() {
			return batchId
		},
		set,
		clear,
	}
}

export const nodeBatchStore = withNodeBatchStore()
