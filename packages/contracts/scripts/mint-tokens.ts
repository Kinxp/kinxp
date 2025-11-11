import {
  formatUnits,
  getAddress,
  Contract,
} from "ethers";
import * as dotenv from "dotenv";
import * as path from "path";
import {
  banner,
  hederaOperatorWallet,
  borrowerWallet,
  hederaOperatorKey,
  borrowerHederaKey,
  hederaClient,
  ensureOperatorHasHbar,
  hashscanTx,
  formatRevertError,
  canonicalAddressFromAlias,
  associateAccountWithTokenSdk,
} from "./util";
import { TokenId, AccountId } from "@hashgraph/sdk";
import { ethers as hreEthers } from "hardhat";

dotenv.config({ path: path.join(__dirname, "..", ".env") });

/**
 * HEDERA TOKEN RECEIVING EXPLANATION:
 * 
 * Yes, you CAN receive tokens in Hedera! However, there's one requirement:
 * 
 * 1. The account must first "associate" with the token (one-time opt-in)
 * 2. Association must be done by the account owner (they sign the transaction)
 * 3. Once associated, the account can receive tokens from anyone, anytime
 * 
 * This is a security feature to prevent spam tokens. Once an account associates
 * with a token, it can receive that token type forever (unless the association
 * is revoked).
 * 
 * If a recipient hasn't associated yet, the mint will fail with a clear error.
 * The recipient needs to call the HTS precompile's associateToken function
 * using their own wallet/private key.
 */

// Configuration
const CONTRACT_TOKEN = process.env.CONTRACT_TOKEN || "";
const TOKEN_DECIMALS = 6; // Hardcoded in contract
const MINT_AMOUNT = 1000000000; // 1000 tokens with 6 decimals

// Default recipient addresses
const DEFAULT_RECIPIENTS = [
  "0xc57C28748A8f14469ab82ED07f23F6F7bD14d0ef",
  "0x20102Fc8E8a6Fd21aFa1c7326C7F6fD4Fea76DA8",
  "0x25D40008ffC27D95D506224a246916d7E7ac0f36",
];

