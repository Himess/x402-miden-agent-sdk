/**
 * Core type definitions for the x402 Miden Agent SDK.
 *
 * These types define the interfaces for agent wallets, x402 payment flow,
 * and configuration options.
 */

// ============================================================================
// Agent Wallet Configuration
// ============================================================================

/** Configuration for creating a new agent wallet. */
export interface AgentWalletConfig {
  /** Miden node RPC URL. Defaults to testnet. */
  rpcUrl?: string;
  /** Note transport service URL (for private note delivery). */
  noteTransportUrl?: string;
  /** Whether account state is stored publicly on-chain. Defaults to false (private). */
  publicStorage?: boolean;
  /** Whether the account code is mutable. Defaults to true. */
  mutableCode?: boolean;
  /** Optional seed for deterministic account creation. */
  seed?: Uint8Array;
  /** Optional store name for isolating multiple agents in the same environment. */
  storeName?: string;
}

/** Known Miden network identifiers. */
export type MidenNetwork = "testnet" | "mainnet";

// ============================================================================
// Asset & Balance Types
// ============================================================================

/** A fungible asset on Miden, identified by its faucet account ID. */
export interface FungibleAssetInfo {
  /** The faucet account ID (hex string). */
  faucetId: string;
  /** The amount in the token's smallest unit. */
  amount: bigint;
}

/** Balance information for an agent wallet. */
export interface WalletBalance {
  /** The account ID of the wallet. */
  accountId: string;
  /** List of fungible assets held. */
  assets: FungibleAssetInfo[];
}

// ============================================================================
// x402 Payment Types (wire format compatible with x402-chain-miden)
// ============================================================================

/** Payment requirements from a 402 response (Miden V2 exact scheme). */
export interface MidenPaymentRequirements {
  /** Always "exact" for the Miden exact scheme. */
  scheme: "exact";
  /** CAIP-2 chain ID, e.g. "miden:testnet". */
  network: string;
  /** Payment amount in token's smallest unit (as string). */
  amount: string;
  /** Recipient account ID (hex). */
  payTo: string;
  /** Maximum timeout in seconds. */
  maxTimeoutSeconds: number;
  /** Token faucet account ID (hex). */
  asset: string;
  /** Optional extra data. */
  extra?: unknown;
}

/** The Miden-specific payload inside a V2 payment. */
export interface MidenExactPayload {
  /** Sender's account ID (hex). */
  from: string;
  /** Hex-encoded serialized ProvenTransaction. */
  provenTransaction: string;
  /** Transaction ID (hex). */
  transactionId: string;
}

/** Full V2 payment payload for the Payment header. */
export interface V2PaymentPayload {
  x402Version: 2;
  accepted: MidenPaymentRequirements;
  resource?: ResourceInfo;
  payload: MidenExactPayload;
}

/** Resource info from a 402 response. */
export interface ResourceInfo {
  url: string;
  method: string;
  headers?: Record<string, string>;
}

/** Parsed 402 response body. */
export interface PaymentRequired {
  x402Version: 2;
  accepts: MidenPaymentRequirements[];
  resource: ResourceInfo;
  error?: string;
}

// ============================================================================
// Payment Result Types
// ============================================================================

/** Result of a successful x402 payment. */
export interface PaymentResult {
  /** The transaction ID on Miden. */
  transactionId: string;
  /** The base64-encoded payment header value. */
  paymentHeader: string;
  /** Which requirements were fulfilled. */
  requirements: MidenPaymentRequirements;
}

// ============================================================================
// x402 Fetch Options
// ============================================================================

/** Options for the x402-aware fetch wrapper. */
export interface MidenFetchOptions extends RequestInit {
  /** Maximum amount willing to pay (in token smallest unit). 0 = unlimited. */
  maxPayment?: bigint;
  /** Only pay for these faucet IDs. Empty = any. */
  allowedFaucets?: string[];
  /** Only pay on these networks. Empty = any. */
  allowedNetworks?: string[];
  /** If true, do not auto-pay — just return the 402 response. */
  dryRun?: boolean;
}
