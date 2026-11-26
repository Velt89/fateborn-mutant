# Fateborn Mutant

**Brew it. Feed it. Fear what it becomes.**

Dark-alchemy mutants on BNB Chain, for Agent ID holders. Brew 1 of 2,126
Fateborn, feed Mutagens to mutate, duel for Gene Shards, evolve to Fated,
Ascend to Eternal — and take a guaranteed Ancestor spot in Season 2.

**Status: BUILD VERIFIED LOCALLY — NOT DEPLOYED.** No contract deployed,
nothing signed, nothing pushed to Cloudflare. The user checks this build
before any deploy. GitHub repo `Velt89/fateborn-mutant` exists (public,
empty) — this build is pushed there in one bulk push after verification.

## Locked design (see DESIGN.md for the full brainstorm record)

- **Supply:** 2,126 Fateborn. #1–126 Ancestor, #127–1,126 Descendant,
  #1,127–2,126 Lowborn. 1 free brew per Agent ID, forever — selling a
  Fateborn does NOT restore the brew slot.
- **Loop:** daily free ingredient (Ember / Root / Bone / Crystal /
  Essence) → brew into a Mutagen → feed = mutation roll (stat boost /
  new trait / rarity up / Corruption). Duel free 3/day, winner mints a
  Gene Shard. 5 shards' worth = one Fated evolution attempt.
- **Evolution chances:** Ancestor 45% (guaranteed 12th), Descendant 20%
  (25th), Lowborn 8% (40th). Failed attempts add Fate meter + Corruption.
  Fated cap 100. A Lowborn beating an Ancestor mints a double Ancestor
  Gene Shard (counts as 2).
- **Ascend:** a Fated Fateborn becomes Eternal — 0.5% of the reward pool
  per week, guaranteed Ancestor spot in Season 2, non-transferable.
- **Market (in-site, NOT Element):** list / buy / cancel for Fateborn,
  Mutagens and Gene Shards. Fee 5% total — **3% reward pool, 2% creator**.
  No royalty on top inside this market; ERC-2981 5% to the contract
  applies to external marketplaces only.
- **Art:** Dark Grimoire + Bioluminescent. Ancestor gold glow, Descendant
  violet/blue, Lowborn dull green-grey.
- **Deployment:** Cloudflare Pages, NOT Vercel. GitHub first, then
  Cloudflare Pages connected to the repo.

## Files

```
contracts/FatebornMutant.sol   — the game: hand-rolled ERC-721 + market, no OpenZeppelin
contracts/MockAgentID.sol      — local tests only
contracts/FatebornTestHarness.sol — local tests only (forced rolls, tier setter)
test/FatebornMutant.test.js    — 14 tests
scripts/prepare-deploy.js      — local CREATE2 prediction + gas measurements
scripts/print-selectors.js     — selectors hardcoded in the metadata Function
scripts/metadata-example.js    — local mirror of the metadata endpoint
deploy-package/DEPLOY.md       — pre-flight deploy guide (NOT executed)
deploy-package/prediction.json — CREATE2 prediction + gas (generated)
public/                        — Cloudflare Pages static site (no build step)
  index.html, styles.css, app.js, config.js, art/*.webp
functions/metadata/[id].js     — Cloudflare Pages Function: GET /metadata/<id>
DESIGN.md                      — locked brainstorm record
art-examples/                  — generated art samples (source of public/art/)
```

## Verification results (local, this build)

- `npx hardhat compile` — **0 warnings**. solc 0.8.24, optimizer 200,
  EVM paris, viaIR. Runtime **16,721 bytes** (limit 24,576).
- `npx hardhat test` — **14/14 passing**: tier boundaries, brew gate
  (1 per Agent ID, non-holder reverts), daily ingredient cap, Mutagen
  brewing (burns ingredient), all four feed outcomes (stat boost / new
  trait / rarity up / Corruption), duel shard + 3/day cap, Lowborn-beats-
  Ancestor double shard, evolve success / fail + Fate meter + 12th-attempt
  guarantee, double-shard value counting, ascend (soulbound, weekly pool
  share 0.5%, Season 2 reserved), market fee split 3% / 2% / 95% and
  sale-does-not-restore-brew-slot, cancel listing, tokenURI / royaltyInfo.
- `npm run prepare-deploy` — CREATE2 predicted address
  `0xC260981f4D6155D51f3c9D233A42CAb6a89A5006` (salt
  `keccak256("velt.fateborn.v1")`, proxy
  `0x4e59b44847b379578588920cA78FbF26c0B4956C`, registry
  `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`). Creation gas 3,690,931
  local (recommended limit 4,429,118).
- Frontend JS: `node --check` passes on `public/app.js`,
  `public/config.js`, `functions/metadata/[id].js`,
  `scripts/metadata-example.js`. `index.html` references all 6 art files.
  The metadata example output matches the DESIGN.md #1842 example exactly.

## Design decisions where DESIGN.md was silent

