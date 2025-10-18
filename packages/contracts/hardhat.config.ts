import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } }
  },
  networks: {
    sepolia: {
      url: process.env.ETH_RPC_URL || "https://sepolia.infura.io/v3/YOUR_KEY",
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : []
    },
    hedera: {
      chainId: 296,
      url: process.env.HEDERA_RPC_URL || "https://testnet.hashio.io/api",
      accounts: process.env.HEDERA_ECDSA_KEY
        ? [process.env.HEDERA_ECDSA_KEY]
        : []
    }
  }
};

export default config;
