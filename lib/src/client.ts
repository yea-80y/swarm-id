/**
 * Swarm ID Client Entrypoint
 *
 * Lean entrypoint for dApps — includes SwarmIdClient + types + lightweight utils.
 * Does NOT include SwarmIdProxy or heavy proxy internals (Bee API, feeds, ACT, mantaray).
 *
 * Usage: import { SwarmIdClient } from '@swarm-id/lib/client'
 */

// Main client for parent windows
export { SwarmIdClient } from "./swarm-id-client"

// URL building utilities
export { buildAuthUrl } from "./utils/url"

// Lightweight hex conversion (no heavy crypto)
export { hexToUint8Array, uint8ArrayToHex } from "./utils/key-derivation"

// Time and session constants
export {
  SECOND,
  MINUTE,
  HOUR,
  DAY,
  DEFAULT_SESSION_DURATION,
} from "./utils/constants"

// TTL calculation and formatting
export {
  calculateTTLSeconds,
  formatTTL,
  getBlockTimestamp,
  calculateExpiryTimestamp,
  fetchSwarmPrice,
  SWARMSCAN_STATS_URL,
  GNOSIS_BLOCK_TIME,
} from "./utils/ttl"

// Constant exports
export { SWARM_SECRET_PREFIX } from "./types"

// Network settings constants
export { DEFAULT_BEE_NODE_URL, DEFAULT_GNOSIS_RPC_URL } from "./schemas"

// Type exports — everything a dApp needs for type-checking
export type {
  ClientOptions,
  AuthStatus,
  ButtonStyles,
  UploadResult,
  FileData,
  PostageBatch,
  UploadOptions,
  ActUploadOptions,
  SOCReader,
  SOCWriter,
  SingleOwnerChunk,
  SocUploadResult,
  SocRawUploadResult,
  FeedReaderOptions,
  FeedWriterOptions,
  FeedReader,
  FeedWriter,
  SequentialFeedReaderOptions,
  SequentialFeedWriterOptions,
  SequentialFeedUpdateOptions,
  SequentialFeedUploadOptions,
  SequentialFeedPayloadResult,
  SequentialFeedReferenceResult,
  SequentialFeedUploadResult,
  SequentialFeedReader,
  SequentialFeedWriter,
  UploadProgress,
  RequestOptions,
  DownloadOptions,
  Reference,
  BatchId,
  Address,
  ParentToIframeMessage,
  IframeToParentMessage,
  PopupToIframeMessage,
  SetSecretMessage,
  AuthData,
  AppMetadata,
  ButtonConfig,
  ConnectionInfo,
} from "./types"

// Entity types from schemas
export type {
  Account,
  PasskeyAccount,
  EthereumAccount,
  AgentAccount,
  Identity,
  ConnectedApp,
  PostageStamp,
  NetworkSettings,
} from "./schemas"
