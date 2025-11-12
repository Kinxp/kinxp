import {
    formatEther,
    formatUnits,
    Contract,
    parseUnits,
    parseEther,
    keccak256,
    toUtf8Bytes,
    Log,
    Interface,
  } from "ethers";
  import {
    AccountId,
    TokenId,
  } from "@hashgraph/sdk";
  import {
    associateAccountWithTokenSdk,
    banner,
    borrowerWallet,
    DEFAULT_RESERVE_ID,
    ethSigner,
    depositWei,
    fetchPythUpdate,
    getPriceUpdateFee,
    hederaClient,
    hederaOperatorWallet,
    ensureOperatorHasHbar,
    scalePrice,
    transferOwnership,
    formatRevertError,
    getTokenBalance,
    canonicalAddressFromAlias,
    borrowerHederaKey,
  } from "./util";
  
  // ──────────────────────────────────────────────────────────────────────────────
  // HARDCODED CONTRACT ADDRESSES (from your deployment)
  // ──────────────────────────────────────────────────────────────────────────────
  const ETH_COLLATERAL_ADDR = "0x622a72B858A96C64738Ec3EE732688F2296D1680";
  const CONTROLLER_ADDR = "0x00000000000000000000000000000000006e7060";
  const HEDERA_CREDIT_ADDR = "0x00000000000000000000000000000000006e7067";
  const TOKEN_CONTRACT_ADDR = process.env.CONTRACT_TOKEN!;
  
  const HTS_ADDRESS = "0x0000000000000000000000000000000000000167";
  const HTS_ABI = ["function approve(address token, address spender, uint256 amount) external returns (int64)"];
  
  // --- CONFIGURATION ---
  const TOKEN_DECIMALS = 6;
  const WAD_DECIMALS = 18;
  
  async function main() {
    banner("PARTIAL REPAYMENT TEST SUITE");
  
    const hederaOperatorWalletAddress = await hederaOperatorWallet.getAddress();
    const borrowerAddress = await borrowerWallet.getAddress();
    const borrowerAccountAddress = await canonicalAddressFromAlias(borrowerAddress);
    const borrowerAccountIdObj = AccountId.fromSolidityAddress(borrowerAccountAddress);
  
    console.log("Hedera operator:", hederaOperatorWalletAddress);
    console.log("Borrower EVM:", borrowerAddress);
    console.log("Borrower Hedera:", borrowerAccountAddress);
  
    await ensureOperatorHasHbar(hederaOperatorWalletAddress);
  
    // Get contract instances using hardhat
    const { ethers: hreEthers } = await import("hardhat");
  
    const hederaCredit = await hreEthers.getContractAt("HederaCreditOApp", HEDERA_CREDIT_ADDR, hederaOperatorWallet);
    const ethCollateral = await hreEthers.getContractAt("EthCollateralOApp", ETH_COLLATERAL_ADDR, ethSigner);
    const controller = await hreEthers.getContractAt("UsdHtsController", CONTROLLER_ADDR, hederaOperatorWallet);
    const tokenContract = await hreEthers.getContractAt("SimpleHtsToken", TOKEN_CONTRACT_ADDR, hederaOperatorWallet);
    const hts = new Contract(HTS_ADDRESS, HTS_ABI, borrowerWallet);
  
    // Get token address
    const tokenAddress = await tokenContract.token();
    const tokenId = TokenId.fromSolidityAddress(tokenAddress);
    console.log("Token address:", tokenAddress);
    console.log("Token ID:", tokenId.toString());
  
    // Ensure borrower is associated with token
    banner("Associating borrower with token (if needed)");
    try {
      await associateAccountWithTokenSdk(
        borrowerAccountIdObj,
        borrowerHederaKey,
        tokenId,
        hederaClient,
        "Borrower"
      );
      console.log("  ✓ Borrower associated");
    } catch (err: any) {
      if (err.message?.includes("TOKEN_ALREADY_ASSOCIATED")) {
        console.log("  ✓ Already associated");
      } else {
        throw err;
      }
    }
  
    // Ensure controller has enough tokens
    banner("Checking controller token balance");
    const controllerBalance = await getTokenBalance(tokenAddress, CONTROLLER_ADDR);
    console.log("  Controller balance:", formatUnits(controllerBalance, TOKEN_DECIMALS), "tokens");
  
    // Transfer ownership to HederaCredit
    banner("Ensuring HederaCredit owns controller");
    try {
      await transferOwnership(controller, HEDERA_CREDIT_ADDR);
      console.log("  ✓ Ownership transferred");
    } catch (err: any) {
      if (err.message?.includes("already owner")) {
        console.log("  ✓ Already owns");
      } else {
        console.warn("  ⚠ Transfer failed:", formatRevertError(err));
      }
    }
  
    // Fetch price data
    banner("Fetching Pyth price");
    const { priceUpdateData, price, expo } = await fetchPythUpdate();
    const scaledPrice = scalePrice(price, expo);
    console.log("  ETH/USD:", formatUnits(scaledPrice, WAD_DECIMALS));
    const { priceUpdateFee } = await getPriceUpdateFee(priceUpdateData);
  
    // ────────────────────────────────────────────────────────────────────────────
    // SCENARIO 1: Repay 25% of debt
    // ────────────────────────────────────────────────────────────────────────────
    await runScenario({
      scenarioName: "SCENARIO 1: Repay 25% of Debt",
      hederaCredit,
      ethCollateral,
      controller,
      hts,
      tokenAddress,
      borrowerAddress,
      borrowerAccountAddress,
      hederaOperatorWalletAddress,
      priceUpdateData,
      priceUpdateFee,
      scaledPrice,
      repayPercentage: 25,
      collateralWei: parseEther("0.0001"), // 0.01 ETH
    });
  
    // ────────────────────────────────────────────────────────────────────────────
    // SCENARIO 2: Repay 50% of debt
    // ────────────────────────────────────────────────────────────────────────────
    await runScenario({
      scenarioName: "SCENARIO 2: Repay 50% of Debt",
      hederaCredit,
      ethCollateral,
      controller,
      hts,
      tokenAddress,
      borrowerAddress,
      borrowerAccountAddress,
      hederaOperatorWalletAddress,
      priceUpdateData,
      priceUpdateFee,
      scaledPrice,
      repayPercentage: 50,
      collateralWei: parseEther("0.0002"), // 0.02 ETH
    });
  
    // ────────────────────────────────────────────────────────────────────────────
    // SCENARIO 3: Multiple partial repayments (25% + 25% + 50% = 100%)
    // ────────────────────────────────────────────────────────────────────────────
    await runMultipleRepaymentScenario({
      scenarioName: "SCENARIO 3: Multiple Partial Repayments (25% + 25% + 50%)",
      hederaCredit,
      ethCollateral,
      controller,
      hts,
      tokenAddress,
      borrowerAddress,
      borrowerAccountAddress,
      hederaOperatorWalletAddress,
      priceUpdateData,
      priceUpdateFee,
      scaledPrice,
      repayPercentages: [25, 25, 50],
      collateralWei: parseEther("0.0003"), // 0.03 ETH
    });
  
    console.log("\n✅ All partial repayment scenarios completed successfully!");
  }
  
  interface ScenarioParams {
    scenarioName: string;
    hederaCredit: any;
    ethCollateral: any;
    controller: any;
    hts: Contract;
    tokenAddress: string;
    borrowerAddress: string;
    borrowerAccountAddress: string;
    hederaOperatorWalletAddress: string;
    priceUpdateData: string[];
    priceUpdateFee: bigint;
    scaledPrice: bigint;
    repayPercentage: number;
    collateralWei: bigint;
  }
  
  async function runScenario(params: ScenarioParams) {
    banner(params.scenarioName);
  
    // Step 1: Create and fund order on Ethereum
    banner("Step 1: Creating and funding order on Ethereum");
    console.log("  Collateral:", formatEther(params.collateralWei), "ETH");
  
    const createTx = await params.ethCollateral.createOrderIdWithReserve(DEFAULT_RESERVE_ID);
    const createReceipt = await createTx.wait();
  
    const orderCreatedEvent = createReceipt?.logs
      ?.map((log: any) => {
        try {
          return params.ethCollateral.interface.parseLog(log);
        } catch { return null; }
      })
      .find((e: any) => e?.name === "OrderCreated");
  
    if (!orderCreatedEvent) {
      throw new Error("Could not find OrderCreated event in the transaction receipt.");
    }
    const orderId = orderCreatedEvent.args.orderId;
    console.log("  ✓ Order created with on-chain ID:", orderId);
  
    const fundTx = await params.ethCollateral.fundOrder(orderId, {
      value: params.collateralWei,
      gasLimit: 500_000
    });
    await fundTx.wait();
    console.log("  ✓ Order funded on Ethereum");
  
    // Step 2: Mirror order on Hedera
    banner("Step 2: Mirroring order on Hedera");
    const mirrorHederaTx = await params.hederaCredit.adminMirrorOrder(
      orderId,
      DEFAULT_RESERVE_ID,
      params.borrowerAddress,
      params.borrowerAccountAddress,
      params.collateralWei
    );
    await mirrorHederaTx.wait();
    console.log("  ✓ Order mirrored on Hedera");
  
    // Step 3: Calculate borrow amount (70% LTV)
    const collateralUsdWad = (params.collateralWei * params.scaledPrice) / parseEther("1");
    const maxBorrowWad = (collateralUsdWad * 7000n) / 10000n; // 70% LTV
    const borrowAmountWad = (maxBorrowWad * 99n) / 100n; // Borrow 99% of max
  
    const scalingFactor = 10n ** BigInt(WAD_DECIMALS - TOKEN_DECIMALS);
    const borrowAmount = borrowAmountWad / scalingFactor;
  
    console.log("  Borrow amount:", formatUnits(borrowAmount, TOKEN_DECIMALS), "USD");
  
    // Step 4: Borrow
    banner("Step 3: Borrowing");
    const borrowTx = await params.hederaCredit
      .connect(borrowerWallet)
      .borrowWithReserve(
        DEFAULT_RESERVE_ID,
        orderId,
        borrowAmount,
        params.priceUpdateData,
        0,
        { value: params.priceUpdateFee, gasLimit: 2_000_000 }
      );
    await borrowTx.wait();
    console.log("  ✓ Borrowed:", formatUnits(borrowAmount, TOKEN_DECIMALS), "USD");
  
    const debtAfterBorrow = await params.hederaCredit.getOutstandingDebt(orderId);
    console.log("  Outstanding debt:", formatUnits(debtAfterBorrow, TOKEN_DECIMALS), "USD");
  
    // Step 5: Approve controller
    banner("Step 4: Approving controller");
    const repayAmount = (BigInt(params.repayPercentage) * debtAfterBorrow) / 100n;
    console.log("  Repay amount:", formatUnits(repayAmount, TOKEN_DECIMALS), "USD");
  
    const approveTx = await params.hts.approve(params.tokenAddress, CONTROLLER_ADDR, repayAmount, {
      gasLimit: 2_500_000,
    });
    await approveTx.wait();
    console.log("  ✓ Approved");
  
    // Step 6: Partial repayment
    banner("Step 5: Partial Repayment");
    const borrowerCreditContract = params.hederaCredit.connect(borrowerWallet);
    const repayTx = await borrowerCreditContract.repay(orderId, repayAmount, false, {
      gasLimit: 1_500_000
    });
    const repayReceipt = await repayTx.wait();
  
    // Step 7: Calculate collateral to unlock
    const repaidPercentageBps = (repayAmount * 10000n) / debtAfterBorrow;
    const collateralToUnlock = (params.collateralWei * repaidPercentageBps) / 10000n;
  
    banner("Step 6: Simulating Ethereum unlock (admin function)");
    const unlockTx = await params.ethCollateral.adminMirrorRepayment(
      orderId,
      DEFAULT_RESERVE_ID,
      false, // not fully repaid
      collateralToUnlock
    );
    await unlockTx.wait();
    console.log("  ✓ Collateral unlocked on Ethereum");
  
    // ADDED: Step 7 - Attempt withdrawal (expected to fail)
    banner("Step 7: Attempting Withdrawal (Expected to Fail for Partial Repayment)");
    try {
      const borrowerEthCollateral = params.ethCollateral.connect(borrowerWallet);
      const withdrawTx = await borrowerEthCollateral.withdraw(orderId);
      await withdrawTx.wait();
      console.error("  ✗ Withdrawal succeeded unexpectedly for a partial repayment.");
    } catch (err: any) {
      if (err.message?.includes("not repaid")) {
        console.log("  ✓ Withdrawal correctly failed as the order is not fully repaid.");
      } else {
        console.error("  ✗ Withdrawal failed with an unexpected error:", err.message);
      }
    }
  
    banner(`${params.scenarioName} - COMPLETE`);
  }
  
  interface MultipleRepaymentParams {
    scenarioName: string;
    hederaCredit: any;
    ethCollateral: any;
    controller: any;
    hts: Contract;
    tokenAddress: string;
    borrowerAddress: string;
    borrowerAccountAddress: string;
    hederaOperatorWalletAddress: string;
    priceUpdateData: string[];
    priceUpdateFee: bigint;
    scaledPrice: bigint;
    repayPercentages: number[];
    collateralWei: bigint;
  }
  
  async function runMultipleRepaymentScenario(params: MultipleRepaymentParams) {
    banner(params.scenarioName);
  
    banner("Step 1: Creating and funding order on Ethereum");
    const createTx = await params.ethCollateral.createOrderIdWithReserve(DEFAULT_RESERVE_ID);
    const createReceipt = await createTx.wait();
    const orderCreatedEvent = createReceipt?.logs?.map((log: any) => { try { return params.ethCollateral.interface.parseLog(log); } catch { return null; } }).find((e: any) => e?.name === "OrderCreated");
    if (!orderCreatedEvent) throw new Error("Could not find OrderCreated event.");
    const orderId = orderCreatedEvent.args.orderId;
    console.log("  ✓ Order created with on-chain ID:", orderId);
  
    const fundTx = await params.ethCollateral.fundOrder(orderId, { value: params.collateralWei, gasLimit: 500_000 });
    await fundTx.wait();
    console.log("  ✓ Order funded on Ethereum");
  
    banner("Step 2: Mirroring order on Hedera");
    await params.hederaCredit.adminMirrorOrder(orderId, DEFAULT_RESERVE_ID, params.borrowerAddress, params.borrowerAccountAddress, params.collateralWei).then(tx => tx.wait());
    console.log("  ✓ Order mirrored on Hedera");
  
    // Step 3: Borrow
    const collateralUsdWad = (params.collateralWei * params.scaledPrice) / parseEther("1");
    const maxBorrowWad = (collateralUsdWad * 7000n) / 10000n;
    const borrowAmountWad = (maxBorrowWad * 99n) / 100n;
    const scalingFactor = 10n ** BigInt(WAD_DECIMALS - TOKEN_DECIMALS);
    const borrowAmount = borrowAmountWad / scalingFactor;
  
    banner("Step 3: Borrowing");
    await params.hederaCredit.connect(borrowerWallet).borrowWithReserve(DEFAULT_RESERVE_ID, orderId, borrowAmount, params.priceUpdateData, 0, { value: params.priceUpdateFee, gasLimit: 2_000_000 }).then(tx => tx.wait());
    console.log("  ✓ Borrowed:", formatUnits(borrowAmount, TOKEN_DECIMALS), "USD");
  
    const initialDebt = await params.hederaCredit.getOutstandingDebt(orderId);
    console.log("  Initial debt:", formatUnits(initialDebt, TOKEN_DECIMALS), "USD");
  
    // Step 4: Multiple repayments
    for (let i = 0; i < params.repayPercentages.length; i++) {
      const percentage = params.repayPercentages[i];
      banner(`Step ${4 + i}: Repayment ${i + 1} (${percentage}% of original debt)`);
  
      const repayAmount = (BigInt(percentage) * initialDebt) / 100n;
      console.log("  Repaying:", formatUnits(repayAmount, TOKEN_DECIMALS), "USD");
  
      await params.hts.approve(params.tokenAddress, CONTROLLER_ADDR, repayAmount, { gasLimit: 2_500_000 }).then(tx => tx.wait());
      const repayReceipt = await params.hederaCredit.connect(borrowerWallet).repay(orderId, repayAmount, false, { gasLimit: 1_500_000 }).then(tx => tx.wait());
      const repayEvent = repayReceipt?.logs?.map((log: any) => { try { return params.hederaCredit.interface.parseLog(log); } catch { return null; } }).find((e: any) => e?.name === "RepayApplied");
      const isFullyRepaid = repayEvent?.args?.fullyRepaid ?? (i === params.repayPercentages.length -1); // Assume full repayment on last leg
  
      console.log("  ✓ Repaid:", formatUnits(repayEvent?.args?.repayBurnAmount ?? 0, TOKEN_DECIMALS), "USD");
      console.log("  Fully repaid:", isFullyRepaid);
  
      const collateralToUnlock = (params.collateralWei * BigInt(percentage)) / 100n;
      console.log("  Collateral unlocking:", formatEther(collateralToUnlock), "ETH");
  
      await params.ethCollateral.adminMirrorRepayment(orderId, DEFAULT_RESERVE_ID, isFullyRepaid, collateralToUnlock).then(tx => tx.wait());
      console.log("  ✓ Unlocked on Ethereum");
      
      // ADDED: If fully repaid, proceed to withdraw
      if (isFullyRepaid) {
        banner(`Step ${5 + i}: Withdrawing Collateral from Ethereum`);
        const borrowerEthCollateral = params.ethCollateral.connect(borrowerWallet);
        const balanceBefore = await borrowerWallet.provider.getBalance(params.borrowerAddress);
        
        const orderBeforeWithdraw = await borrowerEthCollateral.orders(orderId);
        console.log(`  Collateral in contract before withdrawal: ${formatEther(orderBeforeWithdraw.amountWei)} ETH`);
  
        console.log(`  Borrower ETH balance before: ${formatEther(balanceBefore)} ETH`);
        
        const withdrawTx = await borrowerEthCollateral.withdraw(orderId);
        await withdrawTx.wait();
        
        console.log("  ✓ Withdrawal transaction successful.");
  
        const balanceAfter = await borrowerWallet.provider.getBalance(params.borrowerAddress);
        console.log(`  Borrower ETH balance after: ${formatEther(balanceAfter)} ETH`);
        
        const orderAfterWithdraw = await borrowerEthCollateral.orders(orderId);
        console.log(`  Collateral in contract after withdrawal: ${formatEther(orderAfterWithdraw.amountWei)} ETH`);
        break;
      }
    }
  
    banner(`${params.scenarioName} - COMPLETE`);
  }
  
  main().catch((err) => {
    console.error("\n❌ Test failed");
    console.error(err);
    process.exitCode = 1;
  });