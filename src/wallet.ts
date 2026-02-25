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
  Logger,
} from "./types.js";

/** Default Miden testnet RPC endpoint. */
const DEFAULT_RPC_URL = "https://rpc.testnet.miden.io";

/** Regex for validating hex-encoded IDs (with or without 0x prefix). */
const HEX_RE = /^(0x)?[0-9a-fA-F]+$/;

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
  private log: Logger;

  private constructor(client: WebClient, account: Account, logger?: Logger) {
    this.client = client;
    this.account = account;
    this._accountId = account.id().toString();
    this.log = logger ?? noopLogger;
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
    const log = config.logger ?? noopLogger;
    const rpcUrl = config.rpcUrl ?? DEFAULT_RPC_URL;
    const storageMode = config.publicStorage
      ? AccountStorageMode.public()
      : AccountStorageMode.private();

    log.info("Creating new agent wallet", { rpcUrl, publicStorage: !!config.publicStorage });

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

    const wallet = new MidenAgentWallet(client, account, log);
    log.info("Agent wallet created", { accountId: wallet.accountId });
    return wallet;
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
    const log = config.logger ?? noopLogger;
    const rpcUrl = config.rpcUrl ?? DEFAULT_RPC_URL;

    log.info("Restoring agent wallet", { accountIdHex, rpcUrl });

    const client = await WebClient.createClient(
      rpcUrl,
      config.noteTransportUrl,
      config.seed,
      config.storeName,
    );

    let accountId;
    try {
      accountId = AccountId.fromHex(accountIdHex);
    } catch (err) {
      throw new Error(
        `Invalid account ID "${accountIdHex}": ${err instanceof Error ? err.message : String(err)}`
      );
    }

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

    return new MidenAgentWallet(client, account, log);
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
    // Input validation
    if (amount <= 0n) {
      throw new Error("Amount must be positive");
    }
    if (!HEX_RE.test(recipientId)) {
      throw new Error("Invalid hex format for recipientId");
    }
    if (!HEX_RE.test(faucetId)) {
      throw new Error("Invalid hex format for faucetId");
    }

    this.log.info("Sending payment", { recipientId, faucetId, amount: amount.toString(), noteType });

    let senderAccountId, targetAccountId, faucetAccountId;
    try {
      senderAccountId = AccountId.fromHex(this._accountId);
      targetAccountId = AccountId.fromHex(recipientId);
      faucetAccountId = AccountId.fromHex(faucetId);
    } catch (err) {
      throw new Error(
        `Invalid account ID: ${err instanceof Error ? err.message : String(err)}`
      );
    }

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

    this.log.info("Payment sent", { transactionId: txId.toString() });
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
    // Input validation
    if (amount <= 0n) {
      throw new Error("Amount must be positive");
    }
    if (!HEX_RE.test(recipientId)) {
      throw new Error("Invalid hex format for recipientId");
    }
    if (!HEX_RE.test(faucetId)) {
      throw new Error("Invalid hex format for faucetId");
    }
    // recipientId is the payTo field — validate it as well
    if (!HEX_RE.test(recipientId)) {
      throw new Error("Invalid hex format for payTo");
    }

    this.log.info("Generating P2ID proof", { recipientId, faucetId, amount: amount.toString(), noteType });

    let senderAccountId, targetAccountId, faucetAccountId;
    try {
      senderAccountId = AccountId.fromHex(this._accountId);
      targetAccountId = AccountId.fromHex(recipientId);
      faucetAccountId = AccountId.fromHex(faucetId);
    } catch (err) {
      throw new Error(
        `Invalid account ID: ${err instanceof Error ? err.message : String(err)}`
      );
    }

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

    this.log.info("P2ID proof generated", { transactionId: txId });

    return {
      provenTransactionHex: provenTxHex,
      transactionId: txId,
    };
  }

  /**
   * Waits for a transaction to be included in a block.
   *
   * **Not yet implemented.** The Miden WebClient does not currently expose a
   * transaction confirmation API, so there is no reliable way to detect when
   * a specific transaction has been included in a block. Calling this method
   * will always throw.
   *
   * Track transaction confirmation manually by calling `sync()` and
   * inspecting your account state or note status.
   *
   * @param _txId - Transaction ID to wait for (unused)
   * @param _timeoutMs - Maximum wait time in ms (unused)
   * @throws Always throws — not yet implemented.
   */
  async waitForTransaction(_txId: string, _timeoutMs = 60_000): Promise<void> {
    throw new Error(
      "waitForTransaction is not yet implemented. Track transaction confirmation manually via syncState().",
    );
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
// Internal logger
// ============================================================================

const noop = () => {};
const noopLogger: Logger = { debug: noop, info: noop, warn: noop, error: noop };

// ============================================================================
// Helpers
// ============================================================================

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
