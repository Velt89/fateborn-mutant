# Fateborn Mutant — Deployment Guide (v2)

**Status: v2 NOT DEPLOYED. Build verified locally only (compile 0 warnings,
15/15 tests pass). Deployment needs a separate, explicit user go-ahead
after the user checks this build — preview first, execute only on the
user's go-ahead for that preview.**

**v1 is ABANDONED — do not use it.** v1 deployed at
`0xC260981f4D6155D51f3c9D233A42CAb6a89A5006` (tx
`0xd2f3639bb8a26c19e0a2648ea27c4411f34eee950fde1ad9b0dabb520d414031`,
block 135819062, Sourcify exact_match) with a defect: its constructor set
`creator = msg.sender`, and via the CREATE2 proxy msg.sender was the proxy
`0x4e59b44847b379578588920cA78FbF26c0B4956C`, so `owner()` was the proxy —
`setBaseURI` uncallable (tokenURI "" forever) and every market buy reverted
on the creator payout. 0 mints on v1, no funds locked, nothing to migrate.
v2 fixes it: `creator` is an EXPLICIT constructor argument (W) — never
msg.sender, never tx.origin — and the salt is v2, so the predicted address
is new.

All figures are LOCAL measurements (Hardhat in-process network) from
`scripts/prepare-deploy.js` — see `prediction.json` in this folder.
Re-check gas and balance at deploy time.

## Pre-flight summary (one line)

> BSC mainnet (chain 56) · from W `0x0518AE367CA3612872Aa2f0897BF3B5FaFCE893A` ·
> to: deterministic CREATE2 proxy `0x4e59b44847b379578588920cA78FbF26c0B4956C`
> (contract creation via proxy) · value **0 BNB** · creates **FatebornMutant
> at the predicted address `0xE69dE61cC2c7E4d21a83647d3671d8c009515827`**
> (salt `keccak256("velt.fateborn.v2")`) · constructor args: Agent ID registry
> `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F` AND creator W
> `0x0518AE367CA3612872Aa2f0897BF3B5FaFCE893A` · creation gas measured locally
> at **3,693,224** (recommended limit ≈ **4,431,869**, +20%) · est. cost at
> 0.05 gwei ≈ **0.00022 BNB** at the recommended limit · **no approvals, no
> spenders, no token transfers**.

The prediction is deterministic: same bytecode + same salt + same
constructor arg ⇒ same address. If the contract source changes at all,
re-run `npm run prepare-deploy` — the prediction changes with it.
The frontend config deliberately keeps the **zero address** until a real
deployment is verified on-chain (this prediction is for planning and
for the one-shot CREATE2 call only).

## Contract facts (measured locally)

- Compiler: solc **0.8.24**, optimizer **200 runs**, EVM **paris**,
  **viaIR: true**.
- Runtime size: **16,721 bytes** (limit 24,576). Creation code: 16,964 bytes.
- Compile warnings: **0**. Tests: **15/15 passing** (`npx hardhat test`,
  incl. the creator-arg regression test: `creator()` / `owner()` equal the
  explicit constructor argument, zero-arg reverts).

### Gas measured on the local network (first-call worst cases)

| Call | Gas |
|---|---|
| Contract creation | 3,693,224 |
| `brew()` | 189,066 |
| `claimIngredient()` | 117,556 |
| `brewMutagen()` | 133,898 |
| `feedMutagen()` | 86,057 |
| `duel()` | 195,701 |
| `listToken()` | 99,745 |
| `cancelListing()` | 25,575 |
| `setBaseURI()` | 91,767 |

These are estimates from a local EVM, not BSC measurements — treat them
as sizing guidance, not guarantees.

## The route — BAW contract-call to the CREATE2 proxy

The route that deployed AgentProof, DailyFest and RamenForge: the baw CLI
has no create command, but a contract-call to the deterministic deployment
proxy with calldata `salt ++ initCode` deploys at the predicted address.
Build the calldata at deploy time from the compiled artifact (creation
bytecode + ABI-encoded registry AND creator addresses, in that order) —
do not hand-copy it.

**Prerequisite:** `baw --json wallet status` must return `CONNECTED`
(re-pair in the Binance App if the session has lapsed — only the user can
do that part). Wallet BNB must cover creation gas at the recommended
limit plus a margin for the first live calls. Balance was 0.00163422 BNB
after the v1 deploy (v1 cost 0.00044845 BNB) — re-check before deploying;
do NOT deploy on a near-empty wallet.

### 1. Preview (simulation only — broadcasts nothing, creates no app notification)

Preview the contract-call to the proxy with value 0 and the
`salt ++ initCode` calldata. Expected: simulation success, no risks,
empty allowance/authority changes, `requireConfirmation=false` under
Developer Mode. If anything differs — STOP and re-check; do not execute
a dirty preview.

### 2. Execute (only on the user's explicit go-ahead for that preview)

Execute the preview's requestId. Expected: `BROADCASTED` + orderId
(Developer Mode), or `PENDING_CONFIRMATION` + orderId — in the latter
case the confirmation exists only now; the user taps it in the Binance
App.

### 3. Verify the deployment landed at the predicted address

- The created contract must be **`0xE69dE61cC2c7E4d21a83647d3671d8c009515827`**
  (v2 — NOT the abandoned v1 address `0xC260981f4D6155D51f3c9D233A42CAb6a89A5006`).
- Read-only checks: `agentIdRegistry()` == the registry, `creator()` == W,
  `owner()` == W (this is the v2 fix — if `owner()` is the proxy
  `0x4e59b44847b379578588920cA78FbF26c0B4956C`, STOP: the wrong initCode
  was deployed), `fatebornMinted()` == 0, `fatedCount()` == 0,
  `rewardPool()` == 0, `hasAgentId(W)` == true, runtime code present
  (16,721 bytes).

## Post-deploy checklist

1. **Source verification:**
   - Sourcify: submit the contract with solc 0.8.24, optimizer 200,
     EVM paris, **viaIR enabled** — expect exact_match.
   - BscScan verify with the same settings if Sourcify forwarding lags.
2. **Frontend config** — in `public/config.js`:
   - Set `CONTRACT_ADDRESS` to the deployed address, flip `DEPLOYED` to
     `true` **only after** step 3 verifies.
   - Push to GitHub (`Velt89/fateborn-mutant`) — Cloudflare Pages
     redeploys automatically from the repo.
3. **Metadata base URI** — in Cloudflare Pages project settings set the
   env var `FATEBORN_ADDRESS` to the deployed address (the
   `functions/metadata/[id].js` endpoint reads it), then call
   `setBaseURI("https://<your-pages-domain>/metadata/")` from the creator
   wallet via BAW (preview → execute, user go-ahead). Verify
   `tokenURI(0)` returns the Pages URL after the first brew.
   Until baseURI is set, `tokenURI()` returns `""` by design.
4. **Live sanity check** (read-only first): `hasAgentId(W)` true,
   `canClaimIngredientToday` — then ONE real `brew()` from W via the
   agent flow as the first live Fateborn (token 0, serial #1 Ancestor).
5. **Launch:** announce via Boltbook b/alpha with the launch post
   (duplicate-check by contract + name first, as with the earlier games).
