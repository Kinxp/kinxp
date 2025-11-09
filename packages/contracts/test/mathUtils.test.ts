import { expect } from "chai";
import { ethers } from "hardhat";

describe("MathUtils library", function () {
  async function deployHarness() {
    const factory = await ethers.getContractFactory("MathUtilsHarness");
    const harness = await factory.deploy();
    await harness.waitForDeployment();
    return { harness };
  }

  it("performs wad multiplications and divisions", async function () {
    const { harness } = await deployHarness();
    const wad = ethers.parseEther("1");
    const twoWad = ethers.parseEther("2");

    expect(await harness.wadMul(twoWad, wad)).to.equal(twoWad);
    expect(await harness.wadMul(wad, 0n)).to.equal(0n);
    expect(await harness.wadDiv(twoWad, wad)).to.equal(twoWad);
    await expect(harness.wadDiv(wad, 0n)).to.be.revertedWith("DIV_BY_ZERO");
  });

  it("handles ray arithmetic and conversions", async function () {
    const { harness } = await deployHarness();
    const ray = 10n ** 27n;
    expect(await harness.rayMul(ray, ray)).to.equal(ray);
    expect(await harness.rayMul(0n, ray)).to.equal(0n);

    expect(await harness.rayDiv(ray, ray)).to.equal(ray);
    await expect(harness.rayDiv(ray, 0n)).to.be.revertedWith("DIV_BY_ZERO");

    const amount = 1_234_567n;
    const rayAmount = await harness.toRay(amount, 6);
    expect(rayAmount).to.equal(amount * 10n ** 21n);
    expect(await harness.fromRay(rayAmount, 6)).to.equal(amount);

    await expect(harness.toRay(1, 28)).to.be.revertedWith("DECIMALS_TOO_HIGH");
    await expect(harness.fromRay(1, 28)).to.be.revertedWith("DECIMALS_TOO_HIGH");
  });

  it("converts BPS to ray and accrues linear interest", async function () {
    const { harness } = await deployHarness();
    const bps = 500; // 5%
    expect(await harness.bpsToRay(bps)).to.equal(BigInt(bps) * 10n ** 23n);

    const principalRay = 1_000n * 10n ** 27n;
    const oneMonth = 30n * 24n * 60n * 60n;
    const [updatedPrincipal, interest] = await harness.accrueLinearInterest(principalRay, bps, oneMonth);
    expect(updatedPrincipal).to.be.gt(principalRay);
    expect(interest).to.equal(updatedPrincipal - principalRay);

    const [samePrincipal, zeroInterest] = await harness.accrueLinearInterest(principalRay, 0, oneMonth);
    expect(samePrincipal).to.equal(principalRay);
    expect(zeroInterest).to.equal(0n);
  });

  it("applies basis points to raw values", async function () {
    const { harness } = await deployHarness();
    const amount = 1_000_000n;
    expect(await harness.applyBps(amount, 0)).to.equal(0n);
    expect(await harness.applyBps(amount, 100)).to.equal(10_000n); // 1%
    expect(await harness.applyBps(0n, 500)).to.equal(0n);
  });
});
