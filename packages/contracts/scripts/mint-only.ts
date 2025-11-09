// scripts/mint-only-attach.ts
import { Contract } from "ethers";
import { AccountId, TokenId, TokenInfoQuery } from "@hashgraph/sdk";
import * as dotenv from "dotenv";
import * as path from "path";
import {
  associateAccountWithTokenSdk,
  banner,
  borrowerWallet,
  borrowerHederaKey,
  canonicalAddressFromAlias,
  ensureOperatorHasHbar,
  formatRevertError,
  hederaClient,
  hederaOperatorId,
  hederaOperatorKey,
  hederaOperatorWallet,
  logControllerMintStatus,
  logMintAttemptEvents,
  Hex,
} from "./util";
import { UsdHtsController__factory } from "../typechain-types";
import type { UsdHtsController } from "../typechain-types";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

// ──────────────────────────────────────────────────────────────────────────────
// ATTACH-ONLY CONSTANTS (NO DEPLOYMENTS)
// ──────────────────────────────────────────────────────────────────────────────
const CONTROLLER_ADDR = "0x00000000000000000000000000000000006e34db"; // UsdHtsController (0.0.7222491)
const CONTROLLER_ID   = "0.0.7222491";

const TOKEN_ID_STR    = "0.0.7222497";
const TOKEN_EVM_ADDR  = "0x00000000000000000000000000000000006e34e1";

const HEDERA_CREDIT_ADDR = "0x00000000000000000000000000000000006e34e0"; // only for static probes

// Small mint to keep fees tiny (controller uses 6 decimals typically)
const MINT_AMOUNT = 192n;

// Mirror + HTS allowance query helpers
const hederaMirrorUrl =
  process.env.HEDERA_MIRROR_URL?.trim() ?? "https://testnet.mirrornode.hedera.com";
const MIRROR_DEBUG_DELAY_MS = Number(process.env.MIRROR_DEBUG_DELAY_MS ?? "4000");

