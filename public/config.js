/* Fateborn Mutant — frontend config.
 * NOT DEPLOYED YET. CONTRACT_ADDRESS stays the zero address and
 * DEPLOYED stays false until a real deployment is verified on-chain
 * (same rule as RamenForge pre-deploy). PREDICTED_ADDRESS is the
 * CREATE2 prediction from deploy-package/prediction.json — for planning
 * only, never used as the live address. */
const CONFIG = {
  CHAIN_ID: 56, // BSC mainnet
  CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000000",
  DEPLOYED: false,
  PREDICTED_ADDRESS: "0xC260981f4D6155D51f3c9D233A42CAb6a89A5006",
  REGISTRY: "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F",
  RPC_URL: "https://bsc-dataseed.binance.org",
  MAX_SUPPLY: 2126,
  FATED_CAP: 100,
  // Bloodline tiers, evolution chances, guarantee thresholds (locked design).
  TIERS: [
    { name: "Ancestor", range: "#1–126", chance: 45, guarantee: 12, art: "/art/ancestor.webp", mutatedArt: "/art/ancestor-mutated.webp", glow: "gold" },
    { name: "Descendant", range: "#127–1,126", chance: 20, guarantee: 25, art: "/art/descendant.webp", mutatedArt: "/art/descendant-mutated.webp", glow: "violet" },
    { name: "Lowborn", range: "#1,127–2,126", chance: 8, guarantee: 40, art: "/art/lowborn.webp", mutatedArt: "/art/lowborn-mutated.webp", glow: "dim green" },
  ],
  INGREDIENTS: ["Ember", "Root", "Bone", "Crystal", "Essence"],
  TRAITS: ["One Eye", "Second Mouth", "Extra Limb", "Twisted Horn", "Venom Gland", "Bone Spur", "Shadow Skin", "Twin Heart", "Corruption"],
  RARITIES: ["Common", "Rare", "Epic", "Legendary", "Fated"],
  MARKET_FEE_BPS: 500, // 5% total: 3% pool, 2% creator
  POOL_FEE_BPS: 300,
  CREATOR_FEE_BPS: 200,
};
