# KINXP (Explain-to-Pay)

**Goal:** Funds release only after an AI "Proof Card" explains on-chain evidence (Blockscout MCP), with price guards (Pyth) and settlement/notarization on Hedera.

## Quickstart
```bash
# 1) Install
pnpm i  # or npm i / yarn

# 2) Env
cp .env.example .env
# choose LLM_PROVIDER (anthropic|ollama) and fill the matching keys
# also set HEDERA_* , VITE_AUTOSCOUT_EXPLORER_URL, BLOCKSCOUT_API_BASE

# 3) Dev
pnpm --filter @kinxp/server dev &
pnpm --filter @kinxp/web dev
# contracts build
pnpm --filter @kinxp/contracts build
```

## Packages

* **packages/web** - React app with Blockscout **App SDK** providers and 3 panels: Explain Tx, Risk Scan, Verify->Release.
* **packages/server** - Express API that:
  * calls either **Anthropic + MCP** or local **Ollama** (Blockscout REST feed) based on `LLM_PROVIDER`
  * exposes **Hedera Agent Kit** actions (escrow + HCS)
  * (optional) checks **Pyth** price/entropy on release
* **packages/contracts** - Hardhat 3 escrow (`MilestoneEscrow.sol`) + deploy/verify script
* **prompts/** - MCP Prompt Pack for the *Prompt* prize track
# kinxp