async function main() {
  banner("Mint-only — ATTACH to existing contracts (NO DEPLOYMENTS)");

  const operatorEvm = "0xc57C28748A8f14469ab82ED07f23F6F7bD14d0ef";
  const operatorHederaEvm = ("0x" + hederaOperatorId.toSolidityAddress()) as Hex;

  const borrowerAlias = await borrowerWallet.getAddress();
  const borrowerAccountEvm = await canonicalAddressFromAlias(borrowerAlias);
  const borrowerAccountId = AccountId.fromSolidityAddress(borrowerAccountEvm).toString();

  console.log("Hedera operator:", hederaOperatorId.toString());
  console.log("Hedera operator EVM:", operatorEvm);
  console.log("Hedera operator HEDERA EVM:", operatorHederaEvm);
  console.log("Borrower alias EVM:", borrowerAlias);
  console.log("Borrower canonical EVM:", borrowerAccountEvm);

  await logMirrorAccountInfo("Treasury account", hederaOperatorId.toString());
  await logMirrorAccountInfo("Borrower account", borrowerAccountId);

  banner("Ensuring Hedera operator has HBAR for fees");
  await ensureOperatorHasHbar(operatorEvm);

  // ──────────────────────────────────────────────────────────────────────────────
  // Attach to controller and sanity-check pointers (no wiring calls)
  // ──────────────────────────────────────────────────────────────────────────────
  const controller = UsdHtsController__factory.connect(CONTROLLER_ADDR, hederaOperatorWallet);
  console.log(`  → UsdHtsController: ${CONTROLLER_ADDR}, (${CONTROLLER_ID})`);
  let usdTokenAddr = "0x0000000000000000000000000000000000000000";
  let treasuryAddr = "0x0000000000000000000000000000000000000000";
  try {
    const [owner, paused, decs, token, treas] = await Promise.all([
      controller.owner(),
      controller.paused(),
      controller.usdDecimals(),
      controller.usdToken(),
      controller.treasuryAccount(),
    ]);
    usdTokenAddr = token;
    treasuryAddr = treas;
    console.log("  Controller owner:", owner, "| paused:", paused, "| usdDecimals:", decs);
    console.log("  Controller.usdToken:", usdTokenAddr);
    console.log("  Controller.treasuryAccount:", treasuryAddr);
  } catch (e) {
    console.warn("  ⚠ controller reads failed:", (e as Error).message);
  }

  // Quick hard guard: make sure the controller already points to *your* token/treasury.
  if (usdTokenAddr.toLowerCase() !== TOKEN_EVM_ADDR.toLowerCase()) {
    throw new Error(
      `Controller.usdToken != TOKEN_EVM_ADDR (${usdTokenAddr} vs ${TOKEN_EVM_ADDR}). Refusing to mint.`
    );
  }
  if (treasuryAddr.toLowerCase() !== operatorHederaEvm.toLowerCase()) {
    console.warn(
      `  ⚠ Controller.treasuryAccount != operator account (${treasuryAddr} vs ${operatorHederaEvm}).`
    );
    console.warn("    If this isn’t expected, re-run your ‘link’ step in a deploy flow.");
  }

  // ──────────────────────────────────────────────────────────────────────────────
  // Token info + associations (SDK)
  // ──────────────────────────────────────────────────────────────────────────────
  banner("Token info snapshot (mirror + SDK)");
  try {
    const tokenInfo = await new TokenInfoQuery()
      .setTokenId(TokenId.fromString(TOKEN_ID_STR))
      .execute(hederaClient);
    console.log("  Token treasury:", tokenInfo.treasuryAccountId?.toString?.());
    console.log("  Token supply key:", tokenInfo.supplyKey?.toString?.() ?? "<none>");
    console.log("  Token admin key:", tokenInfo.adminKey?.toString?.() ?? "<none>");
  } catch (e) {
    console.warn("  ⚠ TokenInfo query failed:", (e as Error).message);
  }

  banner("Associating accounts with token (SDK)");
  try {
    await associateAccountWithTokenSdk(
      AccountId.fromString(borrowerAccountId),
      borrowerHederaKey,
      TokenId.fromString(TOKEN_ID_STR),
      hederaClient,
      "Borrower"
    );
    console.log("  ✓ Borrower associated via SDK");
  } catch (e) {
    console.warn("  (Borrower association):", (e as Error).message);
  }
  try {
    await associateAccountWithTokenSdk(
      hederaOperatorId,
      hederaOperatorKey,
      TokenId.fromString(TOKEN_ID_STR),
      hederaClient,
      "Treasury"
    );
    console.log("  ✓ Treasury associated via SDK");
  } catch (e) {
    console.warn("  (Treasury association):", (e as Error).message);
  }

  banner("Mirror: token association snapshot");
  await logMirrorAssociations("Treasury", hederaOperatorId.toString(), TOKEN_ID_STR);
  await logMirrorAssociations("Borrower", borrowerAccountId, TOKEN_ID_STR);
  await logMirrorAssociations("Controller", CONTROLLER_ID, TOKEN_ID_STR);

  // ──────────────────────────────────────────────────────────────────────────────
  // Approve controller to move tokens out of the treasury (for the post-mint transfer)
  // ──────────────────────────────────────────────────────────────────────────────
  await logControllerMintStatus(controller, HEDERA_CREDIT_ADDR);

  // ──────────────────────────────────────────────────────────────────────────────
  // Static probes (simulated from HederaCredit) + Real mints
  // (Static probe **may** revert because precompiles would write in a static call.)
  // ──────────────────────────────────────────────────────────────────────────────
  banner("Static mint probes (simulated from HederaCredit)");
  await probeControllerMintStatic(controller, borrowerAccountEvm, Number(MINT_AMOUNT), "Borrower");
  await probeControllerMintStatic(controller, operatorEvm,        Number(MINT_AMOUNT), "Treasury");
  await probeControllerMintStatic(controller, CONTROLLER_ADDR,    Number(MINT_AMOUNT), "ControllerSelf");

  banner("Attempting real mints (sent by controller owner)");
  const amountNum = Number(MINT_AMOUNT);
  await mintWithDebug(
    controller,
    borrowerAccountEvm,
    amountNum,
    "Borrower",
    TOKEN_EVM_ADDR,
    TOKEN_ID_STR,
    borrowerAccountId
  );
  await mintWithDebug(
    controller,
    operatorEvm,
    amountNum,
    "Treasury",
    TOKEN_EVM_ADDR,
    TOKEN_ID_STR,
    hederaOperatorId.toString()
  );
  await mintWithDebug(
    controller,
    CONTROLLER_ADDR,
    amountNum,
    "ControllerSelf",
    TOKEN_EVM_ADDR,
    TOKEN_ID_STR,
    CONTROLLER_ID
  );

  console.log("\n✅ Mint-only attach run completed.");
}

main().catch((err) => {
  console.error("\n❌ Test failed");
  console.error(err);
  process.exitCode = 1;
});

