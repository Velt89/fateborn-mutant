# Fateborn Mutant — Brainstorm Recap (NOT built yet)
# Status: brainstorm only. No contract, no deploy. User will check before deploy.

## Origin
- Mech Destiny was a Pi app, NOT built with Binance Agentic Wallet.
- User wants a BAW / BSC version. Brainstorm first, do not rush to build.

## Theme
- Dark Alchemy. Mech / robots was boring because repeatable.

## Object — Hybrid (chosen)
- Creature you keep: Fateborn (was Homunculus)
- Thing you feed it: Mutagen (was Potion)
- Feed a Mutagen → it mutates randomly. Same feed, different result. No 2→1 merging.

## Name — locked
- **Fateborn Mutant**
- Tagline: *Brew it. Feed it. Fear what it becomes.*
- Description: You brew a mutant in a cracked flask that was never meant to live. Feed it Ember, Root, Bone, Crystal, Essence. It grows a new limb, a second mouth, eyes where eyes shouldn't be. Duel others, winner takes a Gene Shard. Feed it well enough and it might become Fated. Or it might eat you first.

## How it works
1. Brew 1 free, 1 per Agent ID.
2. Daily free ingredient → brew Mutagen → feed = 1 mutation roll (stat boost, new trait, rarity up, or Corruption).
3. Duel — winner takes a Gene Shard from loser.
4. Fated evolution — 5 Gene Shards + a feed = evolution attempt.
5. Mutant Fate meter — failed attempts push toward guaranteed Fated.

## Supply — 2,126 total
- #1-126 Ancestor Fateborn: strongest, 2 traits, gold aura
- #127-1,126 Descendant: next 1,000, 1 trait, normal
- #1,127-2,126 Lowborn: last 1,000, 1 trait, weakest

## Evolution chance — proposed, not locked yet
- Ancestor: 45% success, guaranteed Fated on 12th attempt
- Descendant: 20% success, guaranteed on 25th attempt
- Lowborn: 8% success, guaranteed on 40th attempt
- Failed evolution still adds +1 to Fate meter + gives a Corruption trait
- Lowborn beating an Ancestor in a duel steals an Ancestor Gene Shard that counts double
- Fated cap proposed: 100, numbered (not locked)

## Beyond evolution — locked: Ascend
- Fated can Ascend → becomes Eternal, earns a share of the pool
- Ascend also locks a guaranteed Ancestor spot in Season 2
- Max 100 Fated, so max 100 Ascended take 100 of Season 2's 126 Ancestor spots, 26 go to new players
- Season 2 Ancestor carries a trait from your Ascended one

## NFT mutation description
- Dynamic metadata via our site (like Agent X Robot tokenURI), NOT immutable IPFS — IPFS cannot change after mutation.
- Each mutation updates: image (new trait layer, glow stronger if rarity up), attributes (new trait, stats, mutation count +1, Fate Meter +1), description (history line: "Mutation 1: Ember — second mouth.")
- Example: Fateborn #1842 Lowborn, before: Common, One Eye, Power 12, Mutations 0. After Ember: Rare, One Eye + Second Mouth, Power 15, Mutations 1, Fate Meter 1/40.

## Art direction — locked: 1+2 combined
- Dark Grimoire + Bioluminescent
- Black parchment, gold ink, glowing creature inside
- Ancestor = bright gold glow
- Descendant = violet / blue glow
- Lowborn = dull dim green-grey glow
- Examples in workspace/fateborn-mutant/art-examples/
  - fateborn-ancestor-combined, fateborn-descendant-combined, fateborn-lowborn-combined
  - fateborn-ancestor-mutated, fateborn-descendant-mutated, fateborn-lowborn-mutated
  - plus single-style examples: grimoire, glow, cute-creepy

## Market — locked: in-site, NOT Element
- Reason: Element kept blocking / delaying — branding form filed and waiting, re-index pending, market card shows "—" without their API key. If Element blocks again, trading stops.
- In-site market is primary. Element link optional backup only.
- Tradeable on our site: Fateborn + Mutagens + Gene Shards
- Fee: 5% total — 3% to reward pool, 2% to creator
- Selling your Fateborn does NOT give you a new brew. You used your 1-per-Agent-ID slot. Total stays 2,126. Buyer owns one of the 2,126, with tier, traits, and Fate meter intact.

## Deployment — locked: Cloudflare Pages, NOT Vercel
- User 2026-11-26: "Deploy it in cloudflare pages not vercel"
- Workflow: GitHub first, then Cloudflare Pages connected to the GitHub repo.
- No deployable build exists yet — only this DESIGN.md + art examples. Do NOT deploy until user gives build go-ahead and checks before deploy.

## Next decisions (not locked)
- Lock evolution %s (45 / 20 / 8) or adjust?
- Lock Fated cap 100?
- Pricing for paid Mutagen / Forge draws in BNB?
- Season length?
- Build go-ahead — user to say go, then check before deploy.
