/**
 * x402-aware fetch wrapper for AI agents.
 *
 * Wraps the native `fetch()` to automatically handle HTTP 402 responses
 * by creating P2ID payments on Miden and retrying the request.
 */

import { X402PaymentHandler } from "./payment-handler.js";
import type { MidenAgentWallet } from "./wallet.js";
import type { MidenFetchOptions, PaymentResult } from "./types.js";

/**
 * Creates an x402-aware fetch function bound to an agent wallet.
 *
 * The returned function behaves like `fetch()` but automatically handles
 * 402 Payment Required responses by:
 * 1. Parsing payment requirements
 * 2. Creating a P2ID payment proof
 * 3. Retrying the request with the Payment header
 *
 * @example
 * ```ts
 * const wallet = await MidenAgentWallet.create();
 * const fetchWithPayment = createMidenFetch(wallet);
 *
 * // Automatically pays if the server returns 402
 * const response = await fetchWithPayment("https://api.example.com/data");
 * const data = await response.json();
 * ```
 */
export function createMidenFetch(
  wallet: MidenAgentWallet,
  defaultOptions?: Partial<MidenFetchOptions>,
): (url: string | URL, options?: MidenFetchOptions) => Promise<Response> {
  return (url: string | URL, options?: MidenFetchOptions) =>
    midenFetch(wallet, url, { ...defaultOptions, ...options });
}

/**
 * Performs an HTTP request with automatic x402 payment handling.
 *
 * If the server responds with 402, this function will:
 * 1. Parse the payment requirements from the response body
 * 2. Select a compatible requirement
 * 3. Create a P2ID proof via the agent wallet (without submitting to network)
 * 4. Retry the request with the `Payment` header
 *
 * @param wallet - The agent's Miden wallet
 * @param url - The URL to fetch
 * @param options - Fetch options with x402-specific extensions
 * @returns The response (either from the original request or the paid retry)
 */
export async function midenFetch(
  wallet: MidenAgentWallet,
  url: string | URL,
  options: MidenFetchOptions = {},
): Promise<Response> {
  const {
    maxPayment,
    allowedFaucets,
    allowedNetworks,
    dryRun,
    ...fetchOptions
  } = options;

  // First request — may return 402
  const response = await fetch(url, fetchOptions);

  // Not a 402 → return as-is
  if (response.status !== 402) return response;

  // Dry run mode — return the 402 without paying
  if (dryRun) return response;

  // Create handler with constraints
  const handler = new X402PaymentHandler(wallet, {
    maxPayment,
    allowedFaucets,
    allowedNetworks,
  });

  // Try to handle the 402
  const result = await handler.handlePaymentRequired(response);
  if (!result) {
    // Can't pay (no compatible scheme, amount too high, etc.)
    // Return the original 402 response
    // Note: the original response body was already consumed by parsePaymentRequired,
    // so we create a synthetic response with the error info
    return new Response(
      JSON.stringify({
        error: "No compatible payment scheme found",
        x402Version: 2,
      }),
      {
        status: 402,
        statusText: "Payment Required",
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // Retry with the Payment header
  const retryHeaders = new Headers(fetchOptions.headers);
  retryHeaders.set("Payment", result.paymentHeader);

  const retryResponse = await fetch(url, {
    ...fetchOptions,
    headers: retryHeaders,
  });

  return retryResponse;
}

/**
 * Result callback type for tracking payments.
 * Use with `midenFetchWithCallback` to get notified of payments.
 */
export type PaymentCallback = (result: PaymentResult) => void;

/**
 * Like `midenFetch` but calls a callback when a payment is made.
 *
 * Useful for logging, analytics, or displaying payment receipts.
 *
 * @example
 * ```ts
 * const response = await midenFetchWithCallback(
 *   wallet,
 *   "https://api.example.com/data",
 *   {},
 *   (result) => console.log("Paid:", result.transactionId),
 * );
 * ```
 */
export async function midenFetchWithCallback(
  wallet: MidenAgentWallet,
  url: string | URL,
  options: MidenFetchOptions = {},
  onPayment: PaymentCallback,
): Promise<Response> {
  const {
    maxPayment,
    allowedFaucets,
    allowedNetworks,
    dryRun,
    ...fetchOptions
  } = options;

  const response = await fetch(url, fetchOptions);

  if (response.status !== 402 || dryRun) return response;

  const handler = new X402PaymentHandler(wallet, {
    maxPayment,
    allowedFaucets,
    allowedNetworks,
  });

  const result = await handler.handlePaymentRequired(response);
  if (!result) return response;

  // Notify callback
  onPayment(result);

  // Retry with payment
  const retryHeaders = new Headers(fetchOptions.headers);
  retryHeaders.set("Payment", result.paymentHeader);

  return fetch(url, { ...fetchOptions, headers: retryHeaders });
}
