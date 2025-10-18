import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { artifacts, ethers, network } from "hardhat";

const HTS_ADDRESS = "0x0000000000000000000000000000000000000167";

describe("UsdHtsController", function () {
  async function deployControllerFixture() {
    const [owner, borrower, payout] = await ethers.getSigners();

    const artifact = await artifacts.readArtifact("MockHtsPrecompile");
    await network.provider.send("hardhat_setCode", [
      HTS_ADDRESS,
      artifact.deployedBytecode
    ]);

    const mockFactory = await ethers.getContractFactory("MockHtsPrecompile");
    const htsMock = mockFactory.attach(HTS_ADDRESS);

    await htsMock.setCreateResponse(22, ethers.getAddress("0x0000000000000000000000000000000000000AAA"));
    await htsMock.setMintResponse(22, 0);
    await htsMock.setBurnResponse(22);
    await htsMock.setTransferResponse(22);

    const controllerFactory = await ethers.getContractFactory(
      "UsdHtsController"
    );
    const controller = await controllerFactory.deploy(owner.address);
    await controller.waitForDeployment();

    return { owner, borrower, payout, controller, htsMock };
  }

  it("creates a USD token once and records metadata", async function () {
    const { controller, htsMock } = await loadFixture(deployControllerFixture);
    await htsMock.setCreateResponse(
      22,
      ethers.getAddress("0x0000000000000000000000000000000000000BBB")
    );

    await expect(
      controller.createUsdToken("USD Stable", "USDS", 6, 0, 0)
    )
      .to.emit(controller, "TokenCreated")
      .withArgs(
        ethers.getAddress("0x0000000000000000000000000000000000000BBB"),
        6
      );

    expect(await controller.usdToken()).to.equal(
      ethers.getAddress("0x0000000000000000000000000000000000000BBB")
    );
    expect(await controller.usdDecimals()).to.equal(6);

    await expect(
      controller.createUsdToken("USD Stable", "USDS", 6, 0, 0)
    ).to.be.revertedWith("already created");
  });

  it("allows registering an existing token exactly once", async function () {
    const { controller } = await loadFixture(deployControllerFixture);
    const token = ethers.getAddress("0x00000000000000000000000000000000000000CC");
    await expect(controller.setExistingUsdToken(token, 8))
      .to.emit(controller, "TokenCreated")
      .withArgs(token, 8);

    await expect(
      controller.setExistingUsdToken(token, 8)
    ).to.be.revertedWith("already set");
  });

  it("mints to borrowers via HTS crypto transfers", async function () {
    const { controller, htsMock, borrower } = await loadFixture(
      deployControllerFixture
    );
    const usdToken = ethers.getAddress(
      "0x0000000000000000000000000000000000000DDD"
    );

    await controller.setExistingUsdToken(usdToken, 6);

    await expect(controller.mintTo(borrower.address, 1_500_000))
      .to.emit(controller, "Minted")
      .withArgs(borrower.address, 1_500_000);

    expect(await htsMock.lastMintToken()).to.equal(usdToken);
    expect(await htsMock.lastMintAmount()).to.equal(1_500_000);
    expect(await htsMock.lastTransferToken()).to.equal(usdToken);

    const adjustments = await htsMock.lastTransferAdjustments();
    expect(adjustments.length).to.equal(2);
    expect(adjustments[0].accountID).to.equal(await controller.getAddress());
    expect(adjustments[0].amount).to.equal(-1_500_000n);
    expect(adjustments[1].accountID).to.equal(borrower.address);
    expect(adjustments[1].amount).to.equal(1_500_000n);
  });

  it("burns and pays treasury balances through the precompile", async function () {
    const { controller, htsMock, payout } = await loadFixture(
      deployControllerFixture
    );
    const usdToken = ethers.getAddress(
      "0x0000000000000000000000000000000000000EEE"
    );
    await controller.setExistingUsdToken(usdToken, 6);

    await expect(controller.burnFromTreasury(500_000))
      .to.emit(controller, "Burned")
      .withArgs(500_000);
    expect(await htsMock.lastBurnToken()).to.equal(usdToken);
    expect(await htsMock.lastBurnAmount()).to.equal(500_000);

    await htsMock.clearLastTransfers();
    await expect(controller.payFromTreasury(payout.address, 250_000))
      .to.emit(controller, "TreasuryPaid")
      .withArgs(payout.address, 250_000);

    const adjustments = await htsMock.lastTransferAdjustments();
    expect(adjustments.length).to.equal(2);
    expect(adjustments[0].accountID).to.equal(await controller.getAddress());
    expect(adjustments[0].amount).to.equal(-250_000n);
    expect(adjustments[1].accountID).to.equal(payout.address);
    expect(adjustments[1].amount).to.equal(250_000n);
  });

  it("guards against operations before a USD token is set", async function () {
    const { controller } = await loadFixture(deployControllerFixture);
    await expect(
      controller.mintTo(await controller.getAddress(), 1)
    ).to.be.revertedWith("no token");
    await expect(
      controller.burnFromTreasury(1)
    ).to.be.revertedWith("no token");
    await expect(
      controller.payFromTreasury(controller.target, 1)
    ).to.be.revertedWith("no token");
  });
});