async function main() {
  banner("Mint Tokens to Users");

  if (!CONTRACT_TOKEN) {
    throw new Error("CONTRACT_TOKEN environment variable is required");
  }

  const contractAddr = getAddress(CONTRACT_TOKEN);
  const hederaOperatorWalletAddress = await hederaOperatorWallet.getAddress();

  console.log("Contract Address:", contractAddr);
  console.log("Operator Address:", hederaOperatorWalletAddress);

  banner("Ensuring Hedera operator has HBAR for fees");
  await ensureOperatorHasHbar(hederaOperatorWalletAddress);

  const simpleToken = await hreEthers.getContractAt("SimpleHtsToken", contractAddr, hederaOperatorWallet);
  
  // Get token address
  const tokenAddress = await simpleToken.token();
  if (tokenAddress === "0x0000000000000000000000000000000000000000") {
    throw new Error("Token not created yet. Please deploy and create token first.");
  }

  const tokenId = TokenId.fromSolidityAddress(tokenAddress);
  console.log("Token Address:", tokenAddress);
  console.log("Token ID:", tokenId.toString());

  // Parse recipients from environment variable or use defaults
  const RECIPIENTS_STR = process.env.RECIPIENTS || "";
  let recipients: string[];
  
  if (RECIPIENTS_STR) {
    recipients = RECIPIENTS_STR.split(",").map(r => r.trim()).filter(r => r.length > 0);
  } else {
    recipients = DEFAULT_RECIPIENTS;
    console.log("Using default recipient addresses");
  }
  
  if (recipients.length === 0) {
    throw new Error("No recipients provided");
  }

  banner(`Minting ${formatUnits(BigInt(MINT_AMOUNT), TOKEN_DECIMALS)} tokens to ${recipients.length} recipient(s)`);

  for (let i = 0; i < recipients.length; i++) {
    const recipientAddress = getAddress(recipients[i]);

    try {
      console.log(`\n  [${i + 1}/${recipients.length}] Processing ${recipientAddress}`);
      console.log(`    Amount: ${formatUnits(BigInt(MINT_AMOUNT), TOKEN_DECIMALS)} tokens (${MINT_AMOUNT} raw units)`);

      // Attempt to associate token (if we have the recipient's wallet, this will work)
      // Note: In Hedera, accounts must "associate" with tokens before receiving them
      // This is a one-time opt-in security feature. Once associated, tokens can be received normally.
      banner(`Associating token with ${recipientAddress}`);
      
      // Determine which wallet to use for association (must be the recipient's own wallet)
      const operatorAddress = await hederaOperatorWallet.getAddress();
      const borrowerAddress = await borrowerWallet.getAddress();
      
      let recipientWallet: typeof hederaOperatorWallet | null = null;
      
      if (recipientAddress.toLowerCase() === operatorAddress.toLowerCase()) {
        recipientWallet = hederaOperatorWallet;
        console.log(`    → Using operator wallet for association`);
      } else if (recipientAddress.toLowerCase() === borrowerAddress.toLowerCase()) {
        recipientWallet = borrowerWallet;
        console.log(`    → Using borrower wallet for association`);
      } else {
        console.warn(`    ⚠ No wallet found for ${recipientAddress}`);
        console.warn(`    → Available wallets: operator=${operatorAddress}, borrower=${borrowerAddress}`);
        console.warn(`    → Recipient must associate manually using their private key`);
      }
      
      if (recipientWallet) {
        try {
          // Try SDK method first (more reliable)
          try {
            const recipientCanonical = await canonicalAddressFromAlias(recipientAddress);
            const recipientAccountId = AccountId.fromSolidityAddress(recipientCanonical);
            const recipientKey = recipientAddress.toLowerCase() === operatorAddress.toLowerCase() 
              ? hederaOperatorKey 
              : borrowerHederaKey;
            
            console.log(`    → Attempting association via SDK...`);
            await associateAccountWithTokenSdk(
              recipientAccountId,
              recipientKey,
              tokenId,
              hederaClient,
              `Recipient ${i + 1}`
            );
            console.log(`    ✓ Association successful via SDK`);
          } catch (sdkErr: any) {
            // If SDK fails, try HTS precompile
            console.log(`    → SDK method failed, trying HTS precompile...`);
            const HTS_ADDRESS = "0x0000000000000000000000000000000000000167";
            const HTS_ABI = ["function associateToken(address account, address token) external returns (int64)"];
            const hts = new Contract(HTS_ADDRESS, HTS_ABI, recipientWallet);
            
            try {
              // The account parameter must match the wallet address
              const walletAddress = await recipientWallet.getAddress();
              if (walletAddress.toLowerCase() !== recipientAddress.toLowerCase()) {
                throw new Error(`Wallet address ${walletAddress} does not match recipient ${recipientAddress}`);
              }
              
              const associateTx = await hts.associateToken(recipientAddress, tokenAddress, {
                gasLimit: 2_500_000,
              });
              const associateReceipt = await associateTx.wait();
              console.log(`    ✓ Association successful via HTS precompile`);
            } catch (htsErr: any) {
              const errorMsg = formatRevertError(htsErr);
              if (errorMsg.includes("TOKEN_ALREADY_ASSOCIATED") || 
                  errorMsg.includes("already associated") ||
                  errorMsg.includes("TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT")) {
                console.log(`    ✓ Token already associated`);
              } else {
                console.warn(`    ⚠ HTS precompile association failed: ${errorMsg}`);
                console.warn(`    → Full error:`, htsErr);
                throw htsErr;
              }
            }
          }
        } catch (err: any) {
          const errorMsg = formatRevertError(err);
          if (errorMsg.includes("TOKEN_ALREADY_ASSOCIATED") || 
              errorMsg.includes("already associated")) {
            console.log(`    ✓ Token already associated`);
          } else {
            console.warn(`    ⚠ Association failed: ${errorMsg}`);
            console.warn(`    → Error details:`, err.message || err);
            console.warn(`    → Continuing with mint attempt anyway...`);
          }
        }
      }

      // Mint tokens
      banner(`Minting tokens to ${recipientAddress}`);
      console.log(`    Minting ${formatUnits(BigInt(MINT_AMOUNT), TOKEN_DECIMALS)} tokens...`);
      
      try {
        const mintTx = await simpleToken.mintTo(recipientAddress, MINT_AMOUNT, {
          gasLimit: 500_000,
        });

        const receipt = await mintTx.wait();
        if (!receipt) {
          throw new Error("Mint transaction failed - no receipt");
        }
        
        console.log(`    ✓ Mint successful`);
        console.log(`    → Transaction: ${hashscanTx(receipt.hash)}`);
      } catch (mintErr: any) {
        const errorMsg = formatRevertError(mintErr);
        if (errorMsg.includes("TOKEN_NOT_ASSOCIATED") || 
            errorMsg.includes("ACCOUNT_FROZEN_FOR_TOKEN") ||
            errorMsg.includes("association")) {
          throw new Error(`Mint failed: Recipient ${recipientAddress} must associate with token first. Error: ${errorMsg}`);
        }
        throw mintErr;
      }

      // Check balance
      try {
        const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];
        const tokenContract = new Contract(tokenAddress, ERC20_ABI, hederaOperatorWallet.provider);
        const balance = await tokenContract.balanceOf(recipientAddress);
        console.log(`    → Balance: ${formatUnits(balance, TOKEN_DECIMALS)} tokens`);
      } catch (err) {
        console.warn(`    ⚠ Could not check balance: ${(err as Error).message}`);
      }
    } catch (err) {
      console.error(`  ✗ Failed to mint to ${recipientAddress}:`, formatRevertError(err));
      // Continue with next recipient
    }
  }

  banner("Minting Summary");
  console.log("══════════════════════════════════════════════════════════════════════════════════════════════");
  console.log(`Token Address: ${tokenAddress}`);
  console.log(`Token ID: ${tokenId.toString()}`);
  console.log(`Amount per recipient: ${formatUnits(BigInt(MINT_AMOUNT), TOKEN_DECIMALS)} tokens`);
  console.log(`Recipients processed: ${recipients.length}`);
  console.log("══════════════════════════════════════════════════════════════════════════════════════════════");

  console.log("\n✅ Minting script completed.");
}

main().catch((err) => {
  console.error("\n❌ Minting failed");
  console.error(err);
  process.exitCode = 1;
});
