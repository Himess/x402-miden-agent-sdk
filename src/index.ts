/**
 * x402 Miden Agent SDK
 *
 * TypeScript SDK for AI agents to create private wallets on Miden
 * and handle x402 HTTP payment flows.
 *
 * @packageDocumentation
 */

// Core wallet
export { MidenAgentWallet } from "./wallet.js";

// x402 payment handler
export {
  X402PaymentHandler,
  decodePaymentHeader,
  type PaymentHandlerOptions,
} from "./payment-handler.js";

// x402-aware fetch
export {
  midenFetch,
  createMidenFetch,
  midenFetchWithCallback,
  type PaymentCallback,
} from "./fetch.js";

// Types
export type {
  AgentWalletConfig,
  MidenNetwork,
  FungibleAssetInfo,
  WalletBalance,
  MidenPaymentRequirements,
  MidenExactPayload,
  V2PaymentPayload,
  ResourceInfo,
  PaymentRequired,
  PaymentResult,
  MidenFetchOptions,
} from "./types.js";
