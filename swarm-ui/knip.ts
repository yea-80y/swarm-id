import type { KnipConfig } from 'knip'

const config: KnipConfig = {
	entry: ['src/app.html', 'src/routes/**/*', '**/*.test.ts', '**/*.spec.ts', '**/*.ct.spec.ts'],
	paths: {
		'$app/*': ['node_modules/@sveltejs/kit/src/runtime/app/*'],
		'$env/*': ['.svelte-kit/ambient.d.ts'],
		'$lib/*': ['src/lib/*'],
	},
	ignore: [
		'playwright/index.ts',
		'src/lib/time.ts',
		'src/lib/schemas.ts',
		// Crypto utility modules — exports are public API, wired into UI progressively
		'src/lib/utils/ecies.ts',
		'src/lib/utils/feed-signer.ts',
		'src/lib/utils/feed-recovery.ts',
		'src/lib/utils/key-export.ts',
		'src/lib/utils/passkey-mnemonic.ts',
		'src/lib/utils/backup-encryption.ts',
		'src/lib/utils/account-backup.ts',
		'src/lib/utils/passkey-binding.ts',
		'src/lib/utils/delegation-certificate.ts',
	],
	ignoreDependencies: ['@swarm-id/lib', '@ethersphere/bee-js'],
	ignoreExportsUsedInFile: true,
	'playwright-ct': false,
}

export default config
