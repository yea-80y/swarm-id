/**
 * Swarm ID Proxy Entrypoint
 *
 * Heavy entrypoint for the proxy iframe — includes SwarmIdProxy + Bee API internals,
 * feed implementations, ACT, mantaray, storage managers, sync, batch utilization.
 *
 * Only used by the identity iframe (swarm-ui /proxy route). dApps should NOT import this.
 *
 * Usage: import { initProxy } from '@swarm-id/lib/proxy'
 */

// Proxy for iframe
export { SwarmIdProxy, initProxy } from "./swarm-id-proxy"

// Key derivation utilities (full set)
export {
  deriveSecret,
  generateMasterKey,
  hexToUint8Array,
  uint8ArrayToHex,
  verifySecret,
  utils,
} from "./utils/key-derivation"

// Batch utilization tracking
export {
  initializeBatchUtilization,
  calculateUtilizationUpdate,
  updateAfterWrite,
  saveUtilizationState,
  loadUtilizationState,
  calculateUtilization,
  toBucket,
  assignChunksToBuckets,
  serializeUint32Array,
  deserializeUint32Array,
  splitIntoChunks,
  reconstructFromChunks,
  calculateMaxSlotsPerBucket,
  hasBucketCapacity,
  createStamper,
  prepareBucketState,
  UtilizationAwareStamper,
  NUM_BUCKETS,
  BUCKET_DEPTH,
  UTILIZATION_SLOTS_PER_BUCKET,
  DATA_COUNTER_START,
  CHUNK_SIZE,
  DEFAULT_BATCH_DEPTH,
} from "./utils/batch-utilization"

// Utilization storage (IndexedDB cache)
export {
  UtilizationStoreDB,
  evictOldEntries,
  calculateContentHash,
} from "./storage/utilization-store"

export type {
  ChunkCacheEntry,
  BatchMetadata,
  CacheEvictionPolicy,
} from "./storage/utilization-store"

// Debounced utilization uploader
export { DebouncedUtilizationUploader } from "./storage/debounced-uploader"

// Versioned storage utilities
export {
  VersionedStorageManager,
  LocalStorageAdapter,
  MemoryStorageAdapter,
  createLocalStorageManager,
  createMemoryStorageManager,
  createZodParser,
  VersionedStorageSchema,
} from "./utils/versioned-storage"

// Storage managers for entities
export {
  createAccountsStorageManager,
  createIdentitiesStorageManager,
  createConnectedAppsStorageManager,
  createPostageStampsStorageManager,
  createNetworkSettingsStorageManager,
  serializeAccount,
  serializeIdentity,
  serializeConnectedApp,
  serializePostageStamp,
  serializeNetworkSettings,
} from "./utils/storage-managers"

export type { NetworkSettingsStorageManager } from "./utils/storage-managers"

// Epoch-based feeds
export {
  EpochIndex,
  SyncEpochFinder,
  AsyncEpochFinder,
  BasicEpochUpdater,
  lca,
  next,
  createSyncEpochFinder,
  createAsyncEpochFinder,
  createEpochUpdater,
  createEpochFinder,
  MAX_LEVEL,
} from "./proxy/feeds/epochs"

// State sync to Swarm
export {
  deriveAccountBackupKey,
  deriveAccountSwarmEncryptionKey,
  backupKeyToPrivateKey,
  serializeAccountState,
  deserializeAccountState,
  createSyncAccount,
  ACCOUNT_SYNC_TOPIC_PREFIX,
} from "./sync"

export type {
  AccountStateSnapshot,
  AccountMetadata,
  SyncResult,
  SyncAccountOptions,
  SyncAccountFunction,
  AccountsStoreInterface,
  IdentitiesStoreInterface,
  ConnectedAppsStoreInterface,
  PostageStampsStoreInterface,
  StamperOptions,
  FlushableStamper,
} from "./sync"

// Encrypted upload utilities
export {
  uploadEncryptedDataWithSigning,
  uploadEncryptedSOC,
  uploadSOC,
  uploadSOCViaSocEndpoint,
} from "./proxy/upload-encrypted-data"

export type {
  UploadEncryptedDataResult,
  UploadEncryptedSOCResult,
  UploadSOCResult,
} from "./proxy/upload-encrypted-data"

// ACT (Access Control Tries)
export {
  createActForContent,
  decryptActReference,
  addGranteesToAct,
  revokeGranteesFromAct,
  getGranteesFromAct,
  parseCompressedPublicKey,
  publicKeyFromPrivate,
  compressPublicKey,
  publicKeyFromCompressed,
} from "./proxy/act"

export type { ActEntry } from "./proxy/act"

// Manifest builder utilities
export {
  buildBzzCompatibleManifest,
  buildBzzManifestNode,
  buildMinimalManifest,
  extractReferenceFromManifest,
  extractEntryFromManifest,
  extractContentFromFlatManifest,
  padPayloadForSOCDetection,
  MAX_PADDED_PAYLOAD_SIZE,
} from "./proxy/manifest-builder"

export type {
  BzzCompatibleManifestResult,
  BzzManifestNodeResult,
} from "./proxy/manifest-builder"

// Mantaray tree utilities
export {
  saveMantarayTreeRecursively,
  loadMantarayTreeWithChunkAPI,
} from "./proxy/mantaray"

export type { UploadCallback } from "./proxy/mantaray"

// Schema validation exports
export {
  ReferenceSchema,
  BatchIdSchema,
  AddressSchema,
  UploadOptionsSchema,
  ActUploadOptionsSchema,
  RequestOptionsSchema,
  DownloadOptionsSchema,
  UploadResultSchema,
  FileDataSchema,
  PostageBatchSchema,
  AuthStatusSchema,
  ButtonStylesSchema,
  ParentToIframeMessageSchema,
  IframeToParentMessageSchema,
  PopupToIframeMessageSchema,
  SetSecretMessageSchema,
  AuthDataSchema,
  ActUploadDataMessageSchema,
  ActDownloadDataMessageSchema,
  ActAddGranteesMessageSchema,
  ActRevokeGranteesMessageSchema,
  ActGetGranteesMessageSchema,
  ActUploadDataResponseMessageSchema,
  ActDownloadDataResponseMessageSchema,
  ActAddGranteesResponseMessageSchema,
  ActRevokeGranteesResponseMessageSchema,
  ActGetGranteesResponseMessageSchema,
} from "./types"

// Network settings schema
export { NetworkSettingsSchemaV1 } from "./schemas"

// Batch utilization types
export type {
  BatchUtilizationState,
  ChunkWithBucket,
  UtilizationUpdate,
} from "./utils/batch-utilization"

// Versioned storage types
export type {
  VersionedStorage,
  StorageAdapter,
  VersionParser,
  Serializer,
  VersionedStorageOptions,
} from "./utils/versioned-storage"

// Epoch feed types
export type {
  Epoch,
  EpochFinder,
  EpochUpdater,
  EpochFeedOptions,
  EpochFeedWriterOptions,
  EpochLookupResult,
} from "./proxy/feeds/epochs"
