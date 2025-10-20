import { artifacts, ethers, network } from "hardhat";
import {
  Contract,
  ContractFactory,
  JsonRpcProvider,
  Wallet,
  formatEther,
  getAddress,
  parseEther,
  zeroPadValue
} from "ethers";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.join(__dirname, "..", ".env") });

type Hex = `0x${string}`;

interface FlowContext {
  eth: {
    signer: any;
    endpoint: Hex;
    eid: number;
    contract?: Contract;
    deployTx?: Hex;
  };
  hedera: {
    provider: JsonRpcProvider;
    wallet: Wallet;
    endpoint: Hex;
    eid: number;
    pyth: Hex;
    priceId: Hex;
    controller?: Contract;
    credit?: Contract;
    controllerDeployTx?: Hex;
    creditDeployTx?: Hex;
  };
  depositWei: bigint;
  order?: {
    ethId?: Hex;
    hederaOpen?: boolean;
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function banner(title: string) {
  console.log("\n" + "─".repeat(90));
  console.log(`▶ ${title}`);
  console.log("─".repeat(90) + "\n");
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value.trim();
}

function requireAddress(name: string): Hex {
  const value = getAddress(requireEnv(name));
  if (value === ethers.ZeroAddress) {
    throw new Error(`${name} cannot be the zero address`);
  }
  return value as Hex;
}

function requireEid(name: string): number {
  const raw = requireEnv(name);
  const eid = Number(raw);
  if (!Number.isInteger(eid) || eid <= 0) {
    throw new Error(`Invalid ${name}: ${raw}`);
  }
  return eid;
}

async function deployEthCollateral(ctx: FlowContext) {
  banner("Deploying EthCollateralOApp on Sepolia");
  const factory = await ethers.getContractFactory("EthCollateralOApp");
  const contract = await factory.deploy(ctx.eth.endpoint);
  ctx.eth.deployTx = contract.deploymentTransaction()?.hash as Hex | undefined;
  console.log("  Deployment tx:", ctx.eth.deployTx);
  await contract.waitForDeployment();
  ctx.eth.contract = contract;
  const address = (await contract.getAddress()) as Hex;
  console.log("  → EthCollateralOApp:", address);
  console.log("  → Owner:", await contract.owner());
  console.log("  → Endpoint:", await contract.endpoint());
}

async function deployHederaContracts(ctx: FlowContext) {
  banner("Deploying Hedera contracts");
  const controllerArtifact = await artifacts.readArtifact("UsdHtsController");
  const controllerFactory = new ContractFactory(
    controllerArtifact.abi,
    controllerArtifact.bytecode,
    ctx.hedera.wallet
  );
  const controller = await controllerFactory.deploy();
  ctx.hedera.controllerDeployTx = controller.deploymentTransaction()?.hash as
    | Hex
    | undefined;
  console.log("  UsdHtsController tx:", ctx.hedera.controllerDeployTx);
  await controller.waitForDeployment();
  ctx.hedera.controller = controller;
  console.log("  → UsdHtsController:", await controller.getAddress());

  const creditArtifact = await artifacts.readArtifact("HederaCreditOApp");
  const creditFactory = new ContractFactory(
    creditArtifact.abi,
    creditArtifact.bytecode,
    ctx.hedera.wallet
  );
  const credit = await creditFactory.deploy(
    ctx.hedera.endpoint,
    ctx.hedera.wallet.address,
    await controller.getAddress(),
    ctx.hedera.pyth,
    ctx.hedera.priceId
  );
  ctx.hedera.creditDeployTx = credit.deploymentTransaction()?.hash as
    | Hex
    | undefined;
  console.log("  HederaCreditOApp tx:", ctx.hedera.creditDeployTx);
  await credit.waitForDeployment();
  ctx.hedera.credit = credit;
  console.log("  → HederaCreditOApp:", await credit.getAddress());
}

async function configureLayerZero(ctx: FlowContext) {
  if (!ctx.eth.contract || !ctx.hedera.credit) {
    throw new Error("Contracts not deployed");
  }

  banner("Configuring LayerZero peers");

  const ethAddress = (await ctx.eth.contract.getAddress()) as Hex;
  const hederaAddress = (await ctx.hedera.credit.getAddress()) as Hex;

  console.log("  Setting Hedera EID on EthCollateral...");
  const tx1 = await ctx.eth.contract.setHederaEid(ctx.hedera.eid);
  console.log("    tx:", tx1.hash);
  await tx1.wait();

  console.log("  Setting Hedera peer on EthCollateral...");
  const peerBytesHedera = zeroPadValue(hederaAddress, 32);
  const tx2 = await ctx.eth.contract.setPeer(ctx.hedera.eid, peerBytesHedera);
  console.log("    tx:", tx2.hash);
  await tx2.wait();

  console.log("  Setting Ethereum EID on HederaCredit...");
  const tx3 = await ctx.hedera.credit.setEthEid(ctx.eth.eid);
  console.log("    tx:", tx3.hash);
  await tx3.wait();

  console.log("  Setting Ethereum peer on HederaCredit...");
  const peerBytesEth = zeroPadValue(ethAddress, 32);
  const tx4 = await ctx.hedera.credit.setPeer(ctx.eth.eid, peerBytesEth);
  console.log("    tx:", tx4.hash);
  await tx4.wait();
}

async function createEthOrder(ctx: FlowContext) {
  if (!ctx.eth.contract) throw new Error("Eth contract missing");

  banner("Creating order on Ethereum");
  const tx = await ctx.eth.contract.createOrderId();
  console.log("  createOrderId tx:", tx.hash);
  const receipt = await tx.wait();

  const event = receipt.logs
    .map((log: any) => {
      try {
        return ctx.eth.contract!.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((log: any) => log && log.name === "OrderCreated");

  if (!event) {
    throw new Error("OrderCreated event not found");
  }

  const orderId = event.args.orderId as Hex;
  ctx.order = { ethId: orderId };
  console.log("  → Order ID:", orderId);
  return orderId;
}

async function fundOrderWithNotify(ctx: FlowContext) {
  if (!ctx.eth.contract || !ctx.order?.ethId) {
    throw new Error("Order not ready");
  }

  banner("Funding order on Ethereum (LayerZero notify)");

  const signerAddress = await ctx.eth.signer.getAddress();
  const nativeFee: bigint = await ctx.eth.contract.quoteOpenNativeFee(
    signerAddress,
    ctx.depositWei
  );
  const buffer = nativeFee / 20n;
  let total = ctx.depositWei + nativeFee + buffer;

  console.log("  Deposit:", formatEther(ctx.depositWei), "ETH");
  console.log("  Native fee:", formatEther(nativeFee), "ETH");
  console.log("  Buffer (5%):", formatEther(buffer), "ETH");
  console.log("  Total attempt:", formatEther(total), "ETH");

  try {
    await ctx.eth.contract.fundOrderWithNotify.staticCall(
      ctx.order.ethId,
      ctx.depositWei,
      {
        value: total
      }
    );
    console.log("  Static call passed with initial buffer.");
  } catch (err: any) {
    console.warn("  Static call failed, attempting to parse required value...");
    try {
      const parsed = ctx.eth.contract.interface.parseError(err.data);
      if (parsed?.name === "NotEnoughNative") {
        const required = BigInt(parsed.args[0].toString());
        const bump = required / 20n + 1_000_000_000n;
        total = required + bump;
        console.log("  Re-running static call with:", formatEther(total), "ETH");
        await ctx.eth.contract.fundOrderWithNotify.staticCall(
          ctx.order.ethId,
          ctx.depositWei,
          { value: total }
        );
      } else {
        throw err;
      }
    } catch {
      throw err;
    }
  }

  const tx = await ctx.eth.contract.fundOrderWithNotify(
    ctx.order.ethId,
    ctx.depositWei,
    {
      value: total,
      gasLimit: 600_000
    }
  );
  console.log("  fundOrderWithNotify tx:", tx.hash);
  const receipt = await tx.wait();
  console.log("  → Gas used:", receipt.gasUsed?.toString());
  console.log(
    "  LayerZero packet:",
    `https://testnet.layerzeroscan.com/tx/${tx.hash}`
  );
}

async function awaitHederaMirror(ctx: FlowContext) {
  if (!ctx.hedera.credit || !ctx.order?.ethId) {
    throw new Error("Hedera contract missing");
  }

  banner("Waiting for Hedera order mirror");

  for (let attempt = 0; attempt < 20; attempt++) {
    const horder = await ctx.hedera.credit.horders(ctx.order.ethId);
    if (horder && horder.open) {
      ctx.order.hederaOpen = true;
      console.log("  Hedera order open!");
      console.log("  Borrower:", horder.borrower);
      console.log("  Collateral:", formatEther(horder.ethAmountWei), "ETH");
      return;
    }
    console.log(
      `  [${attempt + 1}/20] Hedera order not open yet, waiting 6s...`
    );
    await sleep(6000);
  }

  console.warn(
    "  Hedera order did not open within expected window. " +
      "Check LayerZero scan for message status."
  );
}

async function main() {
  banner("Full cross-chain smoke test starting");
  console.log("Network:", network.name);

  const hederaProvider = new JsonRpcProvider(requireEnv("HEDERA_RPC_URL"));

  const ctx: FlowContext = {
    eth: {
      signer: (await ethers.getSigners())[0],
      endpoint: requireAddress("LZ_ENDPOINT_ETHEREUM"),
      eid: requireEid("LZ_EID_ETHEREUM")
    },
    hedera: {
      provider: hederaProvider,
      wallet: new Wallet(requireEnv("HEDERA_ECDSA_KEY"), hederaProvider),
      endpoint: requireAddress("LZ_ENDPOINT_HEDERA"),
      eid: requireEid("LZ_EID_HEDERA"),
      pyth: requireAddress("PYTH_CONTRACT_HEDERA"),
      priceId: requireEnv("PYTH_ETHUSD_PRICE_ID") as Hex
    },
    depositWei: parseEther(process.env.DEPOSIT_ETH ?? "0.00001")
  };

  console.log("Using deployer:", await ctx.eth.signer.getAddress());
  console.log(
    "Deployer balance:",
    formatEther(await ctx.eth.signer.provider!.getBalance(ctx.eth.signer.address)),
    "ETH"
  );
  console.log("Hedera signer:", ctx.hedera.wallet.address);

  await deployEthCollateral(ctx);
  await deployHederaContracts(ctx);
  await configureLayerZero(ctx);
  await createEthOrder(ctx);
  await fundOrderWithNotify(ctx);
  await awaitHederaMirror(ctx);

  banner("Summary");
  console.table({
    EthCollateral: await ctx.eth.contract?.getAddress(),
    HederaCredit: await ctx.hedera.credit?.getAddress(),
    UsdController: await ctx.hedera.controller?.getAddress(),
    OrderId: ctx.order?.ethId ?? "n/a"
  });

  console.log("\nNext actions:");
  console.log(
    "- Associate HTS token and mint/burn flows manually if you need borrow/repay coverage."
  );
  console.log("- Provide fresh Pyth price updates before attempting borrow().");
  console.log(
    "- Review LayerZero packet status via the URL printed above to ensure delivery."
  );
}

main().catch((err) => {
  console.error("\n❌ Full E2E script failed");
  console.error(err);
  process.exitCode = 1;
});
