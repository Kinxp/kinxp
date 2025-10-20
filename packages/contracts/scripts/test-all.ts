import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

async function runCommand(cmd: string, description: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${description}`);
  console.log(`${"=".repeat(60)}\n`);

  try {
    const { stdout, stderr } = await execAsync(cmd);
    console.log(stdout);
    if (stderr) console.error(stderr);
    return true;
  } catch (error: any) {
    console.error(`❌ Failed: ${description}`);
    console.error(error.message);
    return false;
  }
}

async function main() {
  console.log("🚀 Running full integration test suite...\n");

  const tests = [
    {
      cmd: "pnpm --filter @kinxp/contracts run test-1",
      desc: "TEST 1: Deposit ETH on Ethereum"
    },
    {
      cmd: "pnpm --filter @kinxp/contracts run test-2",
      desc: "TEST 2: Create Order on Hedera"
    },
    {
      cmd: "pnpm --filter @kinxp/contracts run test-3",
      desc: "TEST 3: Withdraw USD on Hedera"
    },
    {
      cmd: "pnpm --filter @kinxp/contracts run test-4",
      desc: "TEST 4: Repay USD on Hedera"
    },
    {
      cmd: "pnpm --filter @kinxp/contracts run test-5",
      desc: "TEST 5: Release ETH on Ethereum"
    }
  ];

  for (const test of tests) {
    const success = await runCommand(test.cmd, test.desc);

    if (!success) {
      console.log("\n❌ Test suite stopped due to failure");
      process.exitCode = 1;
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  console.log("\n" + "=".repeat(60));
  console.log("🎉 ALL TESTS PASSED!");
  console.log("=".repeat(60));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
