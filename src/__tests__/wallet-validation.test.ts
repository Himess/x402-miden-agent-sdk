import { describe, it, expect, vi } from "vitest";

/**
 * Tests for input validation in MidenAgentWallet methods.
 *
 * Since the Miden WASM SDK cannot be loaded in a Node test environment,
 * we mock the entire @miden-sdk/miden-sdk module and test the validation
 * logic that runs before any SDK calls.
 */

// Mock the WASM SDK module before any imports from wallet.ts
vi.mock("@miden-sdk/miden-sdk", () => ({
  WebClient: {
    createClient: vi.fn(),
  },
  AccountId: {
    fromHex: vi.fn((hex: string) => ({ toString: () => hex })),
  },
  AccountStorageMode: {
    public: vi.fn(),
    private: vi.fn(),
  },
  AuthScheme: {
    AuthRpoFalcon512: "falcon512",
  },
  NoteType: {
    Public: "public",
    Private: "private",
  },
}));

describe("MidenAgentWallet input validation", () => {
  // Helper to create a wallet instance with mocked internals.
  async function createTestWallet() {
    const { MidenAgentWallet } = await import("../wallet.js");

    // Build a fake wallet by constructing an object with the same shape.
    // We bypass the private constructor via Object.create.
    const fakeClient = {
      newSendTransactionRequest: vi.fn(),
      submitNewTransaction: vi.fn().mockResolvedValue({
        toString: () => "tx-mock",
      }),
      executeTransaction: vi.fn().mockResolvedValue({}),
      proveTransaction: vi.fn().mockResolvedValue({
        serialize: () => new Uint8Array([0xca, 0xfe]),
        id: () => ({ toString: () => "tx-mock-proof" }),
      }),
      syncState: vi.fn(),
    };

    const fakeAccount = {
      id: () => ({ toString: () => "0xabc123" }),
      isPublic: () => false,
    };

    const wallet = Object.create(MidenAgentWallet.prototype);
    wallet.client = fakeClient;
    wallet.account = fakeAccount;
    wallet._accountId = "0xabc123";
    wallet.log = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

    return wallet as InstanceType<typeof MidenAgentWallet>;
  }

  describe("sendPayment validation", () => {
    it("rejects amount of 0n", async () => {
      const wallet = await createTestWallet();
      await expect(
        wallet.sendPayment("0xaabbcc", "0xddeeff", 0n),
      ).rejects.toThrow("Amount must be positive");
    });

    it("rejects negative amount", async () => {
      const wallet = await createTestWallet();
      await expect(
        wallet.sendPayment("0xaabbcc", "0xddeeff", -100n),
      ).rejects.toThrow("Amount must be positive");
    });

    it("rejects invalid hex recipientId", async () => {
      const wallet = await createTestWallet();
      await expect(
        wallet.sendPayment("not-hex!!!", "0xddeeff", 100n),
      ).rejects.toThrow("Invalid hex format for recipientId");
    });

    it("rejects invalid hex faucetId", async () => {
      const wallet = await createTestWallet();
      await expect(
        wallet.sendPayment("0xaabbcc", "zzz-bad", 100n),
      ).rejects.toThrow("Invalid hex format for faucetId");
    });

    it("accepts valid hex without 0x prefix", async () => {
      const wallet = await createTestWallet();
      const txId = await wallet.sendPayment("abcdef1234", "aabb1234", 100n);
      expect(txId).toBe("tx-mock");
    });

    it("accepts valid hex with 0x prefix", async () => {
      const wallet = await createTestWallet();
      const txId = await wallet.sendPayment("0xabcdef", "0xaabb", 1n);
      expect(txId).toBe("tx-mock");
    });
  });

  describe("createP2IDProof validation", () => {
    it("rejects amount of 0n", async () => {
      const wallet = await createTestWallet();
      await expect(
        wallet.createP2IDProof("0xaabbcc", "0xddeeff", 0n),
      ).rejects.toThrow("Amount must be positive");
    });

    it("rejects negative amount", async () => {
      const wallet = await createTestWallet();
      await expect(
        wallet.createP2IDProof("0xaabbcc", "0xddeeff", -1n),
      ).rejects.toThrow("Amount must be positive");
    });

    it("rejects invalid hex recipientId", async () => {
      const wallet = await createTestWallet();
      await expect(
        wallet.createP2IDProof("not valid hex", "0xddeeff", 100n),
      ).rejects.toThrow("Invalid hex format for recipientId");
    });

    it("rejects invalid hex faucetId", async () => {
      const wallet = await createTestWallet();
      await expect(
        wallet.createP2IDProof("0xaabbcc", "g_invalid", 100n),
      ).rejects.toThrow("Invalid hex format for faucetId");
    });

    it("returns proof for valid inputs", async () => {
      const wallet = await createTestWallet();
      const result = await wallet.createP2IDProof("0xaabbcc", "0xddeeff", 100n);
      expect(result.provenTransactionHex).toBe("cafe");
      expect(result.transactionId).toBe("tx-mock-proof");
    });
  });

  describe("waitForTransaction", () => {
    it("throws not implemented error", async () => {
      const wallet = await createTestWallet();
      await expect(
        wallet.waitForTransaction("tx-001"),
      ).rejects.toThrow(
        "waitForTransaction is not yet implemented. Track transaction confirmation manually via syncState().",
      );
    });

    it("throws even with custom timeout", async () => {
      const wallet = await createTestWallet();
      await expect(
        wallet.waitForTransaction("tx-002", 1000),
      ).rejects.toThrow("waitForTransaction is not yet implemented");
    });
  });
});
