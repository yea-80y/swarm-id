# swarm-id — WoCo fork of snaha/swarm-id

Decentralised identity management for Swarm dApps.
Fork of: https://github.com/snaha/swarm-id (Apache 2.0)
WoCo repo: https://github.com/yea-80y/WoCo-Event-App
This folder: /home/ntl/projects/swarm-id/swarm-id
GitHub: https://github.com/yea-80y/swarm-id
WoCo app:    /home/ntl/projects/woco_app

============================================================================
HOW THIS FILE IS USED
============================================================================

Single source of truth for the build. At the end (when DONE section complete):
  1. Update README.md WoCo Fork section to reflect completed work
  2. Generate Discord post from this file (technical audience — NOT mid-build)
  3. Commit with conventional commit messages
  4. User pushes to yea-80y/swarm-id on GitHub

============================================================================
ARCHITECTURE
============================================================================

- SwarmIdClient  — parent dApp (WoCo frontend, user's world computer frontend), manages auth + Bee API calls
- SwarmIdProxy   — iframe at identity origin (id.woco-net.com), holds keys in memory, handles derivation
- SwarmIdAuth    — popup window for user authentication
- OAuth-style flow: dApp → embed iframe → open popup → auth → close popup → iframe gets secret

THE PROXY IS ESSENTIAL FOR WoCo's VISION. User frontends (world computers) are many different Swarm
hashes / URLs, but they all embed the same proxy iframe at a fixed trusted origin. Keys live in one
place, accessible across all user frontends. SwarmIdClient goes in WoCo/user frontend bundles.
SwarmIdProxy runs only inside the swarm-id iframe — it must NOT be bundled into dApp code.
DONE: lib split into client/proxy entrypoints (lib/src/client.ts, lib/src/proxy-entry.ts).

FEED SIGNING IS PER-SESSION, NOT PER-WRITE:
  Once authenticated (passkey/wallet touched once), feedSigner key sits in proxy memory.
  All Swarm writes (SOC signing: keccak256(id + content), secp256k1) are automatic.
  No user interaction per feed write. Passkey/wallet only touched again on session expiry or
  explicit key operations (backup, export, migration).

MASTER KEY DERIVATION:
  Passkey: PRF(SHA256("hd-wallet-seed-v1")) → HKDF("ethereum-hd-wallet-v1") → masterKey
  Web3:    masterKey = keccak256(keccak256(secretSeed) + SIWE_publicKey)
  Para:    Same as Web3, SIWE + EIP-712 signed via ParaEthersSigner (no MetaMask)
  Agent:   BIP-39 mnemonic → masterKey (fully portable, no external dependency)

masterKey → HDNodeWallet.fromSeed(masterKey) → identity wallets + BIP-44 children

APP-SPECIFIC SECRET: HMAC(masterKey, appOrigin). Master key never leaves iframe.

WEB3 ACCOUNT ENCRYPTION HISTORY (masterKey + secretSeed at rest in localStorage):
  v1 (snaha):  HKDF(masterKey) — circular: need masterKey to decrypt secretSeed to derive masterKey
  v2 (fork, SUPERSEDED): HKDF(SIWE_publicKey) — publicKey on-chain = full localStorage compromise
  v3 (CURRENT): HKDF(keccak256(EIP-712_sig), encryptionSalt, info) for BOTH masterKey + secretSeed
    masterKey key:  info = "swarm-id-masterkey-encryption-v2"
    secretSeed key: info = "swarm-id-secretseed-encryption-v3"
    EIP-712 requires wallet private key — publicKey alone cannot decrypt. Safe for any wallet.
  Schema: EthereumAccount.encryptionScheme: 'publickey' | 'eip712' | undefined (absent = legacy)
  Legacy fallback: getMasterKeyFromAccount detects absent/publickey → SIWE path (old accounts still work)

EIP-712 FIXED-NONCE MESSAGES (deterministic — same wallet = same key always):

  ACCOUNT ENCRYPTION (eth/new, eth/recover, backup/recover):
    Domain: { name: "Swarm ID", version: "1" }
    Types:  DeriveEncryptionKey: [purpose: string, address: address, nonce: string]
    Value:  { purpose: "Derive deterministic encryption identity", address: wallet, nonce: "SWARM-ID-ENCRYPTION-V1" }
    → keccak256(sig) → HKDF → masterKey enc key + secretSeed enc key (same seed, different info strings)

  SWARM BACKUP ENCRYPTION (ethereum accounts):
    Domain: { name: "Swarm ID", version: "1", chainId: 1 }
    Types:  BackupKey: [purpose: string, nonce: string]
    Value:  { purpose: "swarm-id/backup-encryption/v1", nonce: "fixed" }
    → keccak256(sig) → HKDF("swarm-id/backup-enc/v1") → X25519 keypair

  DELEGATION CERTIFICATE (opt-in public identity — Phase 7):
    Domain: { name: "WoCo Identity", version: "1" }
    Types:  BindFeedSigner: [walletAddress: address, feedSignerAddress: address, identityId: string, purpose: string]
    Value:  { walletAddress, feedSignerAddress, identityId, purpose: "woco/feed-signer/v1" }
    → certificate uploaded to Swarm as CAC (public, not encrypted)

============================================================================
CANONICAL KEY HIERARCHY
============================================================================

SWARM SIGNING: secp256k1 ONLY. ed25519 = POD/ZuPass only. NEVER conflate.

PASSKEY USER KEY HIERARCHY:
  PRF(SHA256("hd-wallet-seed-v1")) → masterKey → HDNodeWallet
    ├─ root (m/44'/60'/0') → funds wallet (secp256k1, holds xBZZ)
    ├─ .deriveChild(N)     → identity addresses
    └─ HKDF(masterKey, "swarm-id/identity-feed-signer/v1:" + identityId) → per-identity feed signer

  RECOVERY:
    Synced device (Google/Apple): passkey PRF → masterKey → EVERYTHING. No phrase needed.
    Disaster (all passkeys lost): BIP-39 mnemonic (24 words) → masterKey → EVERYTHING.
    Para users: BIP-39 STRONGLY recommended (email loss = Para access lost).

WEB3 WALLET USER KEY HIERARCHY:
  masterKey = keccak256(keccak256(secretSeed) + SIWE_publicKey)
  masterKey → same HDNodeWallet hierarchy as passkey user

  RECOVERY (no Swarm backup): wallet SIWE + secretSeed → re-derive masterKey (/eth/recover)
  RECOVERY (with Swarm backup): wallet EIP-712 → decrypt backup — no secretSeed needed

KEY TYPES:
  secp256k1 → Swarm feed signing (bee-js PrivateKey) + Ethereum funds
  ed25519   → POD ticket signing ONLY (ZuPass/PCDPass, @noble/ed25519)
  X25519    → ECIES encryption ONLY (derived from key material, not a signing key)

============================================================================
IDENTITY MODES — PRIVACY VS PUBLIC (BOTH SUPPORTED)
============================================================================

DEFAULT (unlinkable, snaha-compatible):
  feedSigner derived unlinkably from masterKey + identityId.
  No certificate published. feedSignerAddress carries no wallet linkage.
  Different identities → different addresses → fully unlinkable.
  This is the ONLY mode for now and the default forever.

BUILT — PUBLIC MODE (opt-in, Phase 7):
  User clicks "Make this identity public" in identity settings.
  Wallet signs an EIP-712 delegation certificate:
    Domain: { name: "WoCo Identity", version: "1" }
    Types:  BindFeedSigner: [walletAddress, feedSignerAddress, identityId, purpose]
    Value:  { walletAddress: "0xWallet", feedSignerAddress: "0xFeedSigner",
              identityId: "...", purpose: "woco/feed-signer/v1" }
  Certificate uploaded to Swarm as content-addressed chunk (not encrypted — public by design).
  Reference stored in localStorage. ENS discovery deferred to Phase 6.
  Third parties can verify: download cert → verifyTypedData → trust feedSignerAddress.
  Once published, certificate cannot be unpublished (Swarm is immutable), but user can
  create a new unlinkable identity for future content.

PRIVACY GUARANTEE: publishing a certificate for one identity does NOT affect other identities.
  User can have one public ENS-linked identity and multiple unlinkable ones simultaneously.

============================================================================
PASSKEY BINDING FOR WALLET USERS — BUILT (Phase 7, Option A)
============================================================================

Wallet users currently touch their wallet for every session start.
Passkey binding lets them use a device passkey instead — fast, biometric, mobile-friendly.

OPTION A — Passkey as signing accelerator (additive, no key change):
  Setup: passkey PRF(salt="feed-signer-v1") → passkeyKey → AES-GCM(feedSigner, passkeyKey) → IndexedDB
  Use:   passkey auth once at session start → decrypt feedSigner → all writes automatic from proxy memory
  Recovery if passkey lost: wallet → re-derive masterKey → re-derive feedSigner → bind new passkey
  Recovery if wallet lost: passkey still works (feedSigner decrypts from IndexedDB) — but no account
    recovery without Swarm backup (secretSeed is gone)
  Security: no stronger than current (wallet can always re-derive feedSigner) — but passkey provides
    device-bound auth instead of wallet popup. feedSigner only decryptable on device holding passkey.

OPTION B — True 2FA for feed signing (post-integration upgrade path):
  feedSigner = HKDF(
    key_material: HKDF-Extract(masterKey, passkeyPRF_output),
    info: "swarm-id/identity-feed-signer/v2:" + identityId
  )
  Requires BOTH masterKey (wallet) AND passkeyPRF (device passkey) to reconstruct feedSigner.
  Even if masterKey extracted from localStorage, attacker cannot sign feeds without device passkey.
  Recovery: Swarm backup includes feedSigner → wallet decrypts backup → bind new passkey.
  BREAKING CHANGE for existing identities: feedSigner address changes. Migration path:
    old feedSigner signs a "handoff" chunk delegating to new address → then retire old key.
  Offer as "Upgrade to 2FA feeds" in settings (same pattern as v2→v3 encryption migration).

UX IN ALL CASES:
  Passkey/wallet touched ONCE per session. All feed writes are silent and automatic.
  The proxy holds the feedSigner in memory for the session duration.

============================================================================
SWARM BACKUP ARCHITECTURE
============================================================================

Storage type: CAC (bee.uploadData). Hash = only way to locate backup.
Hash stored: browser localStorage + shown to user. Phase 5: platform registry feed.
Encryption: X25519 ECIES SealedBox (ephemeralPublicKey + IV + AES-256-GCM ciphertext).

Encryption entropy by account type:
  Ethereum/Para: EIP-712 backup sig → keccak256(sig) → HKDF("swarm-id/backup-enc/v1") → X25519
  Passkey:       passkey PRF → masterKey → HKDF("swarm-id/backup-enc/v1") → X25519
  Agent:         seed phrase → masterKey → HKDF("swarm-id/backup-enc/v1") → X25519

Backup payload: version, timestamp, masterKeyHex (eth/agent only), identities[], connectedApps[], postageStamps[]
NOT included: feedSignerKey (re-derivable from masterKey), secretSeed (deliberate)

FEED SIGNER: per-IDENTITY, BIP-44-style HKDF.
  snaha used per-APP (appSecret-derived, address changed per app). We changed to per-IDENTITY.
  Same Swarm address across all apps for one identity. Different identities = unlinkable.

SESSION KEY vs FEED SIGNER:
  Session key: random ephemeral secp256k1, 24h, EIP-712 delegation → WoCo server auth only.
  Feed signer: deterministic BIP-44, permanent, user-owned → signs Swarm chunks CLIENT-SIDE.
  Private key stays in iframe. Parent gets feedSignerAddress (public) only.

WoCo uses EIP-712 for session delegation (not SIWE) — structured capability grant, not website login.

============================================================================
OPEN SOURCE STATUS
============================================================================

This fork is suitable for other Swarm dApps as-is. WoCo-specific code lives in WoCo's repo.
What this fork adds that benefits any Swarm project:
  - iOS postMessage fix
  - Account encryption v3 (closes real attack vector)
  - BIP-39 mnemonic disaster recovery for passkey accounts
  - All recovery flows (eth/recover, backup/recover, passkey cross-device)
  - Para MPC wallet support
  - User-owned Swarm feed writes via proxy
  - Swarm account backup/restore
  - Passkey binding for wallet users (Option A — fast biometric session start)
  - EIP-712 delegation certificate (opt-in public identity binding)

Could contribute encryption v3 fix and iOS fix back to snaha upstream.

============================================================================
BUILD SETUP
============================================================================

bee-js is a git submodule — run once after clone:
  git submodule update --init --recursive

Build order:
  pnpm install
  pnpm build:bee-js                      # builds forked bee-js
  pnpm --filter @swarm-id/lib build      # builds lib package
  rm -rf swarm-ui/node_modules/.vite     # after lib rebuild

Dev:
  pnpm dev:swarm-ui    # identity UI on :5174
  pnpm dev             # UI (:5174) + demo (:3000)

CI: pnpm check:all   # format, lint, typecheck, knip, tests
  NOTE: integration tests (sequence feeds) can flake on slow machines — retry once before worrying.

Prettier in swarm-ui: run from swarm-ui/ directory (needs prettier-plugin-svelte)

VITE_PARA_API_KEY must be set in swarm-ui/.env for Para account creation to work.

============================================================================
WHAT THIS FORK ADDS / FIXES
============================================================================

1. PRF SALT FIXED (commit c2a44b9)
   SHA256("hd-wallet-seed-v1") — domain-agnostic, purpose-describing, no brand coupling.

2. iOS POSTMESSAGE FIX (commit 0329295) — ~90% coverage
   Cross-tab revocation remaining (~10%): Safari blocks storage events cross-origin.
   Fix: client-side localStorage polling in iframe (viable, no server needed).

3. BIP-39 MNEMONIC BACKUP (issues #191 + #189)
   passkey-mnemonic.ts, passkey/mnemonic/+page.svelte, passkey/recover/+page.svelte.
   Stored in IndexedDB. Mnemonic page has honest disaster-recovery framing (not "optional backup").

4. ACCOUNT ENCRYPTION v3 (closes issue #85 attack vector)
   BOTH masterKey and secretSeed encrypted with EIP-712-derived key. Closes publicKey-based attack.
   view-generation-details-modal: handles both legacy ('publickey') and current ('eip712') schemes.

5. RECOVERY FLOWS: /eth/recover (secretSeed + wallet), /backup/recover (4 account types incl. Para),
   /signin, passkey cross-device

6. uploadFile() ENCRYPTED (issue #187): bee.uploadFile() → uploadEncryptedDataWithSigning()

7. USER-OWNED FEED WRITES (Phase 3): makeUserEpochFeedWriter() on SwarmIdClient.
   feedSignerKey in ConnectedApp. Private key stays in iframe.

8. SWARM ACCOUNT BACKUP (Phase 4): writeAccountBackup/readAccountBackup + /backup/recover UI.

9. PARA MPC WALLET (commit f19f181): full Para support — account creation, backup, recovery.
   walletProvider: 'para' on EthereumAccount schema. swarm-ui/src/lib/para.ts.
   Requires VITE_PARA_API_KEY.

10. LIB BUNDLE SPLIT (Phase 7): @swarm-id/lib now has 3 bundles:
    - swarm-id.esm.js (492KB) — full bundle, backward compatible
    - client.esm.js (205KB) — lean client for dApps (SwarmIdClient only)
    - proxy.esm.js (466KB) — proxy for iframe (SwarmIdProxy + heavy deps)
    Import: @swarm-id/lib/client or @swarm-id/lib/proxy

11. PASSKEY BINDING — Option A (Phase 7): wallet users can bind a device passkey for fast
    biometric session start. passkey-binding.ts: PRF → AES-GCM(masterKey) → IndexedDB.
    Wallet always remains primary auth + recovery. Settings UI: "Add passkey for fast signing".

12. DELEGATION CERTIFICATE (Phase 7): opt-in public identity linking.
    delegation-certificate.ts: EIP-712 BindFeedSigner credential.
    Wallet signs → uploaded to Swarm as CAC → reference stored in localStorage.
    Any reader can verify: download cert → verifyTypedData → trust feedSigner.
    Settings UI: "Make this identity public" with immutability warning.

============================================================================
INTEGRATION APPROACH — PHASE STATUS
============================================================================

Phase 1 — COMPLETE ✓
  [x] PRF salt → SHA256("hd-wallet-seed-v1")
  [x] iOS postMessage fallback (~90%)
  [x] Passkey BIP-39 mnemonic backup + honest risk framing on mnemonic page
  [x] uploadFile() encryption fix (issue #187)
  [x] Passkey cross-device recovery (mnemonic → verify PRF → create account record)
  [x] ETH wallet recovery without Swarm backup (/eth/recover: secretSeed + SIWE)
  [x] Account encryption v3 — EIP-712 based, closes #85 attack vector
  [x] Sign-in page wired (/signin: passkey / ETH+secretSeed / Swarm backup)
  [x] Swarm backup recovery UI (/backup/recover: all 4 account types incl. Para)

Phase 2 — COMPLETE ✓
  [x] Feed signer at IDENTITY level — feed-signer.ts: HKDF(masterKey, identityId)
  [x] Private key export — key-export.ts: feedSigner + parent + mnemonic
  [~] ecies.ts + feed-recovery.ts: crypto exists, NOT wired to UI (superseded by Phase 4)

Phase 3 — COMPLETE (browser-tested ✓)
  [x] feedSignerKey in ConnectedApp, user-owned epoch feed writes via proxy
  [x] makeUserEpochFeedWriter() on SwarmIdClient
  [x] loadAuthData() bug fix (sends authSuccess on initial page load)
  [x] serializeConnectedApp() bug fix (feedSignerKey now persisted)

Phase 4 — COMPLETE ✓
  [x] backup-encryption.ts: deriveBackupKeypair(entropy) → X25519 via HKDF
  [x] account-backup.ts: writeAccountBackup() / readAccountBackup()
  [x] ethereum.ts: deriveEncryptionSeed() — EIP-712 fixed nonce → keccak256(sig)
  [x] backup-account-modal.svelte: auto-stamp fetch, dropdown, hash + copy, all account types
  [x] Key export re-auth for all account types (settings "Show private keys")
  [x] /backup/recover: decrypt → preview → restore; EIP-712 seed reused (no extra popup)
  [x] Para wallet EIP-712 support (commit f19f181) — full Para backup + recovery

Phase 5 — NOT STARTED
  [ ] Feed activity log (opt-in, per-identity feed topics + timestamps)
  [ ] Recovery pointer: platform registry feed mapping ethAddress → backup hash
  [ ] User-owned postage batch option

Phase 6 — NOT STARTED
  [ ] Sub-ENS (user.woco.eth / event.woco.eth) — maps to feedSignerAddress for public identities
  [ ] Shared feeds writable by user + platform

Phase 7 — COMPLETE ✓
  [x] Lib bundle split: client.esm.js (205KB) + proxy.esm.js (466KB)
      lib/src/client.ts, lib/src/proxy-entry.ts, rollup.config.js 3-bundle output
      package.json exports: @swarm-id/lib/client, @swarm-id/lib/proxy
  [x] Option A: Passkey binding for wallet users
      swarm-ui/src/lib/utils/passkey-binding.ts: PRF → AES-GCM(masterKey) → IndexedDB
      account-auth.ts: tryPasskeyBinding() before wallet fallback
      Settings UI: "Add passkey for fast signing" / "Remove passkey binding"
  [x] EIP-712 delegation certificate (opt-in, default stays private/unlinkable)
      swarm-ui/src/lib/utils/delegation-certificate.ts: sign, verify, Swarm upload/download
      Settings UI: "Make this identity public" with immutability warning + confirmation
      Certificate stored as CAC on Swarm (same pattern as backups)
      ENS discovery deferred to Phase 6 — hash in localStorage for now
  [ ] Option B: 2FA feed signing (post-integration, offered as settings upgrade)

DEBRANDING — NOT YET DONE:
  Page titles, auth-card, sign-in-card, creation-layout, SwarmLogo, rpName: "Swarm ID" → "Identity"

============================================================================
KNOWN LIMITATIONS / HONEST CAVEATS
============================================================================

1. iOS SAFARI — PARTIAL (~90%). Cross-tab revocation: iframe needs localStorage polling (no server
   needed) or server session endpoint. Must build before claiming full iOS production support.

2. SWARM BACKUP — HASH MUST BE STORED EXTERNALLY. CAC = no deterministic address.
   Hash in localStorage + user. Phase 5: platform registry feed. No hash = can't recover.

3. SWARM BACKUP — BATCH TTL. Stamp must stay funded. No indefinite storage.

4. PASSKEY — CATASTROPHIC RECOVERY: FIXED. /backup/recover passkey path now has a
   "All my passkeys are gone — use recovery phrase" toggle. mnemonicToMasterKey() → masterKey →
   deriveBackupKeypair → decrypt. Account created with credentialId: 'mnemonic-recovery' placeholder.
   Warning shown in done phase: register a new passkey in Settings to enable future sign-in.

5. PASSKEY PRF — NOT UNIVERSALLY SUPPORTED. Firefox partial. BIP-39 mnemonic covers fallback.

6. BREAKING PRF SALT CHANGE. Affects snaha/swarm-id passkey users at id.ethswarm.org only.
   WoCo users unaffected (own passkey-account.ts, own salt).

7. ed25519 CANNOT SIGN SWARM FEEDS. All Swarm signing = secp256k1.

8. ETHEREUM ACCOUNT MIGRATION (publickey → eip712). Old accounts work via legacy fallback.
   Migration UI BUILT (commit f7fce2f): Account Details drawer shows "Security upgrade available"
   warning + "Upgrade account security" button for legacy-scheme accounts. 2 wallet signatures.
   New accounts always created with encryptionScheme: 'eip712'.

9. ecies.ts + feed-recovery.ts: crypto exists in swarm-ui/src/lib/utils/, NOT wired to UI.

10. LIB BUNDLE — SPLIT COMPLETE. @swarm-id/lib now has 3 entrypoints:
    @swarm-id/lib (492KB full), @swarm-id/lib/client (205KB lean), @swarm-id/lib/proxy (466KB).
    WoCo dApps should import from @swarm-id/lib/client for ~287KB savings.

11. OPTION B 2FA FEEDS — BREAKING CHANGE. Existing identities get a new feedSigner address.
    Requires migration handoff chunk. Build only after Option A is validated.

12. ENS DELEGATION CERTIFICATE — OPT-IN ONLY. Default mode stays unlinkable (snaha-compatible).
    Once published, certificate is immutable on Swarm. User must create new identity to go private.

============================================================================
FEED TAXONOMY
============================================================================

User-signed (identity secp256k1, HKDF from masterKey + identityId):
  woco/profile/{ethAddress}  woco/pod/collection/{ethAddress}  woco/social/{ethAddress}/posts

Platform-signed (FEED_PRIVATE_KEY):
  woco/event/directory  woco/event/{eventId}  woco/event/creator/{ethAddress}
  woco/pod/editions/{seriesId}  woco/pod/claims/{seriesId}  woco/pod/pending-claims/{seriesId}

Content-addressed (found by hash only):
  Swarm backup blob (ECIES-encrypted) — hash in localStorage + shown to user
  Delegation certificate (public, NOT encrypted) — hash in localStorage, opt-in per identity

Public identity index (planned, Phase 6 ENS integration):
  woco/identity/{walletAddress} → ENS text record pointing to delegation certificate hash

============================================================================
GATEWAY NOTES
============================================================================

gateway.woco-net.com — WoCo home server (not for Devcon scale)
gateway.ethswarm.org — production recommendation
localhost:1633        — Bee node API (local dev)

Sub-ENS + consistent gateway URL = same browser origin → no ITP, one rpId for passkeys.
Different gateways = different origins = ITP partitions storage + different passkey rpIds.
