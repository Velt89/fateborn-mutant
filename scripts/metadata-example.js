/**
 * metadata-example.js — local mirror of functions/metadata/[id].js.
 * Given a tokenInfo tuple (as returned by the contract), prints the
 * metadata JSON the Cloudflare Pages Function would serve. Used to
 * verify the metadata logic without deploying anything.
 * Usage: node scripts/metadata-example.js
 */
const TIERS = ["Ancestor", "Descendant", "Lowborn"];
const RARITIES = ["Common", "Rare", "Epic", "Legendary", "Fated"];
const TRAITS = ["One Eye", "Second Mouth", "Extra Limb", "Twisted Horn", "Venom Gland", "Bone Spur", "Shadow Skin", "Twin Heart", "Corruption"];
const GUARANTEE = [12, 25, 40];

function metadata(token) {
  const traits = TRAITS.filter((_, i) => (token.traits >> i) & 1);
  return {
    name: `Fateborn #${token.serial} — ${TIERS[token.item]}`,
    description:
      `A ${TIERS[token.item]} Fateborn, brewed in a cracked flask. ` +
      `It has mutated ${token.mutationCount} time(s).`,
    image: `https://fateborn.example/art/${["ancestor", "descendant", "lowborn"][token.item]}${token.mutationCount > 0 ? "-mutated" : ""}.webp`,
    attributes: [
      { trait_type: "Kind", value: "Fateborn" },
      { trait_type: "Tier", value: TIERS[token.item] },
      { trait_type: "Rarity", value: RARITIES[token.rarity] },
      { trait_type: "Power", value: token.power },
      { trait_type: "Speed", value: token.speed },
      { trait_type: "Traits", value: traits.join(", ") || "—" },
      { trait_type: "Mutation Count", value: token.mutationCount },
      { trait_type: "Fate Meter", value: `${token.fateMeter} / ${GUARANTEE[token.item]}` },
      { trait_type: "Ascended", value: token.ascended ? "Yes" : "No" },
    ],
  };
}

// The DESIGN.md example: Fateborn #1842, Lowborn, after 1 Ember feed.
console.log(
  JSON.stringify(
    metadata({
      serial: 1842, item: 2, rarity: 1, power: 15, speed: 9,
      traits: (1 << 0) | (1 << 1), mutationCount: 1, fateMeter: 0, ascended: false,
    }),
    null,
    2
  )
);
