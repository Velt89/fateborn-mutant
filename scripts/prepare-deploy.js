/**
 * prepare-deploy.js — LOCAL-ONLY dry run (no wallet, no signing, no broadcast).
 * Mirrors RamenForge's prepare-deploy.js:
 *  - deploys FatebornMutant + MockAgentID on the in-process Hardhat network
 *    (mock stands in for the real registry for gas measurement only),
 *  - measures creation gas + every key function,
 *  - predicts the CREATE2 address for the real deployment:
 *      proxy 0x4e59b44847b379578588920cA78FbF26c0B4956C (same deterministic
 *      deployment proxy used by AgentProof / DailyFest / RamenForge),
 *      salt keccak256("velt.fateborn.v2"),
 *      constructor args: Agent ID registry
 *      0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F AND creator W
 *      0x0518AE367CA3612872Aa2f0897BF3B5FaFCE893A (explicit arg — v2 fix for
 *      the v1 defect, where creator = msg.sender made owner() the proxy).
 *  - writes deploy-package/prediction.json.
 *
 * The real deployment (BAW contract-call to the proxy) is a separate,
 * manual step needing the user's explicit go-ahead — see DEPLOY.md.
 * Usage: npm run prepare-deploy
 */
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const REGISTRY = "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F";
const CREATOR = "0x0518AE367CA3612872Aa2f0897BF3B5FaFCE893A"; // W — explicit constructor arg (v2 fix)
const PROXY = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
const SALT_TEXT = "velt.fateborn.v2";

async function main() {
  const [deployer, alice, bob] = await ethers.getSigners();
  const Mock = await ethers.getContractFactory("MockAgentID");
  const mock = await Mock.deploy();
  const Game = await ethers.getContractFactory("FatebornMutant");

  // Creation gas (local, mock registry + deployer as creator for measurement).
  const creationTx = await Game.getDeployTransaction(await mock.getAddress(), deployer.address);
  const creationGas = await ethers.provider.estimateGas(creationTx);
  const game = await Game.deploy(await mock.getAddress(), deployer.address);
  await game.waitForDeployment();
  const address = await game.getAddress();
  console.log("local FatebornMutant at", address);
  console.log("local creator (deployer, measurement only):", deployer.address);
  console.log("creation gas (local estimate):", creationGas.toString());

  // CREATE2 prediction for the real deployment (registry + W as creator).
  const artifact = require("../artifacts/contracts/FatebornMutant.sol/FatebornMutant.json");
  const initCode = artifact.bytecode + ethers.AbiCoder.defaultAbiCoder().encode(["address", "address"], [REGISTRY, CREATOR]).slice(2);
  const salt = ethers.keccak256(ethers.toUtf8Bytes(SALT_TEXT));
  const predicted = ethers.getCreate2Address(PROXY, salt, ethers.keccak256(initCode));
  console.log("CREATE2 predicted address:", predicted);
  console.log("salt:", salt);

  // Key-function gas (first-call worst cases, local network).
  const gas = {};
  async function measure(name, fn) {
    const tx = await fn();
    const rc = await tx.wait();
    gas[name] = Number(rc.gasUsed);
    console.log(name, rc.gasUsed.toString());
  }
  await mock.setHolder(alice.address, true);
  await mock.setHolder(bob.address, true);
  await measure("brew", () => game.connect(alice).brew());
  const aliceToken = 0;
  await measure("claimIngredient", () => game.connect(alice).claimIngredient(aliceToken));
  const ingId = 1;
  await measure("brewMutagen", () => game.connect(alice).brewMutagen(ingId));
  const mutId = 2;
  await measure("feedMutagen", () => game.connect(alice).feedMutagen(aliceToken, mutId));
  await game.connect(bob).brew();
  const bobToken = 3;
  await measure("duel", () => game.connect(alice).duel(aliceToken, bobToken));
  await measure("listToken", () => game.connect(alice).listToken(aliceToken, ethers.parseEther("1")));
  await measure("cancelListing", () => game.connect(alice).cancelListing(aliceToken));
  await measure("setBaseURI", () => game.setBaseURI("https://fateborn.example/metadata/"));

  const out = {
    contract: "FatebornMutant",
    version: "v2",
    registry: REGISTRY,
    creator: CREATOR,
    proxy: PROXY,
    saltText: SALT_TEXT,
    salt,
    predictedAddress: predicted,
    creationGasLocal: creationGas.toString(),
    creationGasRecommendedLimit: Math.ceil(Number(creationGas) * 1.2).toString(),
    gasLocal: gas,
    runtimeBytes: (artifact.deployedBytecode.length - 2) / 2,
    note: "Local measurements only. Re-check gas and balance at deploy time. Deployment needs a separate, explicit user go-ahead.",
  };
  const dir = path.join(__dirname, "..", "deploy-package");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "prediction.json"), JSON.stringify(out, null, 2));
  console.log("wrote deploy-package/prediction.json");
  console.log("deployer (local):", deployer.address);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
