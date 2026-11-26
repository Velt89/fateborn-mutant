/**
 * Cloudflare Pages Function: GET /metadata/<tokenId>
 * Dynamic NFT metadata for Fateborn Mutant (AXR pattern, NOT IPFS).
 *
 * Reads tokenInfo(uint256) from the live contract via a public BSC RPC
 * and returns OpenSea/Element-compatible JSON. The image and attributes
 * update on every mutation because they are computed from live chain
 * state — a frozen IPFS file could never do this.
 *
 * Selectors are precomputed (see scripts/print-selectors.js) because
 * Cloudflare Workers have no keccak256 in WebCrypto:
 *   tokenInfo(uint256) -> 0xcc33c875
 *
 * Env var: FATEBORN_ADDRESS (set in the Cloudflare Pages project after
 * deployment; until then this endpoint returns 404).
 * No API key needed: the BSC dataseed RPC is public.
 */

const RPC_URL = "https://bsc-dataseed.binance.org";
const TOKEN_INFO_SELECTOR = "0xcc33c875";

const TIERS = ["Ancestor", "Descendant", "Lowborn"];
const RARITIES = ["Common", "Rare", "Epic", "Legendary", "Fated"];
const INGREDIENTS = ["Ember", "Root", "Bone", "Crystal", "Essence"];
const TRAITS = ["One Eye", "Second Mouth", "Extra Limb", "Twisted Horn", "Venom Gland", "Bone Spur", "Shadow Skin", "Twin Heart", "Corruption"];
const GUARANTEE = [12, 25, 40];

function word(hex, i) {
  return BigInt("0x" + hex.slice(2 + i * 64, 2 + (i + 1) * 64));
}

function traitList(bits) {
  const out = [];
  for (let i = 0; i < TRAITS.length; i++) if ((bits >> i) & 1) out.push(TRAITS[i]);
  return out;
}

export async function onRequestGet(context) {
  const id = context.params.id;
  const address = context.env.FATEBORN_ADDRESS || "";
  const tokenId = Number(id);
  if (!Number.isInteger(tokenId) || tokenId < 0 || !address) {
    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }
  const origin = new URL(context.request.url).origin;
  const data = TOKEN_INFO_SELECTOR + tokenId.toString(16).padStart(64, "0");
  const rpc = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: address, data }, "latest"] }),
  });
  const rpcJson = await rpc.json();
  if (!rpcJson.result || rpcJson.result === "0x" || rpcJson.error) {
    return new Response(JSON.stringify({ error: "token not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }
  const hex = rpcJson.result;
  const kind = Number(word(hex, 0));
  const item = Number(word(hex, 1));
  const rarity = Number(word(hex, 2));
  const serial = Number(word(hex, 3));
  const power = Number(word(hex, 4));
  const speed = Number(word(hex, 5));
  const traits = Number(word(hex, 6));
  const mutationCount = Number(word(hex, 7));
  const fateMeter = Number(word(hex, 8));
  const fatedNumber = Number(word(hex, 9));
  const ascended = word(hex, 10) !== 0n;
  const season2Reserved = word(hex, 11) !== 0n;

  const traitsArr = traitList(traits);
  let name;
  let description;
  let image;
  let attributes = [];
  if (kind === 0) {
    const tier = TIERS[item];
    const base = item === 0 ? "ancestor" : item === 1 ? "descendant" : "lowborn";
    image = `${origin}/art/${base}${mutationCount > 0 ? "-mutated" : ""}.webp`;
    name = `Fateborn #${serial} — ${tier}`;
    description =
      `A ${tier} Fateborn, brewed in a cracked flask. ` +
      (ascended
        ? "Ascended to Eternal — it earns a share of the reward pool and holds a guaranteed Ancestor spot in Season 2."
        : fatedNumber > 0
          ? `Fated #${fatedNumber} of 100.`
          : `It has mutated ${mutationCount} time(s). Feed it well enough and it might become Fated. Or it might eat you first.`);
    attributes = [
      { trait_type: "Kind", value: "Fateborn" },
      { trait_type: "Tier", value: tier },
      { trait_type: "Rarity", value: RARITIES[rarity] },
      { trait_type: "Power", value: power },
      { trait_type: "Speed", value: speed },
      { trait_type: "Traits", value: traitsArr.join(", ") || "—" },
      { trait_type: "Mutation Count", value: mutationCount },
      { trait_type: "Fate Meter", value: `${fateMeter} / ${GUARANTEE[item]}` },
      { trait_type: "Ascended", value: ascended ? "Yes" : "No" },
      { trait_type: "Season 2 Reserved", value: season2Reserved ? "Yes" : "No" },
    ];
    if (fatedNumber > 0) attributes.push({ trait_type: "Fated Number", value: fatedNumber });
  } else if (kind === 1) {
    image = `${origin}/art/grimoire.webp`;
    name = `Fateborn Mutant — ${INGREDIENTS[item]} Ingredient`;
    description = `A ${INGREDIENTS[item]} ingredient. Brew it into a Mutagen, then feed it to a Fateborn.`;
    attributes = [
      { trait_type: "Kind", value: "Ingredient" },
      { trait_type: "Ingredient", value: INGREDIENTS[item] },
    ];
  } else if (kind === 2) {
    image = `${origin}/art/grimoire.webp`;
    name = `Fateborn Mutant — ${INGREDIENTS[item]} Mutagen`;
    description = `A ${INGREDIENTS[item]} Mutagen. Feed it to a Fateborn and watch it mutate.`;
    attributes = [
      { trait_type: "Kind", value: "Mutagen" },
      { trait_type: "Ingredient", value: INGREDIENTS[item] },
    ];
  } else {
    image = `${origin}/art/grimoire.webp`;
    name = "Fateborn Mutant — Gene Shard" + (item === 1 ? " (Ancestor)" : "");
    description =
      item === 1
        ? "An Ancestor Gene Shard, torn from an Ancestor in a duel. It counts double toward a Fated evolution."
        : "A Gene Shard, won in a duel. Five shards' worth buys one Fated evolution attempt.";
    attributes = [
      { trait_type: "Kind", value: "Gene Shard" },
      { trait_type: "Shard", value: item === 1 ? "Ancestor (counts double)" : "Normal" },
    ];
  }

  return new Response(JSON.stringify({ name, description, image, attributes }), {
    headers: { "content-type": "application/json", "cache-control": "no-cache" },
  });
}
