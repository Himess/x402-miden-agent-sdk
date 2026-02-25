import { describe, it, expect } from "vitest";
import {
  X402PaymentHandler,
  decodePaymentHeader,
  type PaymentHandlerOptions,
} from "../payment-handler.js";
import type {
  MidenPaymentRequirements,
  PaymentRequired,
  V2PaymentPayload,
} from "../types.js";

// ============================================================================
// Test helpers — mock wallet that returns deterministic values
// ============================================================================

function createMockWallet(accountId = "0xabc123") {
  return {
    accountId,
    createP2IDProof: async (
      _recipientId: string,
      _faucetId: string,
      _amount: bigint,
      _noteType: "public" | "private",
    ) => ({
      provenTransactionHex: "deadbeef",
      transactionId: "tx-0001",
    }),
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

function createMockRequirements(
  overrides: Partial<MidenPaymentRequirements> = {},
): MidenPaymentRequirements {
  return {
    scheme: "exact",
    network: "miden:testnet",
    amount: "1000",
    payTo: "0xrecipient",
    maxTimeoutSeconds: 300,
    asset: "0xfaucet",
    ...overrides,
  };
}

function create402Response(
  accepts: MidenPaymentRequirements[],
): Response {
  const body: PaymentRequired = {
    x402Version: 2,
    accepts,
    resource: { url: "https://api.example.com/data", method: "GET" },
  };
  return new Response(JSON.stringify(body), {
    status: 402,
    statusText: "Payment Required",
    headers: { "Content-Type": "application/json" },
  });
}

// ============================================================================
// Tests
// ============================================================================

describe("X402PaymentHandler", () => {
  describe("parsePaymentRequired", () => {
    it("returns null for non-402 responses", async () => {
      const handler = new X402PaymentHandler(createMockWallet());
      const response = new Response("OK", { status: 200 });
      const result = await handler.parsePaymentRequired(response);
      expect(result).toBeNull();
    });

    it("parses valid 402 response", async () => {
      const handler = new X402PaymentHandler(createMockWallet());
      const requirements = createMockRequirements();
      const response = create402Response([requirements]);

      const result = await handler.parsePaymentRequired(response);
      expect(result).not.toBeNull();
      expect(result!.x402Version).toBe(2);
      expect(result!.accepts).toHaveLength(1);
      expect(result!.accepts[0].scheme).toBe("exact");
    });

    it("returns null for invalid JSON", async () => {
      const handler = new X402PaymentHandler(createMockWallet());
      const response = new Response("not json", { status: 402 });
      const result = await handler.parsePaymentRequired(response);
      expect(result).toBeNull();
    });

    it("returns null for non-v2 body", async () => {
      const handler = new X402PaymentHandler(createMockWallet());
      const response = new Response(
        JSON.stringify({ x402Version: 1, something: "old" }),
        { status: 402 },
      );
      const result = await handler.parsePaymentRequired(response);
      expect(result).toBeNull();
    });
  });

  describe("selectRequirement", () => {
    it("selects first compatible requirement", () => {
      const handler = new X402PaymentHandler(createMockWallet());
      const reqs = [createMockRequirements()];
      const result = handler.selectRequirement(reqs);
      expect(result).not.toBeNull();
      expect(result!.scheme).toBe("exact");
    });

    it("rejects non-exact schemes", () => {
      const handler = new X402PaymentHandler(createMockWallet());
      const reqs = [
        createMockRequirements({ scheme: "streaming" as any }),
      ];
      const result = handler.selectRequirement(reqs);
      expect(result).toBeNull();
    });

    it("filters by allowed networks", () => {
      const handler = new X402PaymentHandler(createMockWallet(), {
        allowedNetworks: ["miden:mainnet"],
      });
      const reqs = [createMockRequirements({ network: "miden:testnet" })];
      const result = handler.selectRequirement(reqs);
      expect(result).toBeNull();
    });

    it("accepts matching network", () => {
      const handler = new X402PaymentHandler(createMockWallet(), {
        allowedNetworks: ["miden:testnet"],
      });
      const reqs = [createMockRequirements({ network: "miden:testnet" })];
      const result = handler.selectRequirement(reqs);
      expect(result).not.toBeNull();
    });

    it("filters by allowed faucets", () => {
      const handler = new X402PaymentHandler(createMockWallet(), {
        allowedFaucets: ["0xother-faucet"],
      });
      const reqs = [createMockRequirements({ asset: "0xfaucet" })];
      const result = handler.selectRequirement(reqs);
      expect(result).toBeNull();
    });

    it("accepts matching faucet", () => {
      const handler = new X402PaymentHandler(createMockWallet(), {
        allowedFaucets: ["0xfaucet"],
      });
      const reqs = [createMockRequirements({ asset: "0xfaucet" })];
      const result = handler.selectRequirement(reqs);
      expect(result).not.toBeNull();
    });

    it("filters by max payment", () => {
      const handler = new X402PaymentHandler(createMockWallet(), {
        maxPayment: 500n,
      });
      const reqs = [createMockRequirements({ amount: "1000" })];
      const result = handler.selectRequirement(reqs);
      expect(result).toBeNull();
    });

    it("accepts amount within max payment", () => {
      const handler = new X402PaymentHandler(createMockWallet(), {
        maxPayment: 2000n,
      });
      const reqs = [createMockRequirements({ amount: "1000" })];
      const result = handler.selectRequirement(reqs);
      expect(result).not.toBeNull();
    });

    it("selects first matching from multiple requirements", () => {
      const handler = new X402PaymentHandler(createMockWallet(), {
        allowedNetworks: ["miden:mainnet"],
      });
      const reqs = [
        createMockRequirements({ network: "miden:testnet", amount: "100" }),
        createMockRequirements({ network: "miden:mainnet", amount: "200" }),
        createMockRequirements({ network: "miden:mainnet", amount: "300" }),
      ];
      const result = handler.selectRequirement(reqs);
      expect(result).not.toBeNull();
      expect(result!.amount).toBe("200");
    });

    it("no filter means accept any exact scheme", () => {
      const handler = new X402PaymentHandler(createMockWallet());
      const reqs = [
        createMockRequirements({ network: "miden:devnet", asset: "0xrandom" }),
      ];
      const result = handler.selectRequirement(reqs);
      expect(result).not.toBeNull();
    });
  });

  describe("createPayment", () => {
    it("creates a valid payment result", async () => {
      const handler = new X402PaymentHandler(createMockWallet("0xagent"));
      const req = createMockRequirements();

      const result = await handler.createPayment(req);

      expect(result.transactionId).toBe("tx-0001");
      expect(result.requirements).toBe(req);
      expect(result.paymentHeader).toBeTruthy();

      // Decode and verify
      const decoded = decodePaymentHeader(result.paymentHeader);
      expect(decoded.x402Version).toBe(2);
      expect(decoded.payload.from).toBe("0xagent");
      expect(decoded.payload.provenTransaction).toBe("deadbeef");
      expect(decoded.payload.transactionId).toBe("tx-0001");
      expect(decoded.accepted.scheme).toBe("exact");
    });

    it("includes resource info when provided", async () => {
      const handler = new X402PaymentHandler(createMockWallet());
      const req = createMockRequirements();
      const resource = { url: "https://example.com/api", method: "POST" };

      const result = await handler.createPayment(req, resource);
      const decoded = decodePaymentHeader(result.paymentHeader);
      expect(decoded.resource).toEqual(resource);
    });
  });

  describe("handlePaymentRequired", () => {
    it("returns payment result for valid 402", async () => {
      const handler = new X402PaymentHandler(createMockWallet());
      const response = create402Response([createMockRequirements()]);

      const result = await handler.handlePaymentRequired(response);
      expect(result).not.toBeNull();
      expect(result!.transactionId).toBe("tx-0001");
      expect(result!.paymentHeader).toBeTruthy();
    });

    it("returns null for non-402", async () => {
      const handler = new X402PaymentHandler(createMockWallet());
      const response = new Response("OK", { status: 200 });

      const result = await handler.handlePaymentRequired(response);
      expect(result).toBeNull();
    });

    it("returns null when no compatible requirement found", async () => {
      const handler = new X402PaymentHandler(createMockWallet(), {
        maxPayment: 1n, // Too low for any payment
      });
      const response = create402Response([
        createMockRequirements({ amount: "999999" }),
      ]);

      const result = await handler.handlePaymentRequired(response);
      expect(result).toBeNull();
    });
  });
});

describe("decodePaymentHeader", () => {
  it("roundtrips encode → decode", () => {
    const payload: V2PaymentPayload = {
      x402Version: 2,
      accepted: createMockRequirements(),
      payload: {
        from: "0xsender",
        provenTransaction: "aabbccdd",
        transactionId: "tx-round",
      },
    };

    const encoded = btoa(JSON.stringify(payload));
    const decoded = decodePaymentHeader(encoded);

    expect(decoded.x402Version).toBe(2);
    expect(decoded.payload.from).toBe("0xsender");
    expect(decoded.payload.provenTransaction).toBe("aabbccdd");
    expect(decoded.accepted.network).toBe("miden:testnet");
  });
});
