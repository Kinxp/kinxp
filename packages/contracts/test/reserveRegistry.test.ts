import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { ethers } from "hardhat";

describe("ReserveRegistry", function () {
  async function deployRegistryFixture() {
    const [owner, other] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("ReserveRegistry");
    const registry = await factory.deploy(owner.address);
    await registry.waitForDeployment();
    return { registry, owner, other };
  }

  function defaultBundle(controller: string, treasury: string, label = "ETH-hUSD") {
    const reserveId = ethers.encodeBytes32String(label);
    return {
      metadata: {
        reserveId,
        label: "ETH-hUSD",
        controller,
        protocolTreasury: treasury,
        debtTokenDecimals: 6,
        active: true,
        frozen: false
      },
      risk: {
        maxLtvBps: 7000,
        liquidationThresholdBps: 8000,
        liquidationBonusBps: 10500,
        closeFactorBps: 5000,
        reserveFactorBps: 1000,
        liquidationProtocolFeeBps: 400
      },
      interest: {
        baseRateBps: 200,
        slope1Bps: 400,
        slope2Bps: 900,
        optimalUtilizationBps: 8000,
        originationFeeBps: 50
      },
      oracle: {
        priceId: ethers.encodeBytes32String("ETH-USD"),
        heartbeatSeconds: 60,
        maxStalenessSeconds: 90,
        maxConfidenceBps: 250,
        maxDeviationBps: 750
      }
    };
  }

  it("registers a reserve and exposes configuration", async function () {
    const { registry, owner } = await loadFixture(deployRegistryFixture);
    const bundle = defaultBundle(owner.address, owner.address);
    const reserveId = bundle.metadata.reserveId;

    await expect(registry.registerReserve(bundle))
      .to.emit(registry, "ReserveRegistered")
      .withArgs(reserveId, "ETH-hUSD", owner.address);

    const stored = await registry.getReserveConfig(reserveId);
    expect(stored.metadata.controller).to.equal(owner.address);
    expect(stored.risk.maxLtvBps).to.equal(bundle.risk.maxLtvBps);
    expect(stored.interest.originationFeeBps).to.equal(bundle.interest.originationFeeBps);
    expect(stored.oracle.priceId).to.equal(bundle.oracle.priceId);
  });

  it("blocks duplicate registrations and invalid controllers", async function () {
    const { registry, owner } = await loadFixture(deployRegistryFixture);
    const bundle = defaultBundle(owner.address, owner.address);
    const badController = defaultBundle(ethers.ZeroAddress, owner.address, "BAD-CONTROLLER");
    const badTreasury = defaultBundle(owner.address, ethers.ZeroAddress, "BAD-TREASURY");

    await registry.registerReserve(bundle);

    await expect(registry.registerReserve(bundle))
      .to.be.revertedWithCustomError(registry, "ReserveAlreadyExists")
      .withArgs(bundle.metadata.reserveId);

    await expect(registry.registerReserve(badController)).to.be.revertedWithCustomError(
      registry,
      "InvalidController"
    );
    await expect(registry.registerReserve(badTreasury)).to.be.revertedWithCustomError(
      registry,
      "InvalidTreasury"
    );
  });

  it("only allows the owner to change configuration", async function () {
    const { registry, owner, other } = await loadFixture(deployRegistryFixture);
    const bundle = defaultBundle(owner.address, owner.address);
    const reserveId = bundle.metadata.reserveId;
    await registry.registerReserve(bundle);

    const newMeta = { ...bundle.metadata, label: "UPDATED", frozen: true };
    await expect(
      registry.connect(other).setReserveMetadata(reserveId, newMeta)
    ).to.be.revertedWith("Ownable: caller is not the owner");

    await registry.setReserveMetadata(reserveId, newMeta);
    const storedMeta = await registry.getMetadata(reserveId);
    expect(storedMeta.label).to.equal("UPDATED");
    expect(storedMeta.frozen).to.equal(true);

    const newRisk = { ...bundle.risk, maxLtvBps: 6500 };
    await expect(registry.connect(other).setRiskConfig(reserveId, newRisk)).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );
    await registry.setRiskConfig(reserveId, newRisk);
    expect((await registry.getRiskConfig(reserveId)).maxLtvBps).to.equal(6500);

    const newInterest = { ...bundle.interest, baseRateBps: 150 };
    await registry.setRateConfig(reserveId, newInterest);
    expect((await registry.getRateConfig(reserveId)).baseRateBps).to.equal(150);

    const newOracle = { ...bundle.oracle, heartbeatSeconds: 120 };
    await registry.setOracleConfig(reserveId, newOracle);
    expect((await registry.getOracleConfig(reserveId)).heartbeatSeconds).to.equal(120);
  });

  it("tracks LayerZero peers per chain", async function () {
    const { registry, owner } = await loadFixture(deployRegistryFixture);
    await expect(registry.setChainPeer(101, owner.address))
      .to.emit(registry, "ChainPeerUpdated")
      .withArgs(101, owner.address);
    expect(await registry.chainPeer(101)).to.equal(owner.address);
  });

  it("rejects updates for unknown reserves", async function () {
    const { registry, owner } = await loadFixture(deployRegistryFixture);
    const unknownReserve = ethers.encodeBytes32String("UNKNOWN");
    await expect(
      registry.setReserveMetadata(unknownReserve, {
        reserveId: unknownReserve,
        label: "Missing",
        controller: owner.address,
        protocolTreasury: owner.address,
        debtTokenDecimals: 6,
        active: true,
        frozen: false
      })
    )
      .to.be.revertedWithCustomError(registry, "UnknownReserve")
      .withArgs(unknownReserve);
  });
});
