import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true
    }
  },
  networks: {
    hardhat: {
      chainId: 31337,
      allowUnlimitedContractSize: false,
      gas: "auto",
      blockGasLimit: 30_000_000
    },
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
    },
    hederaLocal: {
      chainId: 296,
      url: process.env.HEDERA_LOCAL_RPC_URL || "http://127.0.0.1:7546",
      accounts: process.env.HEDERA_LOCAL_ECDSA_KEY
        ? [process.env.HEDERA_LOCAL_ECDSA_KEY]
        : []
    }
  },
  mocha: {
    timeout: 120000,
    require: ["ts-node/register/transpile-only"]
  }
};

export default config;
