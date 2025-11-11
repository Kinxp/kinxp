import {
  formatUnits,
  parseEther,
  ethers,
} from "ethers";
import {
  ContractCreateFlow,
  ContractFunctionParameters,
  EntityIdHelper,
  TokenId,
  TokenInfoQuery,
} from "@hashgraph/sdk";
import * as dotenv from "dotenv";
import * as path from "path";
import {
  banner,
  hederaClient,
  hederaOperatorId,
  hederaOperatorWallet,
  ensureOperatorHasHbar,
  hashscanTx,
} from "./util";
import { artifacts, ethers as hreEthers } from "hardhat";

dotenv.config({ path: path.join(__dirname, "..", ".env") });

async function main() {
  banner("Deploy SimpleHtsToken");

  const hederaOperatorWalletAddress = await hederaOperatorWallet.getAddress();
  console.log("Hedera operator ID:", hederaOperatorId.toString());
  console.log("Hedera operator EVM:", hederaOperatorWalletAddress);

  banner("Ensuring Hedera operator has HBAR for fees");
  await ensureOperatorHasHbar(hederaOperatorWalletAddress);

  // ──────────────────────────────────────────────────────────────────────────────
  // Deploy SimpleHtsToken contract
  // ──────────────────────────────────────────────────────────────────────────────
  banner("Deploying SimpleHtsToken contract");
  
  const tokenArtifact = await artifacts.readArtifact("SimpleHtsToken");
  
  const contractCreate = new ContractCreateFlow()
    .setGas(3_000_000)
    .setBytecode(tokenArtifact.bytecode)
    .setConstructorParameters(new ContractFunctionParameters());

  const contractCreateResponse = await contractCreate.execute(hederaClient);
  const contractReceipt = await contractCreateResponse.getReceipt(hederaClient);
  const contractId = contractReceipt.contractId!;
  const contractAddr = '0x' + EntityIdHelper.toSolidityAddress([
    contractId.realm!,
    contractId.shard!,
    contractId.num!
  ]);

  console.log(`  → SimpleHtsToken deployed: ${contractAddr}`);
  console.log(`  → Contract ID: ${contractId.toString()}`);

  banner("Loading contract instance");
  let simpleToken;
  try {
    simpleToken = await hreEthers.getContractAt("SimpleHtsToken", contractAddr, hederaOperatorWallet);
    console.log(`  ✓ Contract loaded successfully`);
  } catch (err) {
    console.error(`  ✗ Failed to load contract:`, (err as Error).message);
    throw err;
  }

  // ──────────────────────────────────────────────────────────────────────────────
  // Create HTS token
  // ──────────────────────────────────────────────────────────────────────────────
  banner("Creating HTS token");

  try {
    const createTx = await simpleToken.createToken({
      value: parseEther("15"),
      gasLimit: 2_500_000,
    });

    const createReceipt = await createTx.wait();
    if (!createReceipt) {
      throw new Error("Token creation transaction failed - no receipt");
    }
    
    const tokenAddress = await simpleToken.token();
    const tokenId = TokenId.fromSolidityAddress(tokenAddress);

    console.log(`  ✓ Token created successfully`);
    console.log(`  → Token ID: ${tokenId.toString()}`);
    console.log(`  → Token EVM address: ${tokenAddress}`);
    console.log(`  → Creation tx: ${hashscanTx(createReceipt.hash)}`);

    // ──────────────────────────────────────────────────────────────────────────────
    // Query token info
    // ──────────────────────────────────────────────────────────────────────────────
    banner("Token info");
    try {
      const tokenInfo = await new TokenInfoQuery().setTokenId(tokenId).execute(hederaClient);
      console.log("  Token name:", tokenInfo.name ?? "<none>");
      console.log("  Token symbol:", tokenInfo.symbol ?? "<none>");
      console.log("  Token decimals:", tokenInfo.decimals ?? "<none>");
      console.log("  Token treasury:", tokenInfo.treasuryAccountId?.toString() ?? "<none>");
      console.log("  Total supply:", tokenInfo.totalSupply?.toString() ?? "0");
      console.log("  Max supply:", tokenInfo.maxSupply?.toString() ?? "<infinite>");
    } catch (err) {
      console.warn("  ⚠ Failed to query token info:", (err as Error).message);
    }

    banner("Deployment Summary");
    console.log("══════════════════════════════════════════════════════════════════════════════════════════════");
    console.log(`Contract Address: ${contractAddr}`);
    console.log(`Contract ID: ${contractId.toString()}`);
    console.log(`Token Address: ${tokenAddress}`);
    console.log(`Token ID: ${tokenId.toString()}`);
    console.log("══════════════════════════════════════════════════════════════════════════════════════════════");
  } catch (err) {
    console.error("  ✗ Failed to create token:", (err as Error).message);
    throw err;
  }

  console.log("\n✅ Deployment script completed.");
}

main().catch((err) => {
  console.error("\n❌ Deployment failed");
  console.error(err);
  process.exitCode = 1;
});
