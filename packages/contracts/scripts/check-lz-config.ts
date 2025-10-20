import { ethers } from "hardhat";

async function main() {
  const ETH_COLLATERAL_ADDR = "0xFD0CeDeB9e6534b73A6b802345878Dfc348D1ef7";
  const HEDERA_CREDIT_ADDR = process.env.HEDERA_CREDIT_ADDR || ethers.ZeroAddress;

  console.log("=== Checking LayerZero Configuration ===\n");

  const ethCollateral = await ethers.getContractAt(
    "EthCollateralOApp",
    ETH_COLLATERAL_ADDR
  );

  try {
    const hederaEid = await ethCollateral.hederaEid();
    console.log("Hedera EID:", hederaEid.toString());

    if (hederaEid === 0n) {
      console.log("\n⚠️  LayerZero is DISABLED (EID = 0)");
      console.log("This means fundOrder() won't try to send LZ messages.");
      return;
    }

    console.log("\nChecking if peer is configured for Hedera...");
    try {
      const peer = await ethCollateral.peers(hederaEid);
      console.log("Peer for Hedera EID:", peer);

      if (peer === ethers.ZeroHash) {
        console.log("\n❌ PROBLEM FOUND!");
        console.log("Peer is not configured for Hedera!");
        console.log("\nThis is why _lzSend is reverting.");
        console.log("\n💡 SOLUTION:");
        console.log("You need to set the peer on Ethereum contract:");
        console.log(
          `await ethCollateral.setPeer(${hederaEid}, <hedera_oapp_address_as_bytes32>)`
        );

        if (HEDERA_CREDIT_ADDR !== ethers.ZeroAddress) {
          const peerBytes32 = ethers.zeroPadValue(HEDERA_CREDIT_ADDR, 32);
          console.log("\nRun this command:");
          console.log(`pnpm --filter @kinxp/contracts run set-peer-eth`);
          console.log("\nOr manually:");
          console.log(`Peer address (bytes32): ${peerBytes32}`);
        }
      } else {
        console.log("✅ Peer is configured!");
        const peerAddress = "0x" + peer.slice(-40);
        console.log("Peer address:", peerAddress);
      }
    } catch (peerError: any) {
      console.log("Could not read peer mapping:", peerError.message);
    }

    console.log("\nChecking LayerZero endpoint...");
    const endpoint = await ethCollateral.endpoint();
    console.log("Endpoint address:", endpoint);

    console.log("\nChecking ownership...");
    const owner = await ethCollateral.owner();
    console.log("Owner:", owner);
  } catch (error: any) {
    console.error("\n❌ Error:", error.message);
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
