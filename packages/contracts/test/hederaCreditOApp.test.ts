import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { ethers } from "hardhat";

const PRICE_ID = ethers.encodeBytes32String("ETH/USD");
const ORDER_ID = ethers.encodeBytes32String("order-1");

describe("HederaCreditOApp", function () {
  async function deployHederaFixture() {
    const [owner, borrower, other] = await ethers.getSigners();

    const controllerFactory = await ethers.getContractFactory(
      "MockUsdController"
    );
    const controller = await controllerFactory.deploy(6);
    await controller.waitForDeployment();

    const pythFactory = await ethers.getContractFactory("MockPyth");
    const mockPyth = await pythFactory.deploy();
    await mockPyth.waitForDeployment();

    const endpointFactory = await ethers.getContractFactory(
      "MockLzEndpoint"
    );
    const endpoint = await endpointFactory.deploy();
    await endpoint.waitForDeployment();
    const hederaFactory = await ethers.getContractFactory(
      "TestHederaCreditOApp"
    );
    const hedera = await hederaFactory.deploy(
      await endpoint.getAddress(),
      owner.address,
      await controller.getAddress(),
      await mockPyth.getAddress(),
      PRICE_ID
    );
    await hedera.waitForDeployment();

    await controller.transferOwnership(await hedera.getAddress());

    const collateralEth = ethers.parseEther("5");
    await hedera.forceOpenOrder(ORDER_ID, borrower.address, collateralEth);

    const oraclePrice = 2000n * 10n ** 8n;
    await hedera.setStubPrice(oraclePrice, -8);
    await mockPyth.setUpdateFee(0);

    return {
      owner,
      borrower,
      other,
      hedera,
      controller,
      mockPyth,
      collateralEth
    };
  }

  it("allows borrowers to mint USD up to the LTV threshold", async function () {
    const { hedera, controller, borrower } = await loadFixture(
      deployHederaFixture
    );
    const borrowAmount = ethers.parseUnits("2000", 6); // below 70% of 5 ETH at $2000

    const tx = await hedera
      .connect(borrower)
      .borrow(ORDER_ID, borrowAmount, [], 600);
    await expect(tx)
      .to.emit(hedera, "Borrowed")
      .withArgs(ORDER_ID, borrower.address, borrowAmount);
    await expect(tx)
      .to.emit(controller, "Minted")
      .withArgs(borrower.address, borrowAmount);

    const order = await hedera.horders(ORDER_ID);
    expect(order.borrowedUsd).to.equal(borrowAmount);

    await expect(
      controller.filters.Minted
    ).to.not.be.null; // ensure ABI present
  });

  it("rejects borrowing when the order is missing or amount invalid", async function () {
    const { hedera, borrower } = await loadFixture(
      deployHederaFixture
    );

    await expect(
      hedera.connect(borrower).borrow(ethers.ZeroHash, 1, [], 600)
    ).to.be.revertedWith("bad order");

    await expect(
      hedera.connect(borrower).borrow(ORDER_ID, 0, [], 600)
    ).to.be.revertedWith("bad amount");

    await hedera.forcePriceMismatch();
    await expect(
      hedera.connect(borrower).borrow(ORDER_ID, 100, [], 600)
    ).to.be.revertedWith("priceId mismatch");
  });

  it("enforces LTV limits based on current oracle price data", async function () {
    const { hedera, borrower } = await loadFixture(
      deployHederaFixture
    );

    const excessive = ethers.parseUnits("8000", 6);
    await expect(
      hedera.connect(borrower).borrow(ORDER_ID, excessive, [], 600)
    ).to.be.revertedWith("exceeds LTV");

    const lowerPrice = 1500n * 10n ** 8n;
    await hedera.setStubPrice(lowerPrice, -8);
    const capped = ethers.parseUnits("6000", 6);
    await expect(
      hedera.connect(borrower).borrow(ORDER_ID, capped, [], 600)
    ).to.be.revertedWith("exceeds LTV");
  });

  it("respects Pyth update fees and refunds overpayment", async function () {
    const { hedera, borrower, mockPyth } = await loadFixture(
      deployHederaFixture
    );
    await mockPyth.setUpdateFee(1_000_000_000_000n);

    const payload = [ethers.hexlify(ethers.randomBytes(16))];
    const borrowAmount = ethers.parseUnits("1000", 6);

    const balanceBefore = await ethers.provider.getBalance(borrower.address);
    const tx = await hedera
      .connect(borrower)
      .borrow(ORDER_ID, borrowAmount, payload, 600, {
        value: 1_000_000_000_500n
      });
    const receipt = await tx.wait();

    const balanceAfter = await ethers.provider.getBalance(borrower.address);
    const gasCost = receipt.fee;
    expect(
      balanceBefore - balanceAfter - gasCost
    ).to.equal(1_000_000_000_000n);

    const stored = await mockPyth.getLastUpdateData();
    expect(stored.length).to.equal(1);
  });

  it("permits partial and full repayments from the borrower only", async function () {
    const { hedera, borrower, other } = await loadFixture(
      deployHederaFixture
    );
    const borrowAmount = ethers.parseUnits("1800", 6);
    await hedera.connect(borrower).borrow(ORDER_ID, borrowAmount, [], 600);

    const partial = borrowAmount / 3n;
    await expect(
      hedera.connect(other).repay(ORDER_ID, partial, false)
    ).to.be.revertedWith("bad order");

    await expect(
      hedera.connect(borrower).repay(ORDER_ID, 0, false)
    ).to.be.revertedWith("bad amount");

    await expect(
      hedera.connect(borrower).repay(ORDER_ID, partial, false)
    )
      .to.emit(hedera, "Repaid")
      .withArgs(ORDER_ID, partial, false);

    let order = await hedera.horders(ORDER_ID);
    expect(order.borrowedUsd).to.equal(borrowAmount - partial);

    await expect(
      hedera.connect(borrower).repay(ORDER_ID, borrowAmount, true)
    ).to.be.revertedWith("bad amount");

    await expect(
      hedera.connect(borrower).repay(ORDER_ID, borrowAmount - partial, false)
    )
      .to.emit(hedera, "Repaid")
      .withArgs(ORDER_ID, borrowAmount - partial, true);

    order = await hedera.horders(ORDER_ID);
    expect(order.borrowedUsd).to.equal(0);
  });

  it("lets the owner adjust LayerZero metadata with guard rails", async function () {
    const { hedera, owner } = await loadFixture(deployHederaFixture);
    await expect(hedera.connect(owner).setEthEid(101)).to.not.be.reverted;
    await expect(hedera.connect(owner).setLtvBps(8000)).to.not.be.reverted;
    await expect(
      hedera.connect(owner).setLtvBps(9500)
    ).to.be.revertedWith("too high");
  });
});
