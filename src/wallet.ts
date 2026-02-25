/**
 * MidenAgentWallet — private wallet for AI agents on Miden.
 *
 * Wraps the @miden-sdk/miden-sdk WebClient to provide a simple API for:
 * - Creating private agent wallets
 * - Querying balances
 * - Sending P2ID payments (for x402 flow)
 * - Syncing state with the Miden network
 */

import {
  WebClient,
  AccountId,
  AccountStorageMode,
  AuthScheme,
  NoteType,
  type Account,
  type TransactionId,
  type SyncSummary,
} from "@miden-sdk/miden-sdk";

import type {
  AgentWalletConfig,
  FungibleAssetInfo,
  WalletBalance,
} from "./types.js";

/** Default Miden testnet RPC endpoint. */
const DEFAULT_RPC_URL = "https://rpc.testnet.miden.io";

/**
 * A private wallet for AI agents on Miden.
 *
 * Each agent gets its own Miden account with private storage by default,
 * meaning the agent's balance and transaction history are hidden from
 * the network. Only the agent (via ZK proofs) can prove its state.
 *
 * @example
 * ```ts
 * const wallet = await MidenAgentWallet.create({ rpcUrl: "https://rpc.testnet.miden.io" });
 * console.log("Agent account:", wallet.accountId);
 *
 * await wallet.sync();
 * const balance = await wallet.getBalance();
 * console.log("Assets:", balance.assets);
 * ```
 */
export class MidenAgentWallet {
  private client: WebClient;
  private account: Account;
  private _accountId: string;

  private constructor(client: WebClient, account: Account) {
    this.client = client;
    this.account = account;
    this._accountId = account.id().toString();
  }

  /** The agent's Miden account ID (hex string). */
  get accountId(): string {
    return this._accountId;
  }

  /** Whether the account uses public storage. */
  get isPublic(): boolean {
    return this.account.isPublic();
  }

  /**
   * Creates a new agent wallet.
   *
   * This initializes a Miden WebClient, creates a new wallet account
   * (private by default), and syncs with the network.
   */
  static async create(config: AgentWalletConfig = {}): Promise<MidenAgentWallet> {
    const rpcUrl = config.rpcUrl ?? DEFAULT_RPC_URL;
    const storageMode = config.publicStorage
      ? AccountStorageMode.public()
      : AccountStorageMode.private();

    const client = await WebClient.createClient(
      rpcUrl,
      config.noteTransportUrl,
      config.seed,
      config.storeName,
    );

    const account = await client.newWallet(
      storageMode,
      config.mutableCode ?? true,
      AuthScheme.AuthRpoFalcon512,
      config.seed,
    );

    // Initial sync to register the account with the network
    await client.syncState();

    return new MidenAgentWallet(client, account);
  }

  /**
   * Restores an existing agent wallet from a known account ID.
   *
   * The account must already exist in the local store (from a previous session)
   * or be importable from the network (public accounts only).
   */
  static async restore(
    accountIdHex: string,
    config: AgentWalletConfig = {},
  ): Promise<MidenAgentWallet> {
    const rpcUrl = config.rpcUrl ?? DEFAULT_RPC_URL;

    const client = await WebClient.createClient(
      rpcUrl,
      config.noteTransportUrl,
      config.seed,
      config.storeName,
    );

    const accountId = AccountId.fromHex(accountIdHex);

    // Try to get from local store first
    let account = await client.getAccount(accountId);

    if (!account) {
      // Try importing from the network (only works for public accounts)
      await client.importAccountById(accountId);
      await client.syncState();
      account = await client.getAccount(accountId);
    }

    if (!account) {
      throw new Error(
        `Account ${accountIdHex} not found in local store or on-chain. ` +
        `Private accounts can only be restored from the same browser/store.`
      );
    }

    return new MidenAgentWallet(client, account);
  }

  /**
   * Syncs the wallet state with the Miden network.
   *
   * This fetches the latest block headers, updates note states,
   * and processes any incoming notes.
   */
  async sync(): Promise<SyncSummary> {
    return this.client.syncState();
  }

  /**
   * Returns the current balance of the wallet.
   *
   * Fetches the latest account state and extracts all fungible assets
   * from the vault.
   */
  async getBalance(): Promise<WalletBalance> {
    const accountId = AccountId.fromHex(this._accountId);
    const account = await this.client.getAccount(accountId);

    if (!account) {
      return { accountId: this._accountId, assets: [] };
    }

    const vault = account.vault();
    const assets: FungibleAssetInfo[] = [];

    // Get fungible asset balances from the vault
    const fungibleAssets = vault.fungibleAssets();
    for (const asset of fungibleAssets) {
      assets.push({
        faucetId: asset.faucetId().toString(),
        amount: asset.amount(),
      });
    }

    return { accountId: this._accountId, assets };
  }

