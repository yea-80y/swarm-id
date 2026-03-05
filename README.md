# WoCo Fork — Swarm Identity Management

> **This is a fork of [snaha/swarm-id](https://github.com/snaha/swarm-id) maintained by [WoCo](https://github.com/yea-80y/WoCo-Event-App).**
> The fork targets production use in the WoCo event platform and contributes fixes intended for upstreaming to snaha/swarm-id.
> See [upstream issues referenced below](#changes-from-upstream).

---

## Changes from Upstream

### 1. PRF Salt — Domain-Agnostic Key Derivation (fixes portability)

**File:** `swarm-ui/src/lib/passkey.ts`

The upstream salt for passkey PRF evaluation was `SHA256("${hostname}:ethereum-wallet-v1")`, which binds the derived key to the deployment domain. If the identity service moves to a new domain, users lose access to their keys.

This fork changes the salt to:

```ts
const PRF_SALT_INPUT = 'hd-wallet-seed-v1'
```

This is a **purpose-describing string**, not a domain-specific one. The derived key describes *what it is* (an HD wallet seed) rather than *where it lives*. Platform-specificity is achieved via BIP-44 derivation paths, not the salt — so the same passkey can produce the same keys across any compliant identity service.

> **Breaking change for existing accounts at id.ethswarm.org.** WoCo users are unaffected (WoCo has its own passkey implementation with a separate salt). A migration path should be included if proposing this as an upstream PR.

**Related upstream issue:** [#189](https://github.com/snaha/swarm-id/issues/189)

---

### 2. iOS Safari postMessage Fallback (~90% coverage)

**Files:** `swarm-ui/src/routes/(app)/connect/+page.svelte`, `lib/src/swarm-id-proxy.ts`

Safari's Intelligent Tracking Prevention (ITP) partitions `localStorage` between popup windows and their opener iframes, breaking the authentication flow on iOS. The upstream workaround requires disabling cross-site tracking, which is not acceptable for production.

This fork adds a `postMessage` fallback:

- When the auth popup closes with `proxyMode=true`, it sends the derived secret directly to `window.opener` via `postMessage`
- The iframe (`SwarmIdProxy`) receives this via `handleSetSecretFromPopup()` — same-origin validated, no spoofing possible
- The `PopupToIframeMessageSchema` / `SetSecretMessage` types already existed in the codebase; they are now wired up

**Remaining 10%:** Safari also blocks storage events in all cross-context scenarios, breaking session revocation (logout in one tab not reflected in others). A lightweight server-side session endpoint is needed for full iOS production support — this is tracked but not yet built.

**Related upstream issue:** [#167](https://github.com/snaha/swarm-id/issues/167)

---

### 3. Passkey BIP-39 Mnemonic Backup (implements account recovery)

**Files:**
- `swarm-ui/src/lib/utils/passkey-mnemonic.ts` — core crypto utilities
- `swarm-ui/src/routes/(app)/(create)/passkey/mnemonic/+page.svelte` — backup display UI
- `swarm-ui/src/routes/(app)/(create)/passkey/recover/+page.svelte` — recovery UI

Passkey accounts had no account recovery path — if the authenticator was lost, the account was permanently inaccessible ([#191](https://github.com/snaha/swarm-id/issues/191)).

This fork implements BIP-39 mnemonic backup:

**Key insight:** The 32-byte HKDF output (master key) that the passkey PRF produces is exactly 256 bits — the entropy for a 24-word BIP-39 mnemonic. The round-trip is lossless:

```
passkey PRF → HKDF → 32-byte masterKey
masterKey bytes → Mnemonic.fromEntropy() → 24 words
24 words → Mnemonic.fromPhrase().entropy → same 32 bytes
```

**What was built:**

- `masterKeyToMnemonic(masterKey)` — derives the 24-word phrase
- `mnemonicToMasterKey(phrase)` — recovers the same master key
- `storeMnemonicBackup(credentialId, masterKey)` — AES-GCM encrypts the mnemonic with a random device key and stores both in IndexedDB (`swarm-id-passkey-backup` DB, keyed by credentialId)
- `loadMnemonicBackup(credentialId)` / `deleteMnemonicBackup(credentialId)` — load and cleanup

**UX flow:**

1. User creates passkey account → biometric prompt
2. **New:** User lands on mnemonic page showing 24 words in a numbered grid
3. Copy button available; warning box displayed ("never enter this anywhere")
4. Confirmation checkbox gates the continue button
5. On confirm: backup stored to IndexedDB → navigate to identity creation as before

**Recovery:** `/passkey/recover` route — enter 24 words, re-derive master key, look up account by derived Ethereum address, restore session identically to a successful passkey auth.

**Related upstream issue:** [#191](https://github.com/snaha/swarm-id/issues/191)

---

### 4. uploadFile() Encryption (fixes security bug)

**File:** `lib/src/swarm-id-proxy.ts` — `handleUploadFile()`

The upstream `uploadFile()` proxy handler called `bee.uploadFile()` directly, uploading content to Swarm in plaintext ([#187](https://github.com/snaha/swarm-id/issues/187)).

This fork routes all file uploads through the existing encrypted chunk pipeline:

```
before: bee.uploadFile(postageBatchId, data, name)   ← plaintext
after:  uploadEncryptedDataWithSigning(context, data, swarmEncryptionKey)  ← encrypted
```

- Uses each account's `swarmEncryptionKey` (a 32-byte key already derived from masterKey via HMAC and stored with the account)
- Retrieved via the existing `lookupAccountForApp()` method
- Returns a 64-byte encrypted reference (128 hex chars) — the `ReferenceSchema` already supported this format
- **No plaintext fallback** — if the encryption key cannot be resolved, the upload is refused

> **Note:** The `name` / content-type metadata that `bee.uploadFile()` supported is not preserved in the encrypted chunk path. File bytes are fully preserved. Mantaray manifest wrapping for filename metadata is a follow-up.

**Related upstream issue:** [#187](https://github.com/snaha/swarm-id/issues/187)

---

### 5. User-Owned Feed Writes — BIP-44 Feed Signer (Phase 3)

**Files:**
- `lib/src/utils/feed-signer.ts` — `deriveBip44FeedSigner()` BIP-44 key derivation
- `swarm-ui/src/lib/utils/feed-signer.ts` — same utility for the identity UI
- `lib/src/swarm-id-client.ts` — `makeUserEpochFeedWriter()` and `getUserFeedSignerAddress()`
- `lib/src/swarm-id-proxy.ts` — proxy holds feed signer, sends address to parent on auth
- `lib/src/utils/storage-managers.ts` — `feedSignerKey` persisted in connected-apps

The upstream architecture routes all Swarm writes through the identity service (or a platform server). This phase adds the infrastructure for users to own and sign their personal Swarm feeds directly, with no server in the loop.

**Key derivation:**

```
masterKey (from passkey/web3/agent)
  └─ BIP-44 m/44'/60'/1'/0/0  →  secp256k1 feed signer
       ├─ privateKey (hex)   →  stored in connected-apps on identity service origin only
       └─ address            →  sent to parent dApp via authSuccess postMessage
```

The derivation path `m/44'/60'/1'/0/0` is the cross-platform default Swarm feed signer. It's standard BIP-44 — compatible with MetaMask import, Ledger, and Trezor.

**What the parent dApp gets:**

```ts
// After authentication:
const address = client.getUserFeedSignerAddress()  // Ethereum address (public, safe to log)

// Create a writer — signs chunks client-side without the server:
const writer = client.makeUserEpochFeedWriter(topic)
await writer.upload(stamp, data, { at: Date.now() })
```

The feed signer private key never leaves the identity service origin. The parent dApp gets a `feedSignerAddress` (to identify the feed) and a writer object (to sign chunks) — the signing happens inside the hidden iframe, which holds the key in memory after auth.

**Storage design:** The `feedSignerKey` is stored in `swarm-id-connected-apps` on the identity service origin (same key as `appSecret`). The parent dApp's localStorage is untouched — it only ever sees the public address.

**Auth paths:** All three proxy auth paths send `feedSignerAddress` in `authSuccess`:
1. `loadAuthData()` — initial page load (restores from stored session)
2. `authenticateFromStorage()` — storage event (Chrome/Firefox popup close)
3. `handleSetSecretFromPopup()` — iOS Safari postMessage fallback

---

## Build Setup

```bash
# 1. Initialize the bee-js submodule (required — it's empty after clone)
git submodule update --init --recursive

# 2. Install workspace dependencies
pnpm install

# 3. Build the forked bee-js (webpack, ~30s)
pnpm build:bee-js

# 4. Build the lib package (rollup, ~20s)
pnpm --filter @swarm-id/lib build

# 5. Start identity UI dev server
pnpm dev:swarm-ui   # http://localhost:5174
```

---

## Roadmap

| Phase | Status | Description |
|---|---|---|
| 1 — Fork fixes | ✅ Complete | PRF salt, iOS postMessage, BIP-39 backup, uploadFile encryption |
| 2 — Feed signer backup | 🔶 Partial | Crypto code done (ECIES, feed-recovery.ts, key export). UI not wired yet. |
| 3 — User-owned feed writes | ✅ Complete | BIP-44 feed signer, client-side signing, feedSignerAddress to parent |
| 4 — ENS sub-records | Planned | ENS text records as feed key recovery pointers |

---

## Upstream Credit

This project is built on [snaha/swarm-id](https://github.com/snaha/swarm-id) (Apache 2.0).
The encrypted bee-js fork is [agazso/bee-js](https://github.com/agazso/bee-js/tree/feat/encrypted-chunk-streams).

---

# Swarm Identity Management

This monorepo implements a cross-browser compatible authentication and identity management system for Swarm dApps.

## Packages

- **[lib/](./lib/README.md)** - The Swarm ID TypeScript library for authentication and Bee API operations
- **[swarm-ui/](./swarm-ui/)** - SvelteKit-based identity management UI
- **[demo/](./demo/)** - Demo dApp with library integration examples
- **[docs-site/](./docs-site/)** - Starlight (Astro) documentation website
- **[bee-js/](https://github.com/agazso/bee-js/tree/feat/encrypted-chunk-streams)** - A custom fork of the [bee-js](https://github.com/ethersphere/bee-js) library, containing encrypted, streaming chunked upload and download functionality.

## Architecture

The project uses an OAuth-style popup authentication flow using the Storage Access API. Chrome and Firefox work out of the box; Safari requires disabling cross-site tracking prevention.

**Key Innovation**: The popup-based authentication allows dApps to securely derive app-specific secrets from a master identity, with browser-enforced storage partitioning providing cross-app isolation.

## Live Demos

The applications are deployed and available at:

- **Demo App**: [https://swarm-demo.snaha.net](https://swarm-demo.snaha.net)
- **Identity UI**: [https://swarm-id.snaha.net](https://swarm-id.snaha.net)

### Deployment

Both apps are deployed to Digital Ocean App Platform as separate static sites:

**swarm-demo.snaha.net** (`demo/build/`)

- SvelteKit demo app showcasing SwarmIdClient integration
- Built with `@sveltejs/adapter-static`

**swarm-id.snaha.net** (`swarm-id-build/`)

- SvelteKit identity management UI
- Proxy/auth pages for iframe communication

## Quick Start

### Build Everything

```bash
# Clone the forked bee-js library
git clone https://github.com/agazso/bee-js

# Build the forked bee-js library
cd bee-js && git checkout feat/encrypted-chunk-streams && npm install && npm build

# Install all workspace dependencies
pnpm install

# Build library + both apps
pnpm build

# Or build specific apps
pnpm build:swarm-demo    # Builds lib + demo app
pnpm build:swarm-id      # Builds lib + identity UI
```

### Build Outputs

**demo/build/** (Demo App)

```
demo/build/
├── index.html          # SvelteKit static output (SPA fallback)
└── _app/               # Vite-bundled assets (JS, CSS)
```

**swarm-id-build/** (Identity UI)

```
swarm-id-build/
├── [SvelteKit app files including prerendered routes: /proxy, /connect]
└── _app/               # Vite-bundled assets (JS, CSS)
```

See [lib/README.md](./lib/README.md) for detailed library documentation.

## Local Development Setup

### Quick Start

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000 - that's it!

- Demo app runs on port 3000
- Identity UI runs on port 5174
- No HTTPS, certificates, or custom domains required (`localhost` is a secure context)

**Note:** Safari requires disabling cross-site tracking prevention (Settings → Privacy → uncheck "Prevent cross-site tracking"). See [#167](https://github.com/snaha/swarm-id/issues/167) for details.

### Development Mode (with hot reload)

```bash
# Start both demo and identity UI
pnpm dev

# Or start individually
pnpm dev:swarm-ui    # Identity UI on port 5174
pnpm dev:demo        # Demo on port 3000
pnpm dev:lib         # Library watch mode (rebuilds on changes)
```

### Local Bee Cluster (FDP Play)

For local development with postage stamps and uploads, use FDP Play to run a local Bee cluster with blockchain. Requires Docker.

```bash
# Start cluster (queen + 1 worker node)
pnpm dev:bee:detach

# View logs
pnpm dev:bee:logs

# Stop cluster
pnpm dev:bee:stop

# Fresh start (pull latest images, purge data)
pnpm dev:bee:fresh
```

**Endpoints:**

| Service        | URL                      |
| -------------- | ------------------------ |
| Queen Bee API  | `http://localhost:1633`  |
| Worker 1 API   | `http://localhost:11633` |
| Blockchain RPC | `http://localhost:9545`  |

**Buying a Postage Stamp:**

The easiest way is to use the Developer Tools page in the Identity UI:

1. Navigate to http://localhost:5174/dev
2. Go to the **Stamps** tab
3. Click **Buy Stamp** with the default settings

Or use the Bee API directly:

```bash
# Buy stamp (amount=10000000, depth=17)
curl -X POST "http://localhost:1633/stamps/10000000/17"

# Wait ~30 seconds, then verify it's usable:
curl "http://localhost:1633/stamps/<batchID>"
```

**Client-Side Stamp Signing:**

Stamps bought via the API are owned by the queen node. Use the queen's private key for client-side signing:

```typescript
import { Stamper } from '@ethersphere/bee-js'

const queenKey = '566058308ad5fa3888173c741a1fb902c9f1f19559b11fc2738dfc53637ce4e9'
const stamper = Stamper.fromBlank(queenKey, batchId, depth)
const envelope = stamper.stamp(chunk)
```

**Known Keys:**

| Node     | Private Key                                                        | Address                                      |
| -------- | ------------------------------------------------------------------ | -------------------------------------------- |
| Queen    | `566058308ad5fa3888173c741a1fb902c9f1f19559b11fc2738dfc53637ce4e9` | `0x26234a2ad3ba8b398a762f279b792cfacd536a3f` |
| Worker 1 | `195cf6324303f6941ad119d0a1d2e862d810078e1370b8d205552a543ff40aab` | -                                            |

### Developer Tools (/dev route)

The Identity UI includes a Developer Tools page at http://localhost:5174/dev with utilities for local development:

- **Overview**: Quick start guide and local Bee endpoint links with copy buttons
- **Stamps**: Buy postage stamps from the local Bee node using pre-funded signer keys
- **Sync**: Manually trigger account sync to test postage stamp utilization tracking

### Testing with Real Domains (SSH Tunnel)

To test storage partitioning behavior with real TLS certificates (as in production), you can use SSH tunnels to a VPS with nginx.

**Architecture:**

```
Your VPS (nginx + HTTPS)              Your Local Machine
┌─────────────────────────┐           ┌─────────────────────┐
│ demo.yourdomain.com     │◄──────────│ SSH -R tunnels      │
│   → 127.0.0.1:18080     │           │   18080 → demo      │
│ id.yourdomain.com       │           │   5174 → identity   │
│   → 127.0.0.1:5174      │           │   (Vite dev server) │
└─────────────────────────┘           └─────────────────────┘
```

**VPS Setup (one-time):**

1. Add nginx server blocks pointing to `127.0.0.1:18080` (demo) and `127.0.0.1:5174` (identity)
2. Get SSL certificates with certbot
3. Add DNS A records for both subdomains

**Local usage:**

```bash
# Terminal 1: Start demo server
pnpm dev:demo

# Terminal 2: Start SvelteKit dev server with allowed hosts
VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=id.yourdomain.com pnpm dev:swarm-ui

# Terminal 3: Open SSH tunnel
ssh -R 18080:localhost:3000 -R 5174:localhost:5174 user@your-vps
```

**Note:** The `VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` environment variable is required when accessing the Vite dev server through a foreign hostname. Without it, Vite will reject requests from the tunneled domain.

**Access the demo:**

```
https://demo.yourdomain.com/?idDomain=https://id.yourdomain.com
```

The `?idDomain=` parameter tells the demo which identity service to use. This allows testing cross-origin storage partitioning with real browser security policies while still having hot reload for the identity UI.

**Important:**

- If you change library code, rebuild it: `cd lib && pnpm build`
- Use `cd lib && pnpm build:watch` for automatic rebuilds during development

## Project Structure

```
.
├── lib/                  # Swarm ID TypeScript library
│   ├── src/              # Library source code
│   ├── dist/             # Built library files (ES6 modules)
│   └── README.md         # Library documentation
├── demo/                 # Demo app (SvelteKit)
│   ├── src/              # SvelteKit source code
│   │   ├── routes/       # SvelteKit routes (/, /feeds, /soc, etc.)
│   │   └── lib/          # Stores, components, utilities
│   └── build/            # Build output (deployed to swarm-demo.snaha.net)
├── swarm-ui/             # SvelteKit identity management UI
│   ├── src/              # SvelteKit source code
│   │   └── routes/       # SvelteKit routes including /proxy and /connect
│   └── build/            # SvelteKit production build
├── docs-site/            # Starlight documentation site
│   ├── src/content/docs/ # Documentation pages (MDX)
│   └── dist/             # Built static site
├── bee-js/               # bee-js library (linked dependency)
└── swarm-id-build/       # Build output (deployed to swarm-id.snaha.net)
```

### Key Build Artifacts

**Library Distribution** (`lib/dist/`)

- ES6 modules with TypeScript definitions
- Source maps for debugging
- ~350KB per module (uncompressed)
- Imported via standard `<script type="module">`

**Demo App Build** (`demo/build/`)

- SvelteKit static build via `@sveltejs/adapter-static`
- Vite bundles all dependencies (library included via workspace link)
- Deployed to swarm-demo.snaha.net

**Identity UI Build** (`swarm-id-build/`)

- Full SvelteKit production build
- Prerendered routes for `/proxy` and `/connect`
- Deployed to swarm-id.snaha.net

## Documentation

- **[Documentation Site](./docs-site/)**: Full documentation website (run `pnpm docs:dev` to preview)
- **[The Book of Swarm](./The-Book-of-Swarm.pdf)**: Comprehensive Swarm documentation
- **[Swarm Identity Management Proposal](./docs/Swarm-Identity-Management-Proposal.md)**: Identity system proposal
- **[Library Documentation](./lib/README.md)**: API reference and usage examples

### Documentation Development

```bash
# Start docs dev server (http://localhost:4321)
pnpm dev:docs

# Build docs for production
pnpm build:docs

# Preview production build
pnpm preview:docs
```

## Development Workflow

### Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  Browser: http://localhost:3000 (Demo App)              │
│  ┌────────────────────────────────────────────────┐     │
│  │ Demo App (SvelteKit)                            │     │
│  │                                                │     │
│  │  ┌─────────────────────────────────────────┐   │     │
│  │  │ <iframe src="http://localhost:5174">    │   │     │
│  │  │                                         │   │     │
│  │  │ Identity UI (SvelteKit)                 │   │     │
│  │  │   - Proxy for Bee API calls             │   │     │
│  │  │   - Auth popup handler                  │   │     │
│  │  └─────────────────────────────────────────┘   │     │
│  └────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────┘
```

## Development Tips

- **TypeScript Execution**: Use `pnpx tsx` instead of `npx ts-node` to run TypeScript files
- **Browser DevTools**: Check Application → Storage to verify storage partitioning
- **Hot Reload**: Changes in `swarm-ui/src/` will automatically reload in the browser
- **Debugging**: Use browser DevTools on both the parent page and the iframe

## AI Coding Agent Configuration

This project includes configuration for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and other AI coding agents, following [best practices](https://code.claude.com/docs/en/best-practices.md) for effective AI-assisted development.

### Structure

```
CLAUDE.md                        → symlink to AGENT.md
AGENT.md                         # Core project context: architecture, commands, code style rules
.claude/
├── settings.json                # Shared team settings (permissions, hooks)
├── settings.local.json          # Personal overrides (gitignored)
└── rules/                       # Modular, path-scoped instructions
    ├── swarm-ui.md              # Svelte 5, Diete, Carbon Icons (loads for swarm-ui/** only)
    ├── figma.md                 # Figma MCP workflow (loads for swarm-ui/** only)
    └── bee-cluster.md           # Local Bee cluster commands and known dev keys
```

### How It Works

- **`AGENT.md`** is the main instruction file, kept concise (~100 lines). It contains only information that would cause mistakes if absent: architecture overview, essential commands, code style rules (no-semicolons, no-null, no-any), and pre-commit requirements.

- **`.claude/rules/`** contains modular rules that load automatically based on which files are being edited. For example, Svelte 5 rune patterns and Diete design system conventions only load when working in `swarm-ui/`.

- **`.claude/settings.json`** defines shared team configuration:
  - **Permissions**: Pre-approved commands (`pnpm build`, `pnpm check:all`, `git status`, Figma MCP tools, etc.) so agents don't prompt for common operations.

- **`settings.local.json`** (gitignored) is for personal permission overrides.

### Adding New Rules

To add context that only applies to a specific package or directory, create a new `.md` file in `.claude/rules/` with a YAML frontmatter `paths` filter:

```markdown
---
paths:
  - 'lib/**'
---

# lib-specific instructions here
```

## Troubleshooting

### Demo not loading

- Check if ports 3000 and 5174 are already in use: `lsof -i :3000 -i :5174`
- Ensure both servers are running: `pnpm dev`

### Authentication popup blocked

- Allow popups for localhost in browser settings
- Ensure popup is triggered by user action (not programmatically)

### Changes not reflecting

- Library changes: restart `pnpm dev:lib` or rebuild
- SvelteKit changes: automatic hot reload

### Safari not working

Safari's Intelligent Tracking Prevention (ITP) partitions storage for third-party iframes, which breaks the authentication flow. To use Safari:

- **macOS:** Safari Settings (⌘,) → Privacy → uncheck "Prevent cross-site tracking"
- **iOS:** Settings → Apps → Safari → toggle off "Prevent Cross-Site Tracking"
- **Safari private mode** works with ITP disabled, but sessions are ephemeral (lost when the private window closes)

See [#167](https://github.com/snaha/swarm-id/issues/167) for details.

## License

[Apache 2.0](LICENSE)
