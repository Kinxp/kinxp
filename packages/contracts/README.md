# ETH ↔ USD Locker (Ethereum + Hedera)

Locked ETH on Ethereum funds a USD HTS credit line on Hedera. Repayment on Hedera releases ETH back to the borrower, optionally via LayerZero v2 message-only hooks. Pricing relies on the Pyth pull oracle model.

## Contracts

- `contracts/eth/EthCollateralOApp.sol` — Locks ETH per `orderId`, emits events for Blockscout, and (optionally) receives LayerZero `REPAID` messages so users can withdraw without trusting an operator.
- `contracts/hedera/UsdHtsController.sol` — Owns the USD token treasury/supply key. Mints to borrowers, burns on repayment, and exposes a treasury payout helper. Talks directly to the HTS precompile (`0x167`).
- `contracts/hedera/HederaCreditOApp.sol` — Pulls ETH/USD price from Pyth, enforces LTV, mints USD through the controller, burns on repayment, and can notify Ethereum over LayerZero once an order is fully repaid.
- `contracts/hedera/hedera-hts/IHederaTokenService.sol` — Minimal HTS system contract interface (create/mint/burn/transfer).

`scripts/create-hts-usd.ts` is an optional stub if you prefer creating the USD HTS token with the Hedera SDK instead of Solidity.

## Setup

```bash
pnpm --filter @kinxp/contracts install    # or npm / yarn in this package
cp packages/contracts/.env.example packages/contracts/.env
```

Populate `.env` with:

- `DEPLOYER_KEY`: Sepolia deployer private key (0x-prefixed).
- `HEDERA_ECDSA_KEY`: Hedera EVM account private key (secp256k1).
- `ETH_RPC_URL`: Sepolia RPC (Infura/Alchemy/etc.).
- `HEDERA_RPC_URL`: Defaults to `https://testnet.hashio.io/api` if omitted.
- LayerZero endpoints + EIDs (Sepolia / Hedera testnet) from the LayerZero deployments table.
- `PYTH_CONTRACT_HEDERA` and `PYTH_ETHUSD_PRICE_ID` from the Pyth network docs.

## Deploy

```bash
pnpm --filter @kinxp/contracts run build
pnpm --filter @kinxp/contracts run deploy:eth      # Deploys EthCollateralOApp to Sepolia
pnpm --filter @kinxp/contracts run deploy:hedera   # Deploys Hedera contracts, creates USD HTS, transfers controller ownership
```

Both scripts optionally wire LayerZero endpoint IDs if `LZ_EID_*` environment variables are populated.

If you prefer to create the USD HTS token via the SDK, skip the on-chain `createUsdToken` call in `deploy-hedera.ts`, run your own creation flow (treasury + supply key = controller), then call `setExistingUsdToken()` on the controller.

### Diagnostics & Scenarios

- `pnpm --filter @kinxp/contracts run add-collateral-health` â€” Deploys fresh Ethereum/Hedera contracts, funds an order, exercises the new collateral top-up flow, and prints before/after health (max borrow, liquidation threshold, LTV) straight from the Hedera mirror.

## User Flow

1. **Open ID (Ethereum)** — `createOrderId()` returns a deterministic `bytes32` orderId.
2. **Fund ETH (Ethereum)** — `fundOrder(orderId)` with `value` = ETH collateral. Confirm `OrderFunded` logs via Blockscout.
3. **Mirror Order (Hedera)** — If LayerZero messaging is enabled, the order auto-opens. Otherwise call an ops helper to populate `horders`.
4. **Associate Token (Hedera)** — Borrower associates the USD HTS token in their wallet (HashPack / MetaMask Snap flow).
5. **Borrow USD (Hedera)** — Frontend fetches fresh Pyth update data (Hermes), submits it alongside the fee to `borrow(orderId, usdAmount, updateData, maxAgeSecs)`.
6. **Repay USD (Hedera)** — Borrower approves the controller via the HTS ERC-20 facade, hands tokens to the treasury, then calls `repay(orderId, amount, true)` to burn and optionally notify Ethereum.
7. **Withdraw ETH (Ethereum)** — After the LayerZero `REPAID` message arrives (or an operator toggles the flag), the user calls `withdraw(orderId)` to release funds.

## Explorers / Ops Notes

- **Blockscout (Sepolia)** — Check funding events with the Logs API:  
  `https://eth-sepolia.blockscout.com/api?module=logs&action=getLogs&address=<EthCollateralOApp>&topic0=<keccak(OrderFunded)>`.
- **Hashscan (Hedera)** — Verify `UsdHtsController` and `HederaCreditOApp` using the official verification flow.
- LayerZero endpoints & EIDs: see LayerZero docs (Sepolia/Hedera testnet live in the 40xxx range).
- Pyth feed IDs & contract addresses: see the Pyth network registry (Hedera EVM contract + ETH/USD feed).

## Hedera Particulars

- HTS system contract: `0x167`. The provided interface covers the create/mint/burn/transfer methods used here.
- HBAR uses 8 native decimals, while the JSON-RPC mirror presents `msg.value` with 18 decimals for EVM tooling compatibility.
- Wallets must associate with the USD token before receiving or approving transfers (HIP-218 facade keeps the ERC-20 UX).

## Follow-ons

1. Register both LayerZero OApps per the LayerZero v2 quickstart (if messaging is enabled).
2. Add a lightweight UI workflow to fetch Blockscout logs, request Pyth Hermes payloads, and handle HTS associations.
3. Integrate Hedera’s ExchangeRate system contract (`0x168`) to surface fee estimates in tinybars/tinycents.
