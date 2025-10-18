import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { ethers } from "hardhat";

describe("MilestoneEscrow", function () {
  async function deployEscrowFixture() {
    const [deployer, buyer, seller, arbiter, other] =
      await ethers.getSigners();
    const amounts = [ethers.parseEther("1"), ethers.parseEther("0.5")];
    const total = amounts.reduce((acc, amt) => acc + amt, 0n);

    const factory = await ethers.getContractFactory("MilestoneEscrow");
    const escrow = await factory
      .connect(deployer)
      .deploy(buyer.address, seller.address, arbiter.address, amounts, {
        value: total
      });
    await escrow.waitForDeployment();

    return { escrow, buyer, seller, arbiter, other, amounts };
  }

  it("initializes participants and milestones", async function () {
    const { escrow, buyer, seller, arbiter, amounts } = await loadFixture(
      deployEscrowFixture
    );

    expect(await escrow.buyer()).to.equal(buyer.address);
    expect(await escrow.seller()).to.equal(seller.address);
    expect(await escrow.arbiter()).to.equal(arbiter.address);

    const [amount0, released0] = await escrow.milestones(0);
    expect(amount0).to.equal(amounts[0]);
    expect(released0).to.equal(false);

    const [amount1, released1] = await escrow.milestones(1);
    expect(amount1).to.equal(amounts[1]);
    expect(released1).to.equal(false);
  });

  it("allows buyer to release milestone funds exactly once", async function () {
    const { escrow, buyer, seller, amounts } = await loadFixture(
      deployEscrowFixture
    );

    const sellerBalanceBefore = await ethers.provider.getBalance(
      seller.address
    );
    const releaseTx = await escrow.connect(buyer).release(0);
    await expect(releaseTx)
      .to.emit(escrow, "Released")
      .withArgs(0, amounts[0]);

    const sellerBalanceAfter = await ethers.provider.getBalance(
      seller.address
    );
    expect(sellerBalanceAfter - sellerBalanceBefore).to.equal(amounts[0]);

    await expect(escrow.connect(buyer).release(0)).to.be.revertedWith(
      "released"
    );
  });

  it("rejects releases from unauthorized callers", async function () {
    const { escrow, other } = await loadFixture(deployEscrowFixture);
    await expect(escrow.connect(other).release(0)).to.be.revertedWith("auth");
  });

  it("lets the arbiter refund a milestone", async function () {
    const { escrow, arbiter, buyer, amounts } = await loadFixture(
      deployEscrowFixture
    );

    const buyerBalanceBefore = await ethers.provider.getBalance(
      buyer.address
    );
    const refundTx = await escrow.connect(arbiter).refund(1);
    await expect(refundTx)
      .to.emit(escrow, "Refunded")
      .withArgs(1, amounts[1]);

    const buyerBalanceAfter = await ethers.provider.getBalance(buyer.address);
    expect(buyerBalanceAfter - buyerBalanceBefore).to.equal(amounts[1]);

    await expect(escrow.connect(arbiter).refund(1)).to.be.revertedWith(
      "released"
    );
  });

  it("prevents non-arbiters from triggering refunds", async function () {
    const { escrow, buyer } = await loadFixture(deployEscrowFixture);
    await expect(escrow.connect(buyer).refund(1)).to.be.revertedWith(
      "arb only"
    );
  });
});
