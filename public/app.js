/* Fateborn Mutant — frontend logic (static site, Cloudflare Pages).
 * No build step. Ethers loads from CDN (see index.html). If the contract
 * is not deployed yet (CONFIG.DEPLOYED === false), every game button stays
 * disabled and the page is a read-only preview — that is deliberate.
 *
 * Reads use the public BSC RPC; writes need an injected wallet
 * (MetaMask / Binance Wallet). No keys, no signing material is ever
 * handled here. */

const ABI = [
  "function brew() returns (uint256)",
  "function claimIngredient(uint256 fatebornId) returns (uint256)",
  "function brewMutagen(uint256 ingredientId) returns (uint256)",
  "function feedMutagen(uint256 fatebornId, uint256 mutagenId) returns (uint8)",
  "function duel(uint256 attackerId, uint256 defenderId) returns (uint256 winnerId, uint256 shardId)",
  "function evolve(uint256 fatebornId, uint256[] shardIds) returns (bool)",
  "function ascend(uint256 fatebornId)",
  "function claimAscendShare(uint256 fatebornId) returns (uint256)",
  "function listToken(uint256 tokenId, uint256 price)",
  "function cancelListing(uint256 tokenId)",
  "function buyToken(uint256 tokenId) payable",
  "function listingOf(uint256 tokenId) view returns (address seller, uint256 price, bool active)",
  "function tokenInfo(uint256 tokenId) view returns (uint8 kind, uint8 item, uint8 rarity, uint32 serial, uint32 power, uint32 speed, uint16 traits, uint16 mutationCount, uint8 fateMeter, uint32 fatedNumber, bool ascended, bool season2Reserved)",
  "function hasAgentId(address account) view returns (bool)",
  "function hasBrewed(address account) view returns (bool)",
  "function fatebornMinted() view returns (uint256)",
  "function fatedCount() view returns (uint256)",
  "function rewardPool() view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function balanceOf(address owner) view returns (uint256)",
  "function name() view returns (string)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
];

let provider = null;
let signer = null;
let contract = null;
let account = null;

function $(id) { return document.getElementById(id); }

function setStatus(text) { $("walletStatus").textContent = text; }

function traitNames(bits) {
  const out = [];
  for (let i = 0; i < CONFIG.TRAITS.length; i++) {
    if ((bits >> i) & 1) out.push(CONFIG.TRAITS[i]);
  }
  return out.length ? out.join(", ") : "—";
}

async function connect() {
  if (!window.ethereum) {
    setStatus("No injected wallet found — install MetaMask or open in the Binance App browser.");
    return;
  }
  provider = new ethers.BrowserProvider(window.ethereum);
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== CONFIG.CHAIN_ID) {
    setStatus("Wrong network — switch to BSC mainnet (chain 56).");
    return;
  }
  await provider.send("eth_requestAccounts", []);
  signer = await provider.getSigner();
  account = await signer.getAddress();
  setStatus("Connected: " + account.slice(0, 6) + "…" + account.slice(-4));
  if (CONFIG.DEPLOYED) {
    contract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, ABI, signer);
    await refreshMine();
    for (const id of ["brewBtn", "claimBtn", "feedBtn", "duelBtn", "evolveBtn", "ascendBtn"]) {
      $(id).disabled = false;
    }
  } else {
    $("brewStatus").textContent = "Contract not deployed yet — brewing opens after deployment and verification.";
  }
}

/* My Fateborn: enumerate owned tokens by scanning Transfer events. This
 * is the same approach the earlier games used for "my tokens" views. */
async function refreshMine() {
  const box = $("myTokens");
  if (!contract || !account) return;
  box.innerHTML = "<p class='muted'>Loading your tokens…</p>";
  try {
    const current = await provider.getBlockNumber();
    const fromBlock = Math.max(0, current - 200000);
    const filter = contract.filters.Transfer(null, account);
    const logs = await contract.queryFilter(filter, fromBlock, current);
    const owned = new Set();
    for (const log of logs) owned.add(Number(log.args.tokenId));
    // Remove tokens transferred away (best-effort: check ownerOf).
    const mine = [];
    for (const id of owned) {
      try {
        if ((await contract.ownerOf(id)).toLowerCase() === account.toLowerCase()) mine.push(id);
      } catch { /* burned or gone */ }
    }
    if (!mine.length) {
      box.innerHTML = "<p class='muted'>You own no Fateborn tokens yet.</p>";
      return;
    }
    let html = "<ul>";
    for (const id of mine) {
      const t = await contract.tokenInfo(id);
      const kind = ["Fateborn", "Ingredient", "Mutagen", "Gene Shard"][Number(t.kind)];
      const tier = Number(t.kind) === 0 ? CONFIG.TIERS[Number(t.item)].name : "";
      html += `<li>#${id} — ${kind} ${tier} · ${CONFIG.RARITIES[Number(t.rarity)] || ""} · Power ${t.power} · Traits: ${traitNames(Number(t.traits))} · Mutations ${t.mutationCount}</li>`;
    }
    box.innerHTML = html + "</ul>";
  } catch (e) {
    box.innerHTML = "<p class='muted'>Could not load tokens: " + String(e.message || e) + "</p>";
  }
}

async function send(fn, label) {
  if (!contract) return;
  try {
    const tx = await fn();
    $("brewStatus").textContent = label + " sent: " + tx.hash + " — waiting…";
    await tx.wait();
    $("brewStatus").textContent = label + " confirmed.";
    await refreshMine();
  } catch (e) {
    $("brewStatus").textContent = label + " failed: " + String(e.message || e);
  }
}

$("connectBtn").addEventListener("click", connect);
$("brewBtn").addEventListener("click", () => send(() => contract.brew(), "Brew"));
// The remaining buttons need a selected tokenId in a real session; they are
// wired to prompt for it so the preview page never silently does nothing.
$("claimBtn").addEventListener("click", () => {
  const id = prompt("Fateborn tokenId to claim an ingredient for:");
  if (id !== null) send(() => contract.claimIngredient(BigInt(id)), "Claim ingredient");
});
$("feedBtn").addEventListener("click", () => {
  const f = prompt("Fateborn tokenId to feed:");
  const m = prompt("Mutagen tokenId to feed it:");
  if (f !== null && m !== null) send(() => contract.feedMutagen(BigInt(f), BigInt(m)), "Feed");
});
$("duelBtn").addEventListener("click", () => {
  const a = prompt("Your Fateborn tokenId (attacker):");
  const d = prompt("Defender Fateborn tokenId:");
  if (a !== null && d !== null) send(() => contract.duel(BigInt(a), BigInt(d)), "Duel");
});
$("evolveBtn").addEventListener("click", () => {
  const f = prompt("Fateborn tokenId to evolve:");
  const s = prompt("Gene Shard tokenIds, comma-separated (worth >= 5):");
  if (f !== null && s !== null) send(() => contract.evolve(BigInt(f), s.split(",").map((x) => BigInt(x.trim()))), "Evolve");
});
$("ascendBtn").addEventListener("click", () => {
  const f = prompt("Fated Fateborn tokenId to Ascend (irreversible!):");
  if (f !== null && confirm("Ascend is irreversible. Your Fateborn becomes Eternal and can never be sold. Continue?")) {
    send(() => contract.ascend(BigInt(f)), "Ascend");
  }
});

// Preview mode: banner is visible in index.html when not deployed.
if (CONFIG.DEPLOYED) $("deployBanner").style.display = "none";
