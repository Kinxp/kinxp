/**
 * Optional utility: create a USD HTS token via the Hedera SDK and assign the
 * UsdHtsController contract as both treasury and supply key.
 *
 * This stub is intentionally left lightweight to avoid pulling in the Hedera
 * SDK by default. If you want to automate HTS creation off-chain, install
 * `@hashgraph/sdk` and implement the flow here:
 *
 *   1. Load controller address from deployments.
 *   2. Construct a `TokenCreateTransaction` with treasury and supply key set to controller.
 *   3. Execute the transaction using an Operator account.
 *   4. Call `setExistingUsdToken(address token, uint8 decimals)` on the controller.
 */
console.log(
  "Install @hashgraph/sdk and implement HTS creation if you prefer the off-chain flow."
);

