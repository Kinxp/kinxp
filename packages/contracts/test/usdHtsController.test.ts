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
    await htsMock.initialize();
    await htsMock.setMintResponse(22);
    await htsMock.setBurnResponse(22);
    await htsMock.setTransferResponse(22);
    await htsMock.setCreateFungibleResponse(
      22,
      ethers.getAddress("0x00000000000000000000000000000000000000ff")
    );

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
      .withArgs(token, 6, "", "");

    await expect(controller.setExistingUsdToken(token, 6)).to.be.revertedWithCustomError(
      controller,
      "TokenAlreadyInitialized"
    );
  });

  it("creates a fungible token with the controller as treasury", async function () {
    const { controller, htsMock } = await loadFixture(deployFixture);
    const createdAddr = ethers.getAddress("0x0000000000000000000000000000000000000c01");
    await htsMock.setCreateFungibleResponse(22, createdAddr);

    await expect(
      controller.createUsdToken("Hedera USD", "hUSD", 6, "memo")
    )
      .to.emit(controller, "TokenCreated")
      .withArgs(createdAddr, 6, "Hedera USD", "hUSD");

    expect(await controller.usdToken()).to.equal(createdAddr);
    expect(await controller.usdDecimals()).to.equal(6);
    expect(await controller.usdTokenName()).to.equal("Hedera USD");
    expect(await controller.usdTokenSymbol()).to.equal("hUSD");

    expect(await htsMock.lastCreateTokenName()).to.equal("Hedera USD");
    expect(await htsMock.lastCreateTokenSymbol()).to.equal("hUSD");
    expect(await htsMock.lastCreateTokenTreasury()).to.equal(
      await controller.getAddress()
    );
    expect(await htsMock.lastCreateInitialSupply()).to.equal(0);
    expect(await htsMock.lastCreateTokenDecimals()).to.equal(6);
  });

  it("associates the token with the controller", async function () {
    const { controller, htsMock } = await loadFixture(deployFixture);
    const token = ethers.getAddress("0x0000000000000000000000000000000000000def");
    await expect(controller.associateToken(token)).to.not.be.reverted;
    expect(await htsMock.lastAssociateToken()).to.equal(token);
    expect(await htsMock.lastAssociateAccount()).to.equal(
      await controller.getAddress()
    );
  });

  it("mints to a borrower via the HTS precompile", async function () {
    const { controller, borrower, htsMock } = await loadFixture(deployFixture);
    const token = ethers.getAddress("0x0000000000000000000000000000000000000def");
    await controller.associateToken(token);
    await controller.setExistingUsdToken(token, 6);

    await expect(controller.mintTo(borrower.address, 1_000_000))
      .to.emit(controller, "Minted")
      .withArgs(borrower.address, 1_000_000);

    expect(await htsMock.lastMintToken()).to.equal(token);
    expect(await htsMock.lastMintAmount()).to.equal(1_000_000);
    expect(await htsMock.lastTransferTokenSimple()).to.equal(token);
    expect(await htsMock.lastTransferTokenSender()).to.equal(
      await controller.getAddress()
    );
    expect(await htsMock.lastTransferTokenRecipient()).to.equal(
      borrower.address
    );
    expect(await htsMock.lastTransferTokenAmount()).to.equal(1_000_000n);
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

    await expect(controller.mintTo(borrower.address, 1)).to.be.revertedWithCustomError(
      controller,
      "TokenNotInitialized"
    );
    await expect(controller.burnFromTreasury(1)).to.be.revertedWithCustomError(
      controller,
      "TokenNotInitialized"
    );
  });
});
