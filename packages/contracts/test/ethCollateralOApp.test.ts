import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { ethers } from "hardhat";

describe("EthCollateralOApp", function () {
  async function deployCollateralFixture() {
    const [owner, user, other, payout] = await ethers.getSigners();
    const endpointFactory = await ethers.getContractFactory("MockLzEndpoint");
    const endpoint = await endpointFactory.deploy();
    await endpoint.waitForDeployment();
    const factory = await ethers.getContractFactory("TestEthCollateralOApp");
    const oapp = await factory.deploy(await endpoint.getAddress());
    await oapp.waitForDeployment();

    return { oapp, owner, user, other, payout };
  }

  async function createOrder(oapp: any, user: any): Promise<string> {
    const id = await oapp.connect(user).createOrderId.staticCall();
    await oapp.connect(user).createOrderId();
    return id;
  }

  it("generates unique deterministic order ids per user", async function () {
    const { oapp, user, other } = await loadFixture(
      deployCollateralFixture
    );
    const firstId = await createOrder(oapp, user);
    const secondId = await createOrder(oapp, user);
    expect(secondId).to.not.equal(firstId);

    const otherId = await createOrder(oapp, other);
    expect(otherId).to.not.equal(firstId);

    const order = await oapp.orders(firstId);
    expect(order.owner).to.equal(user.address);
    expect(order.funded).to.equal(false);
  });

  it("requires the order owner and non-zero value when funding", async function () {
    const { oapp, user, other } = await loadFixture(deployCollateralFixture);
    const orderId = await createOrder(oapp, user);
    const value = ethers.parseEther("1");

    await expect(
      oapp.connect(other).fundOrder(orderId, { value })
    ).to.be.revertedWith("not owner");
    await expect(
      oapp.connect(user).fundOrder(orderId)
    ).to.be.revertedWith("no ETH");

    const tx = await oapp.connect(user).fundOrder(orderId, { value });
    await expect(tx)
      .to.emit(oapp, "OrderFunded")
      .withArgs(orderId, user.address, value);

    const order = await oapp.orders(orderId);
    expect(order.funded).to.equal(true);
    expect(order.amountWei).to.equal(value);
  });

  it("withdraws only after repayment confirmation", async function () {
    const { oapp, user } = await loadFixture(deployCollateralFixture);
    const orderId = await createOrder(oapp, user);
    const stake = ethers.parseEther("0.75");
    await oapp.connect(user).fundOrder(orderId, { value: stake });

    await expect(oapp.connect(user).withdraw(orderId)).to.be.revertedWith(
      "not repaid"
    );

    await oapp.forceMarkRepaid(orderId);

    const balanceBefore = await ethers.provider.getBalance(user.address);
    const withdrawTx = await oapp.connect(user).withdraw(orderId);
    await expect(withdrawTx)
      .to.emit(oapp, "Withdrawn")
      .withArgs(orderId, user.address, stake);

    const receipt = await withdrawTx.wait();
    const gasSpent = receipt.fee;
    const balanceAfter = await ethers.provider.getBalance(user.address);
    expect(balanceAfter + gasSpent).to.equal(balanceBefore + stake);

    const order = await oapp.orders(orderId);
    expect(order.funded).to.equal(false);
    expect(order.amountWei).to.equal(0n);
  });

  it("allows the owner to liquidate unfunded orders", async function () {
    const { oapp, owner, user, payout } = await loadFixture(
      deployCollateralFixture
    );
    const orderId = await createOrder(oapp, user);
    const stake = ethers.parseEther("2");
    await oapp.connect(user).fundOrder(orderId, { value: stake });

    await expect(
      oapp.connect(owner).adminLiquidate(orderId, payout.address)
    )
      .to.emit(oapp, "Liquidated")
      .withArgs(orderId, stake);

    const order = await oapp.orders(orderId);
    expect(order.liquidated).to.equal(true);
    expect(order.amountWei).to.equal(0n);
  });

  it("blocks liquidation attempts from non-owners", async function () {
    const { oapp, user, other, payout } = await loadFixture(
      deployCollateralFixture
    );
    const orderId = await createOrder(oapp, user);
    await oapp.connect(user).fundOrder(orderId, {
      value: ethers.parseEther("0.3")
    });

    await expect(
      oapp.connect(other).adminLiquidate(orderId, payout.address)
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("prevents withdrawal after liquidation", async function () {
    const { oapp, owner, user, payout } = await loadFixture(
      deployCollateralFixture
    );
    const orderId = await createOrder(oapp, user);
    await oapp.connect(user).fundOrder(orderId, {
      value: ethers.parseEther("1")
    });
    await oapp.connect(owner).adminLiquidate(orderId, payout.address);

    await expect(oapp.connect(user).withdraw(orderId)).to.be.revertedWith(
      "not repaid"
    );
  });

  it("quotes LayerZero native fee when Hedera EID is set", async function () {
    const { oapp, user } = await loadFixture(deployCollateralFixture);
    await expect(
      oapp.quoteOpenNativeFee(user.address, 1)
    ).to.be.revertedWith("eid unset");

    await oapp.forceSetHederaEid(101);
    await oapp.setStubFee(12345n);

    const quoted = await oapp.quoteOpenNativeFee(
      user.address,
      ethers.parseEther("0.1")
    );
    expect(quoted).to.equal(12345n);
  });

  it("funds and notifies Hedera in a single transaction", async function () {
    const { oapp, user } = await loadFixture(deployCollateralFixture);
    const orderId = await createOrder(oapp, user);
    const etherDeposit = ethers.parseEther("1");
    const fee = 54321n;
    const extra = 1000n;

    await oapp.forceSetHederaEid(202);
    await oapp.setStubFee(fee);

    const balanceBefore = await ethers.provider.getBalance(user.address);
    const tx = await oapp
      .connect(user)
      .fundOrderWithNotify(orderId, etherDeposit, {
        value: etherDeposit + fee + extra
      });
    const receipt = await tx.wait();
    const gasCost = receipt.fee;
    const balanceAfter = await ethers.provider.getBalance(user.address);

    expect(balanceBefore - balanceAfter - gasCost).to.equal(
      etherDeposit + fee
    );

    const order = await oapp.orders(orderId);
    expect(order.funded).to.equal(true);
    expect(order.amountWei).to.equal(etherDeposit);

    expect(await oapp.lastLzSendCalled()).to.equal(true);
    expect(await oapp.lastLzDstEid()).to.equal(202);
    expect(await oapp.lastLzRefundAddress()).to.equal(user.address);

    const abi = ethers.AbiCoder.defaultAbiCoder();
    const expectedPayload = abi.encode(
      ["uint8", "bytes32", "address", "uint256"],
      [1, orderId, user.address, etherDeposit]
    );
    expect(await oapp.lastLzPayload()).to.equal(expectedPayload);

    const lastFee = await oapp.lastLzFee();
    expect(lastFee.nativeFee).to.equal(fee);
    expect(lastFee.lzTokenFee).to.equal(0);
  });
});
