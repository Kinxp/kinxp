import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { artifacts, ethers, network } from "hardhat";

const HTS_PRECOMPILE_ADDR = "0x0000000000000000000000000000000000000167";

describe("UsdHtsController", function () {
  async function deployFixture() {
    const [owner, borrower] = await ethers.getSigners();

    const artifact = await artifacts.readArtifact("MockHtsPrecompile");
    await network.provider.send("hardhat_setCode", [
      HTS_PRECOMPILE_ADDR,
      artifact.deployedBytecode
    ]);

    const mockFactory = await ethers.getContractFactory("MockHtsPrecompile");
    const htsMock = mockFactory.attach(HTS_PRECOMPILE_ADDR);
    await htsMock.setMintResponse(22);
    await htsMock.setBurnResponse(22);
    await htsMock.setTransferResponse(22);

    const controllerFactory = await ethers.getContractFactory(
      "UsdHtsController"
    );
    const controller = await controllerFactory.deploy(owner.address);
    await controller.waitForDeployment();

    return { controller, owner, borrower, htsMock };
  }

  it("links an existing token once", async function () {
    const { controller } = await loadFixture(deployFixture);
    const token = ethers.getAddress("0x0000000000000000000000000000000000000abc");

    await expect(controller.setExistingUsdToken(token, 6))
      .to.emit(controller, "TokenCreated")
      .withArgs(token, 6);

    await expect(controller.setExistingUsdToken(token, 6)).to.be.revertedWith(
      "token already set"
    );
  });

  it("mints to a borrower via the HTS precompile", async function () {
    const { controller, borrower, htsMock } = await loadFixture(deployFixture);
    const token = ethers.getAddress("0x0000000000000000000000000000000000000def");
    await controller.setExistingUsdToken(token, 6);

    await expect(controller.mintTo(borrower.address, 1_000_000))
      .to.emit(controller, "Minted")
      .withArgs(borrower.address, 1_000_000);

    expect(await htsMock.lastMintToken()).to.equal(token);
    expect(await htsMock.lastMintAmount()).to.equal(1_000_000);
    expect(await htsMock.lastTransferToken()).to.equal(token);

    const adjustments = await htsMock.lastTransferAdjustments();
    expect(adjustments.length).to.equal(2);
    expect(adjustments[0].accountID).to.equal(await controller.getAddress());
    expect(adjustments[0].amount).to.equal(-1_000_000n);
    expect(adjustments[1].accountID).to.equal(borrower.address);
    expect(adjustments[1].amount).to.equal(1_000_000n);
  });

  it("burns treasury balances", async function () {
    const { controller, htsMock } = await loadFixture(deployFixture);
    const token = ethers.getAddress("0x0000000000000000000000000000000000000fed");
    await controller.setExistingUsdToken(token, 6);

    await expect(controller.burnFromTreasury(250_000))
      .to.emit(controller, "Burned")
      .withArgs(250_000);

    expect(await htsMock.lastBurnToken()).to.equal(token);
    expect(await htsMock.lastBurnAmount()).to.equal(250_000);
  });

  it("reverts actions before a token is linked", async function () {
    const { controller, borrower } = await loadFixture(deployFixture);

    await expect(controller.mintTo(borrower.address, 1)).to.be.revertedWith(
      "no token"
    );
    await expect(controller.burnFromTreasury(1)).to.be.revertedWith("no token");
  });
});
