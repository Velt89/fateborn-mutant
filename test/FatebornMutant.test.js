const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const DAY = 86400;
const CORRUPTION = 1 << 8;

async function deploy() {
  const signers = await ethers.getSigners();
  const [creator, alice, bob, carol, dave] = signers;
  const Mock = await ethers.getContractFactory("MockAgentID");
  const mock = await Mock.deploy();
  const Harness = await ethers.getContractFactory("FatebornTestHarness");
  const game = await Harness.deploy(await mock.getAddress());
  for (const u of [alice, bob, carol]) await mock.setHolder(u.address, true);
  // dave: no Agent ID. creator: deployer, not a holder.
  return { game, mock, creator, alice, bob, carol, dave };
}

function findEvent(game, receipt, name) {
  for (const log of receipt.logs) {
    try {
      const p = game.interface.parseLog(log);
      if (p && p.name === name) return p.args;
    } catch { /* not ours */ }
  }
  throw new Error("event not found: " + name);
}

async function brew(game, user) {
  const tx = await game.connect(user).brew();
  const rc = await tx.wait();
  return findEvent(game, rc, "Brewed").tokenId;
}

async function claimIngredient(game, user, fatebornId) {
  const tx = await game.connect(user).claimIngredient(fatebornId);
  const rc = await tx.wait();
  return findEvent(game, rc, "IngredientClaimed").tokenId;
}

async function brewMutagen(game, user, ingredientId) {
  const tx = await game.connect(user).brewMutagen(ingredientId);
  const rc = await tx.wait();
  return findEvent(game, rc, "MutagenBrewed").tokenId;
}

/// Farm `n` Gene Shards for `winner` by duelling `loser` (forced roll 0 = attacker wins).
/// 3 duels/day per pair; advances a day whenever the daily cap is hit.
async function farmShards(game, winner, loser, winnerId, loserId, n) {
  const shards = [];
  await game.setForcedRoll(0);
  let todayCount = 0;
  for (let i = 0; i < n; i++) {
    if (todayCount >= 3) {
      await time.increase(DAY);
      todayCount = 0;
    }
    const tx = await game.connect(winner).duel(winnerId, loserId);
    const rc = await tx.wait();
    shards.push(findEvent(game, rc, "DuelResolved").shardId);
    todayCount++;
  }
  await game.clearForcedRoll();
  return shards;
}