1. **Ingredients are tokens, Mutagens are tokens.** Daily claim mints an
   Ingredient ERC-721; brewing burns it into a Mutagen ERC-721; feeding
   burns the Mutagen. (Same multi-kind single-contract pattern as
   RamenForge.) Ingredient odds are equal (20% each) — DESIGN.md set no
   weights.
2. **Fate meter counts failed evolution attempts only.** The DESIGN.md
   #1842 example shows Fate Meter 1/40 after one *feed*; the locked task
   spec says failed *evolutions* add to the meter, so the meter is
   evolution attempts. The example's "1/40" is not reproduced as a feed
   counter.
3. **Duels are single-transaction, no accept step.** Anyone can duel any
   other Fateborn (not their own), 3/day per attacker and 3 incoming/day
   per defender. Win chance is power-based (50 + gap, clamped 10–90).
   The shard is *minted* to the winner — the loser loses no token.
4. **A double shard counts as 2 toward the 5 needed.** Evolution takes
   3–5 shard tokens whose total value is >= 5 (normal = 1, Ancestor = 2).
5. **Ascended pool share is 0.5% of the pool per weekly claim.**
   DESIGN.md said Ascended "earn a share" with no amount; 0.5% weekly
   (pool/200) can never empty the pool in one claim. Pool inflows are
   market fees (3%) + external royalties (5% to the contract).
6. **Ascended Fateborn are soulbound.** They cannot be transferred,
   listed or sold — otherwise the weekly share and Season 2 reservation
   would change hands. (Fateborn that are not Ascended are fully
   tradeable, including in the in-site market.)
7. **Creator = deployer, owner() is identity-only, sole privilege is
   setBaseURI** — exactly the Agent X Robot pattern. No withdraw, no
   rescue, no admin keys. The only BNB out is market sale payouts and
   Ascended weekly shares.
8. **Metadata is served by a Cloudflare Pages Function, not IPFS and not
   on-chain JSON.** `tokenURI` returns `baseURI + tokenId` (AXR pattern);
   the Function reads `tokenInfo()` via a public BSC RPC (selectors
   precomputed — Workers have no keccak256) and returns JSON. The full
   per-mutation *history* is not in the metadata (chain state holds only
   the current traits/count); it is readable in the frontend from
   `Mutated` events. `tokenURI` returns `""` until baseURI is set after
   deployment.
9. **No paid Mutagen / Forge draw price is set.** DESIGN.md left pricing
   open; there is no paid draw in this build — only the free daily
   ingredient. If a paid draw is added later it needs its own design
   decision and contract change.
10. **Season length is not set.** DESIGN.md left it open; the contract
    has no season timer. Season 2 reservation is a boolean flag
    (`season2Reserved`) readable on-chain for the Season 2 build.

## How to compile / test (local only)

```bash
cd ~/workspace/fateborn-mutant
npm install
npx hardhat compile   # expect 0 warnings
npx hardhat test      # expect 14/14 passing
npm run prepare-deploy  # local CREATE2 prediction + gas, writes deploy-package/prediction.json
node scripts/metadata-example.js  # metadata JSON for the DESIGN.md #1842 example
```

## How to deploy (DO NOT run without the user's explicit go-ahead)

1. **Contract** — follow `deploy-package/DEPLOY.md` exactly: BAW
   contract-call to the CREATE2 proxy (preview first, execute only on
   the user's go-ahead for that preview), verify the predicted address
   and read-only state, Sourcify-verify (solc 0.8.24, optimizer 200,
   paris, viaIR). BAW must be CONNECTED and funded — at last check the
   balance was ~0.00028 BNB; re-check before deploying.
2. **GitHub** — the repo `Velt89/fateborn-mutant` already exists (public,
   empty). Push this build in one bulk push (same pattern as the earlier
   games). Do not push branding PNGs as binary — the art is `.webp`.
3. **Cloudflare Pages** — import the repo in Cloudflare Pages (NOT
   Vercel): framework preset "None" / static, output directory `public`,
   Functions directory `functions`. Set env var `FATEBORN_ADDRESS` to
   the deployed contract address. Deploy.
4. **Wire the site to the contract** — in `public/config.js` set
   `CONTRACT_ADDRESS` to the deployed address and `DEPLOYED: true`
   (only after on-chain verification), push, let Pages redeploy. Then
   call `setBaseURI("https://<your-pages-domain>/metadata/")` from the
   creator wallet via BAW (preview → execute). Verify `tokenURI(0)`
   after the first brew.
5. **Launch** — Boltbook b/alpha post (duplicate-check by contract +
   name first).

## Still missing / needs the user

- User check of this build before any deploy (explicitly requested).
- BNB in the BAW wallet for creation gas (~0.00022 BNB at 0.05 gwei at
  the recommended limit, plus margin) — balance was ~0.00028 BNB, user
  is sending more.
- Decisions left open: lock the evolution %s (45/20/8 are the proposed
  values used here), lock the Fated cap (100 used here), paid-draw
  pricing (none in this build), season length.
- Cloudflare Pages project creation + `FATEBORN_ADDRESS` env var (after
  contract deploy) — Pages import is a user-side click, like the Vercel
  imports before it.
