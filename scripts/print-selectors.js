/**
 * print-selectors.js — prints the 4-byte selectors the Cloudflare Pages
 * Functions metadata endpoint hardcodes (functions/metadata/[id].js).
 * Cloudflare Workers have no keccak256 in WebCrypto, so selectors are
 * precomputed here with ethers and pasted into the function file.
 * Usage: node scripts/print-selectors.js
 */
const { ethers } = require("hardhat");

for (const sig of [
  "tokenInfo(uint256)",
  "ownerOf(uint256)",
  "totalMinted()",
  "name()",
  "symbol()",
]) {
  console.log(sig, "->", ethers.id(sig).slice(0, 10));
}
