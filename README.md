# x402-miden-agent-sdk

TypeScript SDK for AI agents to create **private wallets** on [Miden](https://miden.io) and handle [x402](https://www.x402.org/) HTTP payment flows.

## What is this?

This SDK fills the **Agent Wallet** and **Payment Protocol** layers for Miden:

```
┌─────────────────────────────────────────────────┐
│  Layer 4: Agent Creation (AgentKit equivalent)  │
├─────────────────────────────────────────────────┤
│  Layer 3: Agent Wallet    ← this SDK            │
├─────────────────────────────────────────────────┤
│  Layer 2: Payment (x402)  ← this SDK            │
├─────────────────────────────────────────────────┤
│  Layer 1: Settlement (Miden ZK Rollup)          │
└─────────────────────────────────────────────────┘
```

An AI agent can:
1. **Create a private wallet** — balance and transaction history hidden via ZK proofs
2. **Pay for HTTP resources** — automatically handle 402 responses with P2ID payments
3. **Prove payments locally** — STARK proofs generated client-side, no trusted third party

## Install

```bash
npm install x402-miden-agent-sdk
```

> **Note:** This SDK depends on `@miden-sdk/miden-sdk` which uses WASM. It works in browsers and Node.js environments with WASM support.

## Quick Start

```ts
import { MidenAgentWallet, midenFetch } from "x402-miden-agent-sdk";

// 1. Create a private wallet
const wallet = await MidenAgentWallet.create({
  rpcUrl: "https://rpc.testnet.miden.io",
});
console.log("Agent account:", wallet.accountId);

// 2. Use x402-aware fetch — automatically pays 402 responses
const response = await midenFetch(wallet, "https://api.example.com/data");
const data = await response.json();
```

## API

### MidenAgentWallet

```ts
// Create a new private wallet
const wallet = await MidenAgentWallet.create({
  rpcUrl?: string,          // Default: testnet
  publicStorage?: boolean,  // Default: false (private)
  storeName?: string,       // Isolate multiple agents
});

// Restore from previous session
const wallet = await MidenAgentWallet.restore("0xaccountId");

// Check balance
const balance = await wallet.getBalance();
// { accountId: "0x...", assets: [{ faucetId: "0x...", amount: 1000n }] }

// Send payment directly
const txId = await wallet.sendPayment(recipientId, faucetId, amount);

// Create P2ID proof without submitting (for x402 flow)
const { provenTransactionHex, transactionId } = await wallet.createP2IDProof(
  recipientId, faucetId, amount
);

// Sync with network
await wallet.sync();

// Cleanup
wallet.destroy();
```

### x402 Payment Handler

```ts
import { X402PaymentHandler } from "x402-miden-agent-sdk";

const handler = new X402PaymentHandler(wallet, {
  maxPayment: 10000n,                    // Max amount per payment
  allowedFaucets: ["0xfaucet"],          // Only pay with these tokens
  allowedNetworks: ["miden:testnet"],    // Only pay on these networks
});

// Handle a 402 response
const result = await handler.handlePaymentRequired(response);
if (result) {
  // Retry with payment header
  const paid = await fetch(url, {
    headers: { Payment: result.paymentHeader },
  });
}
```

### x402-aware Fetch

```ts
import { createMidenFetch, midenFetch } from "x402-miden-agent-sdk";

// Option A: Direct call
const response = await midenFetch(wallet, "https://api.example.com/data", {
  maxPayment: 5000n,
  dryRun: false,  // Set true to inspect 402 without paying
});

// Option B: Create a bound fetch function
const fetch402 = createMidenFetch(wallet, { maxPayment: 5000n });
const response = await fetch402("https://api.example.com/data");
```

## How x402 Works on Miden

1. Agent sends HTTP request to a paid API
2. Server responds with **402 Payment Required** + payment requirements
3. SDK selects a compatible requirement (scheme: "exact", network: "miden:*")
4. Agent wallet creates a **P2ID note** (Pay-to-ID) targeting the server's account
5. Transaction is **proven locally** (STARK proof) — not submitted to network
6. Proven transaction is encoded in the `Payment` header
7. Server's **facilitator** verifies the STARK proof and submits to Miden
8. Server returns the paid resource

Privacy: The agent's wallet balance and transaction history remain private. Only the specific payment note is visible to the facilitator.

## Companion: x402-chain-miden (Rust)

The server-side facilitator that verifies and settles these payments is implemented in [x402-chain-miden](https://github.com/Himess/x402-chain-miden).

## License

Apache-2.0