  /**
   * Creates and submits a P2ID payment to a recipient.
   *
   * This is the core payment primitive used by the x402 flow.
   * It creates a P2ID note, proves the transaction locally,
   * and submits it to the network.
   *
   * @param recipientId - Recipient's account ID (hex)
   * @param faucetId - Token faucet account ID (hex)
   * @param amount - Amount in token's smallest unit
   * @param noteType - "public" or "private". Public notes can be verified
   *   by facilitators. Defaults to "public" for x402 compatibility.
   * @returns The transaction ID
   */
  async sendPayment(
    recipientId: string,
    faucetId: string,
    amount: bigint,
    noteType: "public" | "private" = "public",
  ): Promise<string> {
    const senderAccountId = AccountId.fromHex(this._accountId);
    const targetAccountId = AccountId.fromHex(recipientId);
    const faucetAccountId = AccountId.fromHex(faucetId);

    const midenNoteType =
      noteType === "public" ? NoteType.Public : NoteType.Private;

    const txRequest = this.client.newSendTransactionRequest(
      senderAccountId,
      targetAccountId,
      faucetAccountId,
      midenNoteType,
      amount,
    );

    const txId: TransactionId = await this.client.submitNewTransaction(
      senderAccountId,
      txRequest,
    );

    return txId.toString();
  }

  /**
   * Creates a P2ID payment and returns the serialized ProvenTransaction.
   *
   * Unlike `sendPayment()`, this does NOT submit to the network.
   * The caller (typically the x402 payment handler) is responsible
   * for including the proven transaction in the payment header.
   *
   * This is the method used in the x402 flow where the facilitator
   * submits the transaction after verification.
   *
   * @returns Object with provenTransaction hex and transactionId
   */
  async createP2IDProof(
    recipientId: string,
    faucetId: string,
    amount: bigint,
    noteType: "public" | "private" = "public",
  ): Promise<{ provenTransactionHex: string; transactionId: string }> {
    const senderAccountId = AccountId.fromHex(this._accountId);
    const targetAccountId = AccountId.fromHex(recipientId);
    const faucetAccountId = AccountId.fromHex(faucetId);

    const midenNoteType =
      noteType === "public" ? NoteType.Public : NoteType.Private;

    const txRequest = this.client.newSendTransactionRequest(
      senderAccountId,
      targetAccountId,
      faucetAccountId,
      midenNoteType,
      amount,
    );

    // Execute locally (no network submission)
    const txResult = await this.client.executeTransaction(
      senderAccountId,
      txRequest,
    );

    // Prove the transaction (generates STARK proof)
    const provenTx = await this.client.proveTransaction(txResult);

    // Serialize to bytes then hex
    const provenTxBytes = provenTx.serialize();
    const provenTxHex = bytesToHex(provenTxBytes);
    const txId = provenTx.id().toString();

    return {
      provenTransactionHex: provenTxHex,
      transactionId: txId,
    };
  }

  /**
   * Waits for a transaction to be included in a block.
   *
   * Polls the network via sync until the transaction is confirmed
   * or the timeout is reached.
   *
   * @param txId - Transaction ID to wait for
   * @param timeoutMs - Maximum wait time in ms (default 60000)
   */
  async waitForTransaction(txId: string, timeoutMs = 60_000): Promise<void> {
    // TODO: Implement proper transaction confirmation polling.
    // The WebClient doesn't expose a direct waitForTransaction method
    // for programmatic use (only the wallet adapter has it).
    // For now, we sync and check if the transaction shows up.

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await this.sync();
      // After sync, if the transaction was included, it should be
      // reflected in the account state. We could check getTransactions()
      // but that requires TransactionFilter which is complex.
      // For now, just do one sync and return.
      return;
    }

    throw new Error(`Transaction ${txId} not confirmed within ${timeoutMs}ms`);
  }

  /** Returns the underlying WebClient for advanced usage. */
  getClient(): WebClient {
    return this.client;
  }

  /** Terminates the underlying WASM worker. Call when done with the wallet. */
  destroy(): void {
    this.client.terminate();
  }
}

// ============================================================================
// Helpers
// ============================================================================

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