// ──────────────────────────────────────────────────────────────────────────────
// Helpers (mirror, HTS allowance, probes, mint-with-debug)
// ──────────────────────────────────────────────────────────────────────────────
async function logMirrorAssociations(label: string, accountId: string, tokenId: string) {
  try {
    if (MIRROR_DEBUG_DELAY_MS > 0) await new Promise((r) => setTimeout(r, MIRROR_DEBUG_DELAY_MS));
    const entry = await fetchMirrorAccountToken(accountId, tokenId);
    if (!entry) {
      console.warn(`  ⚠ Mirror shows no token association for ${label}`);
    } else {
      console.log(
        `  ${label}: associated=${entry.associated} balance=${entry.balance} decimals=${entry.token?.decimals ?? "?"}`
      );
    }
  } catch (err) {
    console.warn(`  ⚠ Mirror association fetch error for ${label}:`, (err as Error).message ?? err);
  }
}

async function probeControllerMintStatic(
  controller: UsdHtsController,
  to: string,
  amount: number,
  label: string
) {
  try {
    const calldata = controller.interface.encodeFunctionData("mintTo", [to, amount]);
    await hederaOperatorWallet.provider!.call({
      to: CONTROLLER_ADDR,
      from: HEDERA_CREDIT_ADDR, // simulate HederaCredit caller
      data: calldata,
    });
    console.log(`  ✓ controller.mintTo(${label}) static call (as HederaCredit) passed`);
  } catch (err) {
    console.error(
      `  ✗ controller.mintTo(${label}) static call (as HederaCredit) reverted:`,
      formatRevertError(err as Error)
    );
  }
}

async function mintWithDebug(
  controller: UsdHtsController,
  to: string,
  amount: number,
  label: string,
  tokenAddress: string,
  tokenId: string,
  mirrorAccountId: string
) {
  try {
    console.log(`  → Minting to ${label} (${to}) amount=${amount}`);
    const tx = await controller.mintTo(to, amount);
    const rcpt = await tx.wait();
    console.log(`  ✓ Mint ${label} tx`, rcpt.hash);
    await logMintAttemptEvents(rcpt, controller, `MintAttempt:${label}`, rcpt.hash);
    await logMirrorAccountInfo(`${label} account`, mirrorAccountId);
    await logMirrorAssociations(`${label} (post-mint)`, mirrorAccountId, tokenId);
  } catch (err) {
    console.error(`  ✗ Mint to ${label} failed:`, formatRevertError(err as Error));
    await logMirrorAccountInfo(`${label} account (post-fail)`, mirrorAccountId);
    await logMirrorAssociations(`${label} (post-fail)`, mirrorAccountId, tokenId);
    // continue so you can see all three results
  }
}

async function fetchMirrorAccountToken(accountId: string, tokenId: string) {
  const accountUrl = `${hederaMirrorUrl}/api/v1/accounts/${encodeURIComponent(
    accountId
  )}/tokens?limit=100`;
  try {
    const res = await fetch(accountUrl);
    if (res.ok) {
      const data: any = await res.json();
      const match = (data?.tokens ?? []).find((t: any) => t?.token_id === tokenId);
      if (match) return match;
    }
  } catch {
    // ignore
  }
  const balancesUrl = `${hederaMirrorUrl}/api/v1/tokens/${encodeURIComponent(
    tokenId
  )}/balances?limit=100&account.id=${encodeURIComponent(accountId)}`;
  try {
    const res = await fetch(balancesUrl);
    if (!res.ok) return null;
    const data: any = await res.json();
    const entry = (data?.balances ?? []).find((b: any) => b?.account === accountId);
    if (!entry) return null;
    return {
      associated: entry?.balance !== undefined,
      balance: entry?.balance ?? 0,
      token: { decimals: data?.token?.decimals },
    };
  } catch {
    return null;
  }
}

async function logMirrorAccountInfo(label: string, accountId: string) {
  try {
    if (!accountId || accountId === "0.0.0") {
      console.log(`  ${label}: <skipped>`);
      return;
    }
    const url = `${hederaMirrorUrl}/api/v1/accounts/${encodeURIComponent(
      accountId
    )}?transactions=false`;
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`  ⚠ Mirror account fetch failed for ${label} (${res.status})`);
      return;
    }
    const data: any = await res.json();
    const alias = data?.evm_address ?? data?.alias ?? "<none>";
    const balance = data?.balance?.balance ?? "unknown";
    const deleted = data?.deleted ?? false;
    console.log(
      `  ${label}: account=${data?.account ?? accountId} alias=${alias} balance=${balance} deleted=${deleted}`
    );
  } catch (err) {
    console.warn(`  ⚠ Mirror account info error for ${label}:`, (err as Error).message ?? err);
  }
}