describe("FatebornMutant", function () {
  it("tiers: serial boundaries 1/126 Ancestor, 127/1126 Descendant, 1127/2126 Lowborn", async function () {
    const { game } = await deploy();
    expect(await game.tierForSerial(1)).to.equal(0);
    expect(await game.tierForSerial(126)).to.equal(0);
    expect(await game.tierForSerial(127)).to.equal(1);
    expect(await game.tierForSerial(1126)).to.equal(1);
    expect(await game.tierForSerial(1127)).to.equal(2);
    expect(await game.tierForSerial(2126)).to.equal(2);
    await expect(game.tierForSerial(0)).to.be.reverted;
    await expect(game.tierForSerial(2127)).to.be.reverted;
    expect(await game.evolutionChance(0)).to.equal(45);
    expect(await game.evolutionChance(1)).to.equal(20);
    expect(await game.evolutionChance(2)).to.equal(8);
    expect(await game.guaranteeThreshold(0)).to.equal(12);
    expect(await game.guaranteeThreshold(1)).to.equal(25);
    expect(await game.guaranteeThreshold(2)).to.equal(40);
  });

  it("brew: 1 free per Agent ID, first brew is Ancestor with 2 traits, non-holder reverts", async function () {
    const { game, alice, bob, dave } = await deploy();
    const idA = await brew(game, alice);
    expect(idA).to.equal(0);
    const info = await game.tokenInfo(idA);
    expect(info.kind).to.equal(0); // Fateborn
    expect(info.item).to.equal(0); // Ancestor
    expect(info.serial).to.equal(1);
    expect(info.rarity).to.equal(0); // Common
    expect(info.power).to.be.gte(20).and.lte(30);
    // Ancestor starts with exactly 2 trait bits set.
    let bits = 0;
    for (let i = 0; i < 8; i++) if ((Number(info.traits) >> i) & 1) bits++;
    expect(bits).to.equal(2);
    await expect(game.connect(alice).brew()).to.be.revertedWith("already brewed");
    await expect(game.connect(dave).brew()).to.be.revertedWith("sender holds no Agent ID");
    const idB = await brew(game, bob);
    expect(idB).to.equal(1);
    expect((await game.tokenInfo(idB)).serial).to.equal(2);
    expect(await game.fatebornMinted()).to.equal(2);
    expect(await game.hasAgentId(alice.address)).to.equal(true);
    expect(await game.hasAgentId(dave.address)).to.equal(false);
  });

  it("daily ingredient: 1/day per Fateborn, second claim same day reverts, next day ok", async function () {
    const { game, alice } = await deploy();
    const id = await brew(game, alice);
    const ing = await claimIngredient(game, alice, id);
    const info = await game.tokenInfo(ing);
    expect(info.kind).to.equal(1); // Ingredient
    expect(info.item).to.be.lte(4);
    await expect(game.connect(alice).claimIngredient(id)).to.be.revertedWith("already claimed today");
    await time.increase(DAY);
    const ing2 = await claimIngredient(game, alice, id);
    expect(ing2).to.not.equal(ing);
  });

  it("brewMutagen burns the ingredient and mints a Mutagen of the same type", async function () {
    const { game, alice } = await deploy();
    const id = await brew(game, alice);
    const ing = await claimIngredient(game, alice, id);
    const ingInfo = await game.tokenInfo(ing);
    const mut = await brewMutagen(game, alice, ing);
    await expect(game.ownerOf(ing)).to.be.reverted;
    const mutInfo = await game.tokenInfo(mut);
    expect(mutInfo.kind).to.equal(2);
    expect(mutInfo.item).to.equal(ingInfo.item);
  });

  it("feed: forced rolls hit stat boost / new trait / rarity up / Corruption", async function () {
    const { game, alice } = await deploy();
    const id = await brew(game, alice);
    const before = await game.tokenInfo(id);

    // Roll 10 -> stat boost.
    let ing = await claimIngredient(game, alice, id);
    let mut = await brewMutagen(game, alice, ing);
    await game.setForcedRoll(10);
    await game.connect(alice).feedMutagen(id, mut);
    let info = await game.tokenInfo(id);
    expect(info.power).to.be.gt(before.power);
    expect(info.mutationCount).to.equal(1);
    expect(info.rarity).to.equal(0);

    // Roll 70 -> new trait (traits bit count grows by 1).
    await time.increase(DAY);
    ing = await claimIngredient(game, alice, id);
    mut = await brewMutagen(game, alice, ing);
    await game.setForcedRoll(70);
    await game.connect(alice).feedMutagen(id, mut);
    info = await game.tokenInfo(id);
    let bits = 0;
    for (let i = 0; i < 8; i++) if ((Number(info.traits) >> i) & 1) bits++;
    expect(bits).to.equal(3);
    expect(info.mutationCount).to.equal(2);

    // Roll 85 -> rarity up Common -> Rare.
    await time.increase(DAY);
    ing = await claimIngredient(game, alice, id);
    mut = await brewMutagen(game, alice, ing);
    await game.setForcedRoll(85);
    await game.connect(alice).feedMutagen(id, mut);
    info = await game.tokenInfo(id);
    expect(info.rarity).to.equal(1);
    expect(info.mutationCount).to.equal(3);

    // Roll 99 -> Corruption.
    await time.increase(DAY);
    ing = await claimIngredient(game, alice, id);
    mut = await brewMutagen(game, alice, ing);
    await game.setForcedRoll(99);
    await game.connect(alice).feedMutagen(id, mut);
    info = await game.tokenInfo(id);
    expect(Number(info.traits) & CORRUPTION).to.equal(CORRUPTION);
    expect(info.mutationCount).to.equal(4);
    await game.clearForcedRoll();
  });

  it("duel: winner mints a Gene Shard, 3/day cap, self-duel reverts", async function () {
    const { game, alice, bob } = await deploy();
    const a = await brew(game, alice);
    const b = await brew(game, bob);
    await game.setForcedRoll(0); // attacker always wins
    const tx = await game.connect(alice).duel(a, b);
    const rc = await tx.wait();
    const e = findEvent(game, rc, "DuelResolved");
    expect(e.winnerId).to.equal(a);
    expect(e.doubleShard).to.equal(false);
    const shard = await game.tokenInfo(e.shardId);
    expect(shard.kind).to.equal(3);
    expect(shard.item).to.equal(0);
    expect(await game.ownerOf(e.shardId)).to.equal(alice.address);
    expect(await game.duelsLeftToday(a)).to.equal(2);
    await expect(game.connect(alice).duel(a, a)).to.be.reverted;
    await game.clearForcedRoll();
    // Two more duels today, the 4th reverts.
    await game.setForcedRoll(0);
    await game.connect(alice).duel(a, b);
    await game.connect(alice).duel(a, b);
    await expect(game.connect(alice).duel(a, b)).to.be.revertedWith("duel limit reached");
    await game.clearForcedRoll();
  });

  it("duel: Lowborn beating an Ancestor mints a double (Ancestor) Gene Shard", async function () {
    const { game, alice, bob } = await deploy();
    const a = await brew(game, alice); // Ancestor #1
    const b = await brew(game, bob); // Ancestor #2 -> made Lowborn by harness
    await game.setTierForTest(b, 2);
    await game.setForcedRoll(0); // attacker (Lowborn bob) wins
    const tx = await game.connect(bob).duel(b, a);
    const rc = await tx.wait();
    const e = findEvent(game, rc, "DuelResolved");
    expect(e.doubleShard).to.equal(true);
    const shard = await game.tokenInfo(e.shardId);
    expect(shard.item).to.equal(1);
    await game.clearForcedRoll();
  });

  it("evolve: forced success mints Fated #1; forced fails add Fate meter + Corruption; guarantee fires on 12th Ancestor attempt", async function () {
    const { game, alice, bob } = await deploy();
    const a = await brew(game, alice);
    const b = await brew(game, bob);

    // Success path: 5 shards, forced roll 0 < 45.
    let shards = await farmShards(game, alice, bob, a, b, 5);
    await game.setForcedRoll(0);
    let tx = await game.connect(alice).evolve(a, shards);
    let rc = await tx.wait();
    let e = findEvent(game, rc, "Evolved");
    expect(e.success).to.equal(true);
    expect(e.fatedNumber).to.equal(1);
    expect(await game.fatedCount()).to.equal(1);
    expect((await game.tokenInfo(a)).rarity).to.equal(4);
    await game.clearForcedRoll();

    // Guarantee path: fresh Ancestor (bob), forced roll 99 fails 11 times,
    // 12th attempt succeeds despite the roll.
    shards = await farmShards(game, bob, alice, b, a, 60);
    await game.setForcedRoll(99);
    for (let i = 0; i < 11; i++) {
      tx = await game.connect(bob).evolve(b, shards.slice(i * 5, i * 5 + 5));
      rc = await tx.wait();
      e = findEvent(game, rc, "Evolved");
      expect(e.success).to.equal(false);
      expect(e.fateMeter).to.equal(i + 1);
    }
    let info = await game.tokenInfo(b);
    expect(Number(info.traits) & CORRUPTION).to.equal(CORRUPTION);
    tx = await game.connect(bob).evolve(b, shards.slice(55, 60));
    rc = await tx.wait();
    e = findEvent(game, rc, "Evolved");
    expect(e.success).to.equal(true);
    expect(e.fatedNumber).to.equal(2);
    await game.clearForcedRoll();
  });

  it("evolve: needs shards worth >= 5; a double shard counts as 2", async function () {
    const { game, alice, bob } = await deploy();
    const a = await brew(game, alice);
    const b = await brew(game, bob);
    await game.setTierForTest(b, 2);
    // Bob (Lowborn) beats Alice (Ancestor) 3 times -> 3 double shards = worth 6.
    const shards = await farmShards(game, bob, alice, b, a, 3);
    for (const s of shards) expect((await game.tokenInfo(s)).item).to.equal(1);
    await game.setForcedRoll(0);
    const tx = await game.connect(bob).evolve(b, shards);
    const rc = await tx.wait();
    expect(findEvent(game, rc, "Evolved").success).to.equal(true);
    await game.clearForcedRoll();
  });

  it("evolve: fewer than 5 shards' worth reverts and burns nothing", async function () {
    const { game, alice, bob, carol } = await deploy();
    const a = await brew(game, alice);
    const b = await brew(game, bob);
    const c = await brew(game, carol);
    const shards = await farmShards(game, carol, alice, c, a, 4);
    await expect(game.connect(carol).evolve(c, shards)).to.be.revertedWith("shards worth < 5");
    // Nothing burned: carol still owns all 4 shards.
    for (const s of shards) expect(await game.ownerOf(s)).to.equal(carol.address);
    void b;
  });

  it("ascend: Fated -> Eternal, non-transferable, weekly pool share, Season 2 reserved", async function () {
    const { game, alice, bob, carol, dave } = await deploy();
    const a = await brew(game, alice);
    const b = await brew(game, bob);
    await expect(game.connect(alice).ascend(a)).to.be.revertedWith("not Fated");
    const shards = await farmShards(game, alice, bob, a, b, 5);
    await game.setForcedRoll(0);
    await game.connect(alice).evolve(a, shards);
    await game.clearForcedRoll();
    await game.connect(alice).ascend(a);
    const info = await game.tokenInfo(a);
    expect(info.ascended).to.equal(true);
    expect(info.season2Reserved).to.equal(true);
    expect(await game.ascendedCount()).to.equal(1);
    await expect(game.connect(alice).transferFrom(alice.address, bob.address, a)).to.be.revertedWith("ascended is soulbound");
    await expect(game.connect(alice).listToken(a, 100)).to.be.revertedWith("ascended cannot be listed");

    // Fund the pool with a market sale (carol sells to dave for 1 BNB -> 0.03 pool),
    // then claim the weekly Ascended share: 0.5% of the pool.
    const c = await brew(game, carol);
    const price = ethers.parseEther("1");
    await game.connect(carol).listToken(c, price);
    await game.connect(dave).buyToken(c, { value: price });
    expect(await game.rewardPool()).to.equal(ethers.parseEther("0.03"));
    const tx2 = await game.connect(alice).claimAscendShare(a);
    const rc2 = await tx2.wait();
    const e2 = findEvent(game, rc2, "AscendShareClaimed");
    expect(e2.payout).to.equal(ethers.parseEther("0.00015"));
    expect(await game.rewardPool()).to.equal(ethers.parseEther("0.02985"));
    await expect(game.connect(alice).claimAscendShare(a)).to.be.revertedWith("claim cooldown");
    await time.increase(7 * DAY);
    const tx3 = await game.connect(alice).claimAscendShare(a);
    const rc3 = await tx3.wait();
    expect(findEvent(game, rc3, "AscendShareClaimed").payout).to.equal(ethers.parseEther("0.00014925"));
  });

  it("market: list/buy splits 3% pool / 2% creator / 95% seller; sale does not restore brew slot", async function () {
    const { game, alice, bob, carol, dave, creator } = await deploy();
    const c = await brew(game, carol);
    const price = ethers.parseEther("1");
    await game.connect(carol).listToken(c, price);
    const [seller, listedPrice, active] = await game.listingOf(c);
    expect(seller).to.equal(carol.address);
    expect(listedPrice).to.equal(price);
    expect(active).to.equal(true);
    await expect(game.connect(dave).buyToken(c, { value: ethers.parseEther("0.5") })).to.be.revertedWith("wrong value");
    const carolBefore = await ethers.provider.getBalance(carol.address);
    const creatorBefore = await ethers.provider.getBalance(creator.address);
    const tx = await game.connect(dave).buyToken(c, { value: price });
    await tx.wait();
    expect(await game.ownerOf(c)).to.equal(dave.address);
    expect(await game.rewardPool()).to.equal(ethers.parseEther("0.03"));
    const creatorAfter = await ethers.provider.getBalance(creator.address);
    expect(creatorAfter - creatorBefore).to.equal(ethers.parseEther("0.02"));
    const carolAfter = await ethers.provider.getBalance(carol.address);
    expect(carolAfter - carolBefore).to.equal(ethers.parseEther("0.95"));
    // Carol sold her Fateborn but cannot brew another one.
    await expect(game.connect(carol).brew()).to.be.revertedWith("already brewed");
    // Dave bought one but never brewed: he can still brew his own.
    await expect(game.connect(dave).brew()).to.be.revertedWith("sender holds no Agent ID");
  });

  it("market: cancel listing works, non-seller cannot cancel", async function () {
    const { game, alice, bob } = await deploy();
    const a = await brew(game, alice);
    await game.connect(alice).listToken(a, 100);
    await expect(game.connect(bob).cancelListing(a)).to.be.revertedWith("not the seller");
    await game.connect(alice).cancelListing(a);
    expect((await game.listingOf(a))[2]).to.equal(false);
  });

  it("metadata + royalties: tokenURI empty until setBaseURI (creator only); royaltyInfo 5% to contract", async function () {
    const { game, alice, bob } = await deploy();
    const a = await brew(game, alice);
    expect(await game.tokenURI(a)).to.equal("");
    await expect(game.connect(alice).setBaseURI("https://x.example/metadata/")).to.be.revertedWith("not creator");
    await game.setBaseURI("https://fateborn.example/metadata/");
    expect(await game.tokenURI(a)).to.equal("https://fateborn.example/metadata/0");
    const [receiver, amount] = await game.royaltyInfo(a, ethers.parseEther("1"));
    expect(receiver).to.equal(await game.getAddress());
    expect(amount).to.equal(ethers.parseEther("0.05"));
    expect(await game.supportsInterface("0x80ac58cd")).to.equal(true);
    expect(await game.supportsInterface("0x2a55205a")).to.equal(true);
  });
});
