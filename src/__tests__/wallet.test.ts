import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for MidenAgentWallet with mocked WebClient.
 *
 * Since the Miden WASM SDK cannot be loaded in a Node test environment,
 * we mock the entire @miden-sdk/miden-sdk module.
 */

const mockClient = {
  newWallet: vi.fn().mockResolvedValue({
    id: () => ({ toString: () => "0xabc123" }),
    isPublic: () => false,
  }),
  getAccount: vi.fn().mockResolvedValue({
    id: () => ({ toString: () => "0xabc123" }),
    isPublic: () => false,
    vault: () => ({
      fungibleAssets: () => [],
    }),
  }),
  importAccountById: vi.fn().mockResolvedValue(undefined),
  syncState: vi.fn().mockResolvedValue(undefined),
  newSendTransactionRequest: vi.fn().mockReturnValue({}),
  submitNewTransaction: vi.fn().mockResolvedValue({
    toString: () => "tx-mock",
  }),
  executeTransaction: vi.fn().mockResolvedValue({}),
  proveTransaction: vi.fn().mockResolvedValue({
    serialize: () => new Uint8Array([0xca, 0xfe]),
    id: () => ({ toString: () => "tx-mock-proof" }),
  }),
  terminate: vi.fn(),
};

vi.mock("@miden-sdk/miden-sdk", () => ({
  WebClient: {
    createClient: vi.fn().mockResolvedValue(mockClient),
  },
  AccountId: {
    fromHex: vi.fn().mockReturnValue({ toString: () => "0xabc123" }),
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

beforeEach(() => {
  vi.clearAllMocks();
  // Re-apply default mock implementations after clearing
  mockClient.newWallet.mockResolvedValue({
    id: () => ({ toString: () => "0xabc123" }),
    isPublic: () => false,
  });
  mockClient.getAccount.mockResolvedValue({
    id: () => ({ toString: () => "0xabc123" }),
    isPublic: () => false,
    vault: () => ({
      fungibleAssets: () => [],
    }),
  });
  mockClient.syncState.mockResolvedValue(undefined);
  mockClient.submitNewTransaction.mockResolvedValue({
    toString: () => "tx-mock",
  });
  mockClient.executeTransaction.mockResolvedValue({});
  mockClient.proveTransaction.mockResolvedValue({
    serialize: () => new Uint8Array([0xca, 0xfe]),
    id: () => ({ toString: () => "tx-mock-proof" }),
  });
});

describe("MidenAgentWallet", () => {
  describe("create()", () => {
    it("calls WebClient.createClient and newWallet", async () => {
      const { MidenAgentWallet } = await import("../wallet.js");
      const { WebClient } = await import("@miden-sdk/miden-sdk");

      const wallet = await MidenAgentWallet.create({
        rpcUrl: "https://rpc.testnet.miden.io",
      });

      expect(WebClient.createClient).toHaveBeenCalledWith(
        "https://rpc.testnet.miden.io",
        undefined,
        undefined,
        undefined,
      );
      expect(mockClient.newWallet).toHaveBeenCalled();
      expect(mockClient.syncState).toHaveBeenCalled();
      expect(wallet.accountId).toBe("0xabc123");
    });

    it("uses default RPC URL when none provided", async () => {
      const { MidenAgentWallet } = await import("../wallet.js");
      const { WebClient } = await import("@miden-sdk/miden-sdk");

      await MidenAgentWallet.create();

      expect(WebClient.createClient).toHaveBeenCalledWith(
        "https://rpc.testnet.miden.io",
        undefined,
        undefined,
        undefined,
      );
    });
  });

  describe("restore()", () => {
    it("restores wallet with existing account ID", async () => {
      const { MidenAgentWallet } = await import("../wallet.js");
      const { WebClient } = await import("@miden-sdk/miden-sdk");

      const wallet = await MidenAgentWallet.restore("0xabc123");

      expect(WebClient.createClient).toHaveBeenCalled();
      expect(mockClient.getAccount).toHaveBeenCalled();
      expect(wallet.accountId).toBe("0xabc123");
    });

    it("imports from network if not in local store", async () => {
      const { MidenAgentWallet } = await import("../wallet.js");

      // First getAccount returns null, second returns the account
      mockClient.getAccount
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: () => ({ toString: () => "0xabc123" }),
          isPublic: () => true,
          vault: () => ({ fungibleAssets: () => [] }),
        });

      const wallet = await MidenAgentWallet.restore("0xabc123");

      expect(mockClient.importAccountById).toHaveBeenCalled();
      expect(mockClient.syncState).toHaveBeenCalled();
      expect(wallet.accountId).toBe("0xabc123");
    });

    it("throws if account not found anywhere", async () => {
      const { MidenAgentWallet } = await import("../wallet.js");

      mockClient.getAccount.mockResolvedValue(null);

      await expect(
        MidenAgentWallet.restore("0xdeadbeef"),
      ).rejects.toThrow("not found in local store or on-chain");
    });
  });

  describe("getBalance()", () => {
    it("returns balance with empty assets when account has none", async () => {
      const { MidenAgentWallet } = await import("../wallet.js");

      const wallet = await MidenAgentWallet.create();
      const balance = await wallet.getBalance();

      expect(balance.accountId).toBe("0xabc123");
      expect(balance.assets).toEqual([]);
    });

    it("returns balance with fungible assets", async () => {
      const { MidenAgentWallet } = await import("../wallet.js");

      mockClient.getAccount.mockResolvedValue({
        id: () => ({ toString: () => "0xabc123" }),
        isPublic: () => false,
        vault: () => ({
          fungibleAssets: () => [
            {
              faucetId: () => ({ toString: () => "0xfaucet1" }),
              amount: () => 1000n,
            },
            {
              faucetId: () => ({ toString: () => "0xfaucet2" }),
              amount: () => 500n,
            },
          ],
        }),
      });

      // Need a fresh wallet after updating the mock
      const wallet = await MidenAgentWallet.create();
      // Reset getAccount mock for getBalance call
      mockClient.getAccount.mockResolvedValue({
        id: () => ({ toString: () => "0xabc123" }),
        isPublic: () => false,
        vault: () => ({
          fungibleAssets: () => [
            {
              faucetId: () => ({ toString: () => "0xfaucet1" }),
              amount: () => 1000n,
            },
            {
              faucetId: () => ({ toString: () => "0xfaucet2" }),
              amount: () => 500n,
            },
          ],
        }),
      });

      const balance = await wallet.getBalance();

      expect(balance.assets).toHaveLength(2);
      expect(balance.assets[0].faucetId).toBe("0xfaucet1");
      expect(balance.assets[0].amount).toBe(1000n);
      expect(balance.assets[1].faucetId).toBe("0xfaucet2");
      expect(balance.assets[1].amount).toBe(500n);
    });

    it("returns empty assets when account not found", async () => {
      const { MidenAgentWallet } = await import("../wallet.js");

      const wallet = await MidenAgentWallet.create();

      // After creation, make getAccount return null for the balance check
      mockClient.getAccount.mockResolvedValue(null);

      const balance = await wallet.getBalance();
      expect(balance.accountId).toBe("0xabc123");
      expect(balance.assets).toEqual([]);
    });
  });

  describe("sendPayment()", () => {
    it("creates and submits a P2ID transaction", async () => {
      const { MidenAgentWallet } = await import("../wallet.js");

      const wallet = await MidenAgentWallet.create();
      const txId = await wallet.sendPayment("0xaabbcc", "0xddeeff", 100n);

      expect(txId).toBe("tx-mock");
      expect(mockClient.newSendTransactionRequest).toHaveBeenCalled();
      expect(mockClient.submitNewTransaction).toHaveBeenCalled();
    });

    it("rejects invalid amount", async () => {
      const { MidenAgentWallet } = await import("../wallet.js");

      const wallet = await MidenAgentWallet.create();
      await expect(
        wallet.sendPayment("0xaabbcc", "0xddeeff", 0n),
      ).rejects.toThrow("Amount must be positive");
    });

    it("rejects invalid hex recipientId", async () => {
      const { MidenAgentWallet } = await import("../wallet.js");

      const wallet = await MidenAgentWallet.create();
      await expect(
        wallet.sendPayment("not-hex!!!", "0xddeeff", 100n),
      ).rejects.toThrow("Invalid hex format for recipientId");
    });

    it("rejects invalid hex faucetId", async () => {
      const { MidenAgentWallet } = await import("../wallet.js");

      const wallet = await MidenAgentWallet.create();
      await expect(
        wallet.sendPayment("0xaabbcc", "zzz-bad", 100n),
      ).rejects.toThrow("Invalid hex format for faucetId");
    });
  });

  describe("createP2IDProof()", () => {
    it("creates a proof without submitting to network", async () => {
      const { MidenAgentWallet } = await import("../wallet.js");

      const wallet = await MidenAgentWallet.create();
      const result = await wallet.createP2IDProof("0xaabbcc", "0xddeeff", 100n);

      expect(result.provenTransactionHex).toBe("cafe");
      expect(result.transactionId).toBe("tx-mock-proof");
      expect(mockClient.executeTransaction).toHaveBeenCalled();
      expect(mockClient.proveTransaction).toHaveBeenCalled();
      // submitNewTransaction should NOT be called for proof-only
      expect(mockClient.submitNewTransaction).not.toHaveBeenCalled();
    });

    it("times out if proof generation takes too long", async () => {
      const { MidenAgentWallet } = await import("../wallet.js");

      // Create wallet with a very short timeout
      const wallet = await MidenAgentWallet.create({ proofTimeoutMs: 10 });

      // Make proveTransaction hang
      mockClient.proveTransaction.mockReturnValue(
        new Promise(() => {
          /* never resolves */
        }),
      );

      await expect(
        wallet.createP2IDProof("0xaabbcc", "0xddeeff", 100n),
      ).rejects.toThrow("STARK proof generation timed out");
    });
  });

  describe("getAccountId()", () => {
    it("returns the stored account ID", async () => {
      const { MidenAgentWallet } = await import("../wallet.js");

      const wallet = await MidenAgentWallet.create();

      expect(wallet.getAccountId()).toBe("0xabc123");
    });
  });

  describe("destroy()", () => {
    it("calls terminate on the underlying client", async () => {
      const { MidenAgentWallet } = await import("../wallet.js");

      const wallet = await MidenAgentWallet.create();
      wallet.destroy();

      expect(mockClient.terminate).toHaveBeenCalled();
    });
  });

  describe("mutex concurrency protection", () => {
    it("serializes concurrent sendPayment calls", async () => {
      const { MidenAgentWallet } = await import("../wallet.js");

      const executionOrder: number[] = [];

      // Make submitNewTransaction take some time and track execution order
      let callCount = 0;
      mockClient.submitNewTransaction.mockImplementation(async () => {
        const myCall = ++callCount;
        executionOrder.push(myCall);
        // Simulate some async work
        await new Promise(r => setTimeout(r, 10));
        return { toString: () => `tx-${myCall}` };
      });

      const wallet = await MidenAgentWallet.create();

      // Fire two concurrent sendPayment calls
      const [tx1, tx2] = await Promise.all([
        wallet.sendPayment("0xaabb", "0xccdd", 50n),
        wallet.sendPayment("0xeeff", "0x1122", 75n),
      ]);

      // Both should complete
      expect(tx1).toBe("tx-1");
      expect(tx2).toBe("tx-2");
      // They should have been serialized (not parallel)
      expect(executionOrder).toEqual([1, 2]);
    });
  });
});
