/**
 * X402PaymentHandler — handles the x402 payment flow on Miden.
 *
 * Takes a 402 response, creates a P2ID payment proof via the agent wallet,
 * and returns the encoded payment header ready to be sent back.
 */

import type { MidenAgentWallet } from "./wallet.js";
import type {
  MidenPaymentRequirements,
  MidenExactPayload,
  V2PaymentPayload,
  PaymentRequired,
  PaymentResult,
  ResourceInfo,
} from "./types.js";

/** Options for payment handling. */
export interface PaymentHandlerOptions {
  /** Maximum amount willing to pay (in token smallest unit). 0n = unlimited. */
  maxPayment?: bigint;
  /** Only pay for these faucet IDs. Empty array = any. */
  allowedFaucets?: string[];
  /** Only pay on these networks (CAIP-2). Empty array = any. */
  allowedNetworks?: string[];
}

/**
 * Handles x402 payment flows for an AI agent.
 *
 * Given a 402 response from a server, this handler:
 * 1. Parses the payment requirements
 * 2. Validates them against agent constraints
 * 3. Creates a P2ID payment proof via the wallet
 * 4. Returns the encoded Payment header
 *
 * @example
 * ```ts
 * const handler = new X402PaymentHandler(wallet);
 * const result = await handler.handlePaymentRequired(response);
 * // Re-send the original request with the payment header
 * const paid = await fetch(url, {
 *   headers: { Payment: result.paymentHeader },
 * });
 * ```
 */
export class X402PaymentHandler {
  private wallet: MidenAgentWallet;
  private options: PaymentHandlerOptions;

  constructor(wallet: MidenAgentWallet, options: PaymentHandlerOptions = {}) {
    this.wallet = wallet;
    this.options = options;
  }

  /**
   * Parses a 402 response and returns the payment requirements.
   *
   * @param response - The 402 response from the server
   * @returns Parsed payment requirements or null if not a valid 402
   */
  async parsePaymentRequired(
    response: Response,
  ): Promise<PaymentRequired | null> {
    if (response.status !== 402) return null;

    try {
      const body = await response.json();
      if (!body || body.x402Version !== 2 || !Array.isArray(body.accepts)) {
        return null;
      }
      return body as PaymentRequired;
    } catch {
      return null;
    }
  }

  /**
   * Finds a compatible payment requirement from the 402 response.
   *
   * Filters requirements by:
   * - Scheme must be "exact"
   * - Network must match allowedNetworks (if set)
   * - Faucet must match allowedFaucets (if set)
   * - Amount must be <= maxPayment (if set)
   */
  selectRequirement(
    requirements: MidenPaymentRequirements[],
  ): MidenPaymentRequirements | null {
    for (const req of requirements) {
      // Must be the exact scheme
      if (req.scheme !== "exact") continue;

      // Check network allowlist
      if (
        this.options.allowedNetworks?.length &&
        !this.options.allowedNetworks.includes(req.network)
      ) {
        continue;
      }

      // Check faucet allowlist
      if (
        this.options.allowedFaucets?.length &&
        !this.options.allowedFaucets.includes(req.asset)
      ) {
        continue;
      }

      // Check max payment
      if (this.options.maxPayment && this.options.maxPayment > 0n) {
        const amount = BigInt(req.amount);
        if (amount > this.options.maxPayment) continue;
      }

      return req;
    }

    return null;
  }

  /**
   * Creates a P2ID payment proof for the given requirements.
   *
   * This calls the wallet's createP2IDProof() which:
   * 1. Builds a P2ID transaction request
   * 2. Executes it locally (no network submission)
   * 3. Generates a STARK proof
   * 4. Returns the serialized proven transaction
   *
   * The proven transaction is NOT submitted to the network — the facilitator
   * will do that after verification.
   */
  async createPayment(
    requirements: MidenPaymentRequirements,
    resource?: ResourceInfo,
  ): Promise<PaymentResult> {
    const amount = BigInt(requirements.amount);

    // Create P2ID proof without submitting to network
    const { provenTransactionHex, transactionId } =
      await this.wallet.createP2IDProof(
        requirements.payTo,
        requirements.asset,
        amount,
        // x402 requires public notes so facilitator can verify
        "public",
      );

    // Build the V2 payment payload
    const midenPayload: MidenExactPayload = {
      from: this.wallet.accountId,
      provenTransaction: provenTransactionHex,
      transactionId,
    };

    const v2Payload: V2PaymentPayload = {
      x402Version: 2,
      accepted: requirements,
      payload: midenPayload,
    };

    if (resource) {
      v2Payload.resource = resource;
    }

    // Encode as base64 for the Payment header
    const paymentHeader = encodePaymentHeader(v2Payload);

    return {
      transactionId,
      paymentHeader,
      requirements,
    };
  }

  /**
   * Full flow: parse 402 response → select requirement → create payment → return header.
   *
   * @param response - The 402 Response object
   * @returns PaymentResult with the encoded Payment header, or null if unable to pay
   */
  async handlePaymentRequired(
    response: Response,
  ): Promise<PaymentResult | null> {
    const paymentRequired = await this.parsePaymentRequired(response);
    if (!paymentRequired) return null;

    const requirement = this.selectRequirement(paymentRequired.accepts);
    if (!requirement) return null;

    return this.createPayment(requirement, paymentRequired.resource);
  }
}

// ============================================================================
// Helpers
// ============================================================================

/** Encodes a V2 payment payload as a base64 string for the Payment header. */
function encodePaymentHeader(payload: V2PaymentPayload): string {
  const json = JSON.stringify(payload, (_key, value) =>
    // BigInt → string for JSON serialization
    typeof value === "bigint" ? value.toString() : (value as unknown),
  );

  return base64Encode(json);
}

/** Decodes a base64-encoded Payment header back to a V2 payload. */
export function decodePaymentHeader(header: string): V2PaymentPayload {
  const json = base64Decode(header);
  return JSON.parse(json) as V2PaymentPayload;
}

// Universal base64 helpers (browser + Node.js)
function base64Encode(str: string): string {
  // btoa is available in browsers and Node.js >= 16
  return btoa(str);
}

function base64Decode(encoded: string): string {
  // atob is available in browsers and Node.js >= 16
  return atob(encoded);
}
