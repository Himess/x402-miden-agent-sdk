import { describe, it, expect, vi } from "vitest";
import type {
  MidenPaymentRequirements,
  PaymentRequired,
} from "../types.js";

// We can't easily test midenFetch without mocking global fetch,
// so these tests focus on the logic and edge cases.

function createMockRequirements(
  overrides: Partial<MidenPaymentRequirements> = {},
): MidenPaymentRequirements {
  return {
    scheme: "exact",
    network: "miden:testnet",
    amount: "500",
    payTo: "0xrecipient",
    maxTimeoutSeconds: 300,
    asset: "0xfaucet",
    ...overrides,
  };
}

function createMockWallet(accountId = "0xagent") {
  return {
    accountId,
    createP2IDProof: vi.fn().mockResolvedValue({
      provenTransactionHex: "cafebabe",
      transactionId: "tx-fetch-001",
    }),
  } as any;
}

describe("midenFetch", () => {
  it("passes through non-402 responses", async () => {
    // Dynamically import to work with mocked fetch
    const { midenFetch } = await import("../fetch.js");

    const mockResponse = new Response('{"data": "ok"}', { status: 200 });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    try {
      const wallet = createMockWallet();
      const response = await midenFetch(wallet, "https://example.com/api");

      expect(response.status).toBe(200);
      expect(wallet.createP2IDProof).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns 402 in dry-run mode without paying", async () => {
    const { midenFetch } = await import("../fetch.js");

    const body: PaymentRequired = {
      x402Version: 2,
      accepts: [createMockRequirements()],
      resource: { url: "https://example.com/api", method: "GET" },
    };
    const mockResponse = new Response(JSON.stringify(body), {
      status: 402,
      headers: { "Content-Type": "application/json" },
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    try {
      const wallet = createMockWallet();
      const response = await midenFetch(wallet, "https://example.com/api", {
        dryRun: true,
      });

      expect(response.status).toBe(402);
      expect(wallet.createP2IDProof).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("retries with Payment header on 402", async () => {
    const { midenFetch } = await import("../fetch.js");

    const body: PaymentRequired = {
      x402Version: 2,
      accepts: [createMockRequirements()],
      resource: { url: "https://example.com/api", method: "GET" },
    };

    const originalFetch = globalThis.fetch;
    const mockFetch = vi.fn()
      // First call → 402
      .mockResolvedValueOnce(
        new Response(JSON.stringify(body), {
          status: 402,
          headers: { "Content-Type": "application/json" },
        }),
      )
      // Second call (retry with Payment header) → 200
      .mockResolvedValueOnce(
        new Response('{"data": "paid"}', { status: 200 }),
      );
    globalThis.fetch = mockFetch;

    try {
      const wallet = createMockWallet();
      const response = await midenFetch(wallet, "https://example.com/api");

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(wallet.createP2IDProof).toHaveBeenCalledOnce();

      // Verify the retry included a Payment header
      const retryCall = mockFetch.mock.calls[1];
      const retryHeaders = retryCall[1]?.headers as Headers;
      expect(retryHeaders.has("Payment")).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns original 402 when no compatible scheme found", async () => {
    const { midenFetch } = await import("../fetch.js");

    const body: PaymentRequired = {
      x402Version: 2,
      accepts: [createMockRequirements({ amount: "999999" })],
      resource: { url: "https://example.com/api", method: "GET" },
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 402,
        headers: { "Content-Type": "application/json" },
      }),
    );

    try {
      const wallet = createMockWallet();
      const response = await midenFetch(wallet, "https://example.com/api", {
        maxPayment: 1n,
      });

      // Returns the original 402 response (not a synthetic one)
      expect(response.status).toBe(402);
      const responseBody = await response.json();
      expect(responseBody.x402Version).toBe(2);
      expect(responseBody.accepts).toHaveLength(1);
      // No payment was attempted
      expect(wallet.createP2IDProof).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("createMidenFetch", () => {
  it("returns a bound fetch function with default options", async () => {
    const { createMidenFetch } = await import("../fetch.js");

    const wallet = createMockWallet();
    const fetchFn = createMidenFetch(wallet, { dryRun: true });

    expect(typeof fetchFn).toBe("function");

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("OK", { status: 200 }),
    );

    try {
      const response = await fetchFn("https://example.com/api");
      expect(response.status).toBe(200);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("midenFetchWithCallback", () => {
  it("calls callback when payment is made", async () => {
    const { midenFetchWithCallback } = await import("../fetch.js");

    const body: PaymentRequired = {
      x402Version: 2,
      accepts: [createMockRequirements()],
      resource: { url: "https://example.com/api", method: "GET" },
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(body), {
          status: 402,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response('{"data": "paid"}', { status: 200 }),
      );

    try {
      const wallet = createMockWallet();
      const callback = vi.fn();

      const response = await midenFetchWithCallback(
        wallet,
        "https://example.com/api",
        {},
        callback,
      );

      expect(response.status).toBe(200);
      expect(callback).toHaveBeenCalledOnce();
      expect(callback.mock.calls[0][0].transactionId).toBe("tx-fetch-001");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
