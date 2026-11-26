// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title Fateborn Mutant — dark-alchemy mutants on BNB Chain, for Agent ID holders
/// @notice BUILD ONLY — not deployed. Single hand-rolled ERC-721 contract
/// (game + in-site market), following the RamenForge / Agent X Robot pattern:
/// Agent ID gating via the SPACE ID registry, creator = deployer with
/// owner() for identity only (its ONLY privilege is setBaseURI, as in AXR),
/// no withdraw / rescue / admin keys of any kind. The ONLY way BNB leaves
/// this contract is (a) a market sale payout to the seller, (b) the market
/// creator fee, (c) an Ascended weekly pool-share claim. Royalties from
/// external marketplaces (ERC-2981, 5%) are paid to this contract and land
/// in the reward pool.
///
/// THE GAME (locked design, ~/workspace/fateborn-mutant/DESIGN.md):
/// - Brew ONE free Fateborn per Agent ID holder. Total supply 2,126.
///   Token serial decides the bloodline tier: #1-126 Ancestor, #127-1126
///   Descendant, #1127-2126 Lowborn. Selling a Fateborn does NOT restore
///   the seller's brew slot (hasBrewed is per wallet, forever).
/// - Every UTC day, each Fateborn's owner claims ONE free ingredient
///   (Ember / Root / Bone / Crystal / Essence, equal odds). Brew the
///   ingredient into a Mutagen (burns the ingredient), feed the Mutagen
///   to a Fateborn (burns the Mutagen): a mutation roll — stat boost,
///   new trait, rarity up, or Corruption.
/// - Duel: free, 3/day per Fateborn. Winner mints a Gene Shard. A Lowborn
///   that beats an Ancestor mints an Ancestor Gene Shard, which counts
///   double toward an evolution attempt.
/// - Fated evolution: burn Gene Shards worth >= 5 (a double shard counts
///   as 2) for one attempt. Success chance by tier: Ancestor 45%,
///   Descendant 20%, Lowborn 8%. A failed attempt adds +1 to the Fate
///   meter and a Corruption trait. The meter guarantees success on the
///   12th / 25th / 40th attempt. Fated cap: 100, numbered.
/// - Ascend: a Fated Fateborn becomes Eternal — it earns a weekly share
///   of the reward pool (0.5% of the pool per claim, max once per 7 days),
///   locks a guaranteed Ancestor spot in Season 2 (its Season 2 Ancestor
///   carries one of its traits), and becomes non-transferable.
/// - In-site market (NOT Element): list / buy / cancel for Fateborn,
///   Mutagens and Gene Shards. Fee 5% total on every sale: 3% to the
///   reward pool, 2% to the creator wallet. No royalty is charged on top
///   inside this market; royaltyInfo (5% to this contract) applies only
///   to external marketplaces.
///
/// RANDOMNESS (honest limits, as in RamenForge): rolls are keccak256 of
/// the previous block hash, block.prevrandao, the sender and an internal
/// nonce, revealed at call time. Public chain data, so a sophisticated
/// caller who can land a transaction in an exact chosen block could bias
/// a single roll. Impact is bounded (1 ingredient/day, 3 duels/day,
/// evolution needs 5 shards, Fated cap 100). No VRF oracle, deliberately,
/// to keep the contract dependency-free and self-contained.
///
/// METADATA: tokenURI returns baseURI + tokenId (AXR pattern). baseURI is
/// set after deployment to the Cloudflare Pages Functions endpoint
/// /metadata/<id>, which reads this contract and returns JSON whose image
/// and attributes update on every mutation. NOT IPFS — IPFS metadata
/// cannot change, and a mutating NFT must change.

interface IAgentID {
    function balanceOf(address owner) external view returns (uint256);
}

contract FatebornMutant {
    string public constant name = "Fateborn Mutant";
    string public constant symbol = "FATEBORN";

    uint256 public constant SECONDS_PER_DAY = 86400;
    uint256 public constant MAX_SUPPLY = 2126;
    uint256 public constant ANCESTOR_END = 126;
    uint256 public constant DESCENDANT_END = 1126;
    uint256 public constant FATED_CAP = 100;
    uint256 public constant DUELS_PER_DAY = 3;
    uint256 public constant MARKET_FEE_BPS = 500; // 5% total
    uint256 public constant POOL_FEE_BPS = 300; // 3% of sale price -> pool
    uint256 public constant CREATOR_FEE_BPS = 200; // 2% of sale price -> creator
    uint256 public constant ROYALTY_BPS = 500; // 5% ERC-2981, external marketplaces only
    uint256 public constant ASCEND_CLAIM_BPS = 50; // 0.5% of pool per weekly claim
    uint256 public constant ASCEND_CLAIM_COOLDOWN = 7 days;

    // Token kinds.
    uint8 public constant KIND_FATEBORN = 0;
    uint8 public constant KIND_INGREDIENT = 1;
    uint8 public constant KIND_MUTAGEN = 2;
    uint8 public constant KIND_GENE_SHARD = 3;

    // Tiers (token.item for a Fateborn): 0 Ancestor, 1 Descendant, 2 Lowborn.
    // Rarities: 0 Common, 1 Rare, 2 Epic, 3 Legendary, 4 Fated.
    // Traits (bitmask bits 0..7 + Corruption bit 8):
    // 0 One Eye, 1 Second Mouth, 2 Extra Limb, 3 Twisted Horn,
    // 4 Venom Gland, 5 Bone Spur, 6 Shadow Skin, 7 Twin Heart,
    // 8 Corruption.
    uint16 public constant TRAIT_CORRUPTION = 1 << 8;

    IAgentID public immutable agentIdRegistry;
    address public creator;

    string private _baseURI;

    struct Token {
        uint8 kind;
        uint8 item; // Fateborn: tier. Ingredient/Mutagen: ingredient type 0..4. Shard: 0 normal, 1 ancestor-double.
        uint8 rarity; // Fateborn only
        uint32 serial; // Fateborn: brew serial 1..2126. Fated: fatedNumber is separate.
        uint32 power;
        uint32 speed;
        uint16 traits;
        uint16 mutationCount;
        uint8 fateMeter; // failed evolution attempts
        uint32 fatedNumber; // 0 = not Fated, else 1..100
        bool ascended;
        bool season2Reserved;
        uint32 mintDay;
    }

    struct Listing {
        address seller;
        uint256 price;
        bool active;
    }

    // internal (not private) so the test harness can set a token's tier
    // for the Lowborn double-shard test; the base contract exposes no
    // tier-changing function itself.
    Token[] internal _tokens;
    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(uint256 => address) private _tokenApprovals;
    mapping(address => mapping(address => bool)) private _operatorApprovals;
    mapping(uint256 => bool) private _burned;
    mapping(address => bool) private _hasBrewed;
    mapping(uint256 => uint256) private _lastIngredientDay;
    mapping(uint256 => uint256) private _lastDuelDay;
    mapping(uint256 => uint8) private _duelsToday;
    mapping(uint256 => uint256) private _lastDuelReceivedDay;
    mapping(uint256 => uint8) private _duelsReceivedToday;
    mapping(uint256 => uint256) private _lastAscendClaim;
    mapping(uint256 => Listing) private _listings;

    uint256 public fatebornMinted;
    uint256 public fatedCount;
    uint256 public ascendedCount;
    uint256 public rewardPool;
    uint256 public totalBurned;
    uint256 private _nonce;
    bool private _locked;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event Brewed(address indexed user, uint256 tokenId, uint32 serial, uint8 tier);
    event IngredientClaimed(address indexed user, uint256 fatebornId, uint256 tokenId, uint8 ingredient);
    event MutagenBrewed(address indexed user, uint256 ingredientId, uint256 tokenId, uint8 ingredient);
    event Mutated(address indexed user, uint256 fatebornId, uint256 mutagenId, uint8 outcome, uint16 traits, uint8 rarity);
    event DuelResolved(address indexed winner, uint256 winnerId, uint256 loserId, uint256 shardId, bool doubleShard);
    event Evolved(address indexed user, uint256 fatebornId, bool success, uint32 fatedNumber, uint8 fateMeter);
    event Ascended(address indexed user, uint256 fatebornId);
    event AscendShareClaimed(address indexed user, uint256 fatebornId, uint256 payout);
    event Listed(address indexed seller, uint256 tokenId, uint256 price);
    event ListingCancelled(address indexed seller, uint256 tokenId);
    event Sold(address indexed seller, address indexed buyer, uint256 tokenId, uint256 price, uint256 poolShare, uint256 creatorShare);
    event PoolFunded(address indexed from, uint256 amount);

    constructor(address registry) {
        require(registry != address(0), "registry is zero address");
        agentIdRegistry = IAgentID(registry);
        creator = msg.sender;
    }

    /// @notice The creator's ONLY privilege: set the metadata base URI.
    /// @dev Follows Agent X Robot exactly. No withdraw, no rescue, no game power.
    function owner() public view returns (address) {
        return creator;
    }

    function setBaseURI(string calldata uri) external {
        require(msg.sender == creator, "not creator");
        _baseURI = uri;
    }

    function baseURI() external view returns (string memory) {
        return _baseURI;
    }

    receive() external payable {
        rewardPool += msg.value;
        emit PoolFunded(msg.sender, msg.value);
    }

    // ----- Agent ID gate -----

    function hasAgentId(address account) public view returns (bool) {
        return agentIdRegistry.balanceOf(account) > 0;
    }

    function hasBrewed(address account) external view returns (bool) {
        return _hasBrewed[account];
    }

    // ----- Pure helpers: tiers, chances, guarantees -----

    /// @notice Bloodline tier for a brew serial: 0 Ancestor (1..126),
    /// 1 Descendant (127..1126), 2 Lowborn (1127..2126).
    function tierForSerial(uint256 serial) public pure returns (uint8) {
        require(serial >= 1 && serial <= MAX_SUPPLY, "serial out of range");
        if (serial <= ANCESTOR_END) return 0;
        if (serial <= DESCENDANT_END) return 1;
        return 2;
    }

    function evolutionChance(uint8 tier) public pure returns (uint256) {
        if (tier == 0) return 45;
        if (tier == 1) return 20;
        return 8;
    }

    function guaranteeThreshold(uint8 tier) public pure returns (uint8) {
        if (tier == 0) return 12;
        if (tier == 1) return 25;
        return 40;
    }

    function tierName(uint8 tier) public pure returns (string memory) {
        if (tier == 0) return "Ancestor";
        if (tier == 1) return "Descendant";
        return "Lowborn";
    }

    function rarityName(uint8 rarity) public pure returns (string memory) {
        if (rarity == 0) return "Common";
        if (rarity == 1) return "Rare";
        if (rarity == 2) return "Epic";
        if (rarity == 3) return "Legendary";
        return "Fated";
    }

    function ingredientName(uint8 item) public pure returns (string memory) {
        require(item < 5, "invalid ingredient");
        if (item == 0) return "Ember";
        if (item == 1) return "Root";
        if (item == 2) return "Bone";
        if (item == 3) return "Crystal";
        return "Essence";
    }

    function _today() internal view returns (uint256) {
        return block.timestamp / SECONDS_PER_DAY;
    }

    function _rand(uint256 salt) internal virtual returns (uint256) {
        _nonce++;
        return uint256(keccak256(abi.encodePacked(blockhash(block.number - 1), block.prevrandao, msg.sender, salt, _nonce)));
    }

    function _traitCount(uint16 traits) internal pure returns (uint256 count) {
        for (uint8 i = 0; i < 9; i++) {
            if ((traits & (uint16(1) << i)) != 0) count++;
        }
    }

    function _duelPower(Token storage t) internal view returns (uint256) {
        uint256 p = uint256(t.power) + _traitCount(t.traits) * 2 + uint256(t.rarity) * 5;
        if (t.item == 0) p += 5;
        else if (t.item == 1) p += 2;
        return p;
    }

    // ----- Internal token bookkeeping -----

    function _mint(address user, Token memory t) internal returns (uint256 tokenId) {
        tokenId = _tokens.length;
        _tokens.push(t);
        _owners[tokenId] = user;
        _balances[user] += 1;
        emit Transfer(address(0), user, tokenId);
    }

    function _burn(address user, uint256 tokenId) internal {
        _burned[tokenId] = true;
        _owners[tokenId] = address(0);
        _balances[user] -= 1;
        _tokenApprovals[tokenId] = address(0);
        totalBurned += 1;
        emit Transfer(user, address(0), tokenId);
    }

    function _requireToken(uint256 tokenId) internal view returns (Token storage t) {
        require(tokenId < _tokens.length && !_burned[tokenId], "token does not exist");
        t = _tokens[tokenId];
    }

    function _requireOwned(uint256 tokenId, uint8 kind) internal view returns (Token storage t) {
        t = _requireToken(tokenId);
        require(_owners[tokenId] == msg.sender, "not your token");
        require(t.kind == kind, "wrong token kind");
    }

    modifier nonReentrant() {
        require(!_locked, "reentrant");
        _locked = true;
        _;
        _locked = false;
    }

    // ----- Brew -----

    /// @notice Brew one free Fateborn. One per Agent ID holder, forever —
    /// selling it does NOT restore the brew slot. Tier is decided by the
    /// brew serial: first 126 Ancestor, next 1,000 Descendant, last 1,000
    /// Lowborn. Ancestors start with 2 traits, others with 1.
    function brew() external returns (uint256 tokenId) {
        require(hasAgentId(msg.sender), "sender holds no Agent ID");
        require(!_hasBrewed[msg.sender], "already brewed");
        require(fatebornMinted < MAX_SUPPLY, "supply exhausted");
        _hasBrewed[msg.sender] = true;
        fatebornMinted += 1;
        uint256 serial = fatebornMinted;
        uint8 tier = tierForSerial(serial);
        uint256 r1 = _rand(0xBEEF);
        uint256 r2 = _rand(0xBEEF + 1);
        uint32 power;
        uint32 speed;
        if (tier == 0) {
            power = uint32(20 + (r1 % 11)); // 20..30
            speed = uint32(15 + (r2 % 11)); // 15..25
        } else if (tier == 1) {
            power = uint32(12 + (r1 % 11)); // 12..22
            speed = uint32(10 + (r2 % 11)); // 10..20
        } else {
            power = uint32(8 + (r1 % 9)); // 8..16
            speed = uint32(6 + (r2 % 9)); // 6..14
        }
        uint16 traits = uint16(1) << uint8(r1 % 8);
        if (tier == 0) {
            uint8 second = uint8(r2 % 8);
            if (uint16(1) << second == traits) second = (second + 1) % 8;
            traits |= uint16(1) << second;
        }
        Token memory t = Token({
            kind: KIND_FATEBORN,
            item: tier,
            rarity: 0,
            serial: uint32(serial),
            power: power,
            speed: speed,
            traits: traits,
            mutationCount: 0,
            fateMeter: 0,
            fatedNumber: 0,
            ascended: false,
            season2Reserved: false,
            mintDay: uint32(_today())
        });
        tokenId = _mint(msg.sender, t);
        emit Brewed(msg.sender, tokenId, uint32(serial), tier);
    }

    // ----- Daily ingredient -> Mutagen -> feed -----

    /// @notice Claim today's free ingredient for one Fateborn you own.
    /// One per Fateborn per UTC day, equal odds across the 5 ingredients.
    function claimIngredient(uint256 fatebornId) external returns (uint256 tokenId) {
        Token storage f = _requireOwned(fatebornId, KIND_FATEBORN);
        require(!f.ascended, "ascended cannot claim");
        uint256 today = _today();
        require(_lastIngredientDay[fatebornId] != today, "already claimed today");
        _lastIngredientDay[fatebornId] = today;
        uint8 ingredient = uint8(_rand(0x1CE) % 5);
        Token memory t = Token({
            kind: KIND_INGREDIENT,
            item: ingredient,
            rarity: 0,
            serial: 0,
            power: 0,
            speed: 0,
            traits: 0,
            mutationCount: 0,
            fateMeter: 0,
            fatedNumber: 0,
            ascended: false,
            season2Reserved: false,
            mintDay: uint32(today)
        });
        tokenId = _mint(msg.sender, t);
        emit IngredientClaimed(msg.sender, fatebornId, tokenId, ingredient);
    }

    /// @notice Brew an ingredient into a Mutagen of the same type (burns it).
    function brewMutagen(uint256 ingredientId) external returns (uint256 tokenId) {
        Token storage ing = _requireOwned(ingredientId, KIND_INGREDIENT);
        require(_listings[ingredientId].active == false, "listed");
        uint8 ingredient = ing.item;
        _burn(msg.sender, ingredientId);
        Token memory t = Token({
            kind: KIND_MUTAGEN,
            item: ingredient,
            rarity: 0,
            serial: 0,
            power: 0,
            speed: 0,
            traits: 0,
            mutationCount: 0,
            fateMeter: 0,
            fatedNumber: 0,
            ascended: false,
            season2Reserved: false,
            mintDay: uint32(_today())
        });
        tokenId = _mint(msg.sender, t);
        emit MutagenBrewed(msg.sender, ingredientId, tokenId, ingredient);
    }

    /// @notice Feed a Mutagen to a Fateborn (burns the Mutagen). Mutation roll:
    /// 0-59 stat boost, 60-79 new trait, 80-91 rarity up, 92-99 Corruption.
    /// Every feed increments the mutation count; the image / traits / stats
    /// in the metadata change, which is why metadata is served dynamically.
    function feedMutagen(uint256 fatebornId, uint256 mutagenId) external returns (uint8 outcome) {
        Token storage f = _requireOwned(fatebornId, KIND_FATEBORN);
        require(!f.ascended, "ascended cannot mutate");
        _requireOwned(mutagenId, KIND_MUTAGEN);
        require(_listings[mutagenId].active == false, "listed");
        _burn(msg.sender, mutagenId);
        uint256 roll = _rand(0xFEED) % 100;
        if (roll < 60) {
            outcome = 0; // stat boost
            f.power += uint32(1 + (_rand(0xFEED + 1) % 3));
            f.speed += uint32(_rand(0xFEED + 2) % 3);
        } else if (roll < 80) {
            outcome = 1; // new trait
            uint256 r = _rand(0xFEED + 3);
            uint8 pick = 0;
            uint256 unowned;
            for (uint8 i = 0; i < 8; i++) {
                if ((f.traits & (uint16(1) << i)) == 0) unowned++;
            }
            if (unowned == 0) {
                f.power += 3;
            } else {
                uint256 target = r % unowned;
                uint256 seen;
                for (uint8 i = 0; i < 8; i++) {
                    if ((f.traits & (uint16(1) << i)) == 0) {
                        if (seen == target) {
                            pick = i;
                            break;
                        }
                        seen++;
                    }
                }
                f.traits |= uint16(1) << pick;
            }
        } else if (roll < 92) {
            outcome = 2; // rarity up
            if (f.rarity < 3) {
                f.rarity += 1;
            } else {
                f.power += 3; // already Legendary: power instead
            }
        } else {
            outcome = 3; // Corruption
            f.traits |= TRAIT_CORRUPTION;
            f.power += 3;
        }
        f.mutationCount += 1;
        emit Mutated(msg.sender, fatebornId, mutagenId, outcome, f.traits, f.rarity);
    }

    // ----- Duel -----

    /// @notice Duel another Fateborn. Free, 3/day per attacker and 3
    /// incoming duels/day per defender. Win chance is power-based:
    /// 50 + (attackerPower - defenderPower), clamped to 10..90.
    /// The winner mints a Gene Shard. A Lowborn beating an Ancestor
    /// mints an Ancestor Gene Shard (item 1), which counts double
    /// toward an evolution attempt.
    function duel(uint256 attackerId, uint256 defenderId) external returns (uint256 winnerId, uint256 shardId) {
        Token storage a = _requireOwned(attackerId, KIND_FATEBORN);
        require(!a.ascended, "ascended cannot duel");
        Token storage d = _requireToken(defenderId);
        require(d.kind == KIND_FATEBORN, "defender is not a Fateborn");
        require(!d.ascended, "ascended cannot duel");
        require(_owners[defenderId] != msg.sender, "cannot duel yourself");
        require(attackerId != defenderId, "same token");
        uint256 today = _today();
        if (_lastDuelDay[attackerId] != today) {
            _lastDuelDay[attackerId] = today;
            _duelsToday[attackerId] = 0;
        }
        if (_lastDuelReceivedDay[defenderId] != today) {
            _lastDuelReceivedDay[defenderId] = today;
            _duelsReceivedToday[defenderId] = 0;
        }
        require(_duelsToday[attackerId] < DUELS_PER_DAY, "duel limit reached");
        require(_duelsReceivedToday[defenderId] < DUELS_PER_DAY, "defender duel limit reached");
        _duelsToday[attackerId] += 1;
        _duelsReceivedToday[defenderId] += 1;
        uint256 attPower = _duelPower(a);
        uint256 defPower = _duelPower(d);
        uint256 chance = 50;
        if (attPower >= defPower) {
            chance = 50 + (attPower - defPower);
            if (chance > 90) chance = 90;
        } else {
            uint256 gap = defPower - attPower;
            chance = gap >= 40 ? 10 : 50 - gap;
        }
        uint256 roll = _rand(0xD0E1) % 100;
        bool attackerWins = roll < chance;
        winnerId = attackerWins ? attackerId : defenderId;
        uint256 loserId = attackerWins ? defenderId : attackerId;
        address winnerOwner = _owners[winnerId];
        Token storage loser = _tokens[loserId];
        bool doubleShard = _tokens[winnerId].item == 2 && loser.item == 0;
        Token memory shard = Token({
            kind: KIND_GENE_SHARD,
            item: doubleShard ? 1 : 0,
            rarity: 0,
            serial: 0,
            power: 0,
            speed: 0,
            traits: 0,
            mutationCount: 0,
            fateMeter: 0,
            fatedNumber: 0,
            ascended: false,
            season2Reserved: false,
            mintDay: uint32(today)
        });
        shardId = _mint(winnerOwner, shard);
        emit DuelResolved(winnerOwner, winnerId, loserId, shardId, doubleShard);
    }

    // ----- Fated evolution -----

    /// @notice Attempt a Fated evolution. Burn Gene Shards worth >= 5
    /// (a normal shard counts 1, an Ancestor shard counts 2; 3-5 tokens).
    /// Success chance by tier, or guaranteed when the Fate meter reaches
    /// its threshold. A failed attempt adds +1 to the meter and a
    /// Corruption trait. Fated cap is 100 — attempts revert (before any
    /// burn) once the cap is reached.
    function evolve(uint256 fatebornId, uint256[] calldata shardIds) external returns (bool success) {
        Token storage f = _requireOwned(fatebornId, KIND_FATEBORN);
        require(!f.ascended, "ascended cannot evolve");
        require(f.rarity < 4, "already Fated");
        require(fatedCount < FATED_CAP, "Fated cap reached");
        require(shardIds.length >= 3 && shardIds.length <= 5, "need 3-5 shards");
        uint256 value;
        for (uint256 i = 0; i < shardIds.length; i++) {
            Token storage s = _requireOwned(shardIds[i], KIND_GENE_SHARD);
            require(_listings[shardIds[i]].active == false, "shard listed");
            value += s.item == 1 ? 2 : 1;
        }
        require(value >= 5, "shards worth < 5");
        for (uint256 i = 0; i < shardIds.length; i++) {
            _burn(msg.sender, shardIds[i]);
        }
        uint8 attempts = f.fateMeter + 1;
        uint8 threshold = guaranteeThreshold(f.item);
        uint256 roll = _rand(0xE0) % 100;
        if (attempts >= threshold || roll < evolutionChance(f.item)) {
            success = true;
            f.rarity = 4;
            fatedCount += 1;
            f.fatedNumber = uint32(fatedCount);
            f.fateMeter = attempts;
        } else {
            success = false;
            f.fateMeter = attempts;
            f.traits |= TRAIT_CORRUPTION;
        }
        emit Evolved(msg.sender, fatebornId, success, f.fatedNumber, f.fateMeter);
    }

    // ----- Ascend -----

    /// @notice Ascend a Fated Fateborn: it becomes Eternal, earns a weekly
    /// share of the reward pool, locks a guaranteed Ancestor spot in
    /// Season 2 (its Season 2 Ancestor carries one of its traits), and
    /// becomes non-transferable. Irreversible.
    function ascend(uint256 fatebornId) external {
        Token storage f = _requireOwned(fatebornId, KIND_FATEBORN);
        require(f.rarity == 4, "not Fated");
        require(!f.ascended, "already ascended");
        require(_listings[fatebornId].active == false, "listed");
        f.ascended = true;
        f.season2Reserved = true;
        ascendedCount += 1;
        emit Ascended(msg.sender, fatebornId);
    }

    /// @notice Claim an Ascended Fateborn's weekly pool share: 0.5% of the
    /// current reward pool, at most once per 7 days per token. The pool
    /// can never be emptied in a single claim.
    function claimAscendShare(uint256 fatebornId) external nonReentrant returns (uint256 payout) {
        Token storage f = _requireOwned(fatebornId, KIND_FATEBORN);
        require(f.ascended, "not ascended");
        require(block.timestamp >= _lastAscendClaim[fatebornId] + ASCEND_CLAIM_COOLDOWN, "claim cooldown");
        require(rewardPool > 0, "pool empty");
        payout = (rewardPool * ASCEND_CLAIM_BPS) / 10000;
        require(payout > 0, "payout is zero");
        _lastAscendClaim[fatebornId] = block.timestamp;
        rewardPool -= payout;
        (bool ok, ) = msg.sender.call{value: payout}("");
        require(ok, "payout failed");
        emit AscendShareClaimed(msg.sender, fatebornId, payout);
    }

    // ----- In-site market -----

    /// @notice List a Fateborn, Mutagen or Gene Shard for sale in BNB.
    /// Ascended Fateborn cannot be listed (they are Eternal).
    function listToken(uint256 tokenId, uint256 price) external {
        Token storage t = _requireToken(tokenId);
        require(_owners[tokenId] == msg.sender, "not your token");
        require(!t.ascended, "ascended cannot be listed");
        require(price > 0, "price is zero");
        require(!_listings[tokenId].active, "already listed");
        _listings[tokenId] = Listing({seller: msg.sender, price: price, active: true});
        emit Listed(msg.sender, tokenId, price);
    }

    function cancelListing(uint256 tokenId) external {
        Listing storage l = _listings[tokenId];
        require(l.active, "not listed");
        require(l.seller == msg.sender, "not the seller");
        l.active = false;
        emit ListingCancelled(msg.sender, tokenId);
    }

    function listingOf(uint256 tokenId) external view returns (address seller, uint256 price, bool active) {
        Listing storage l = _listings[tokenId];
        return (l.seller, l.price, l.active);
    }

    /// @notice Buy a listed token. Fee 5% total: 3% stays in this
    /// contract as reward pool, 2% goes to the creator wallet, the
    /// rest goes to the seller. No ERC-2981 royalty is charged on top
    /// inside this market — royaltyInfo applies to external
    /// marketplaces only.
    function buyToken(uint256 tokenId) external payable nonReentrant {
        Listing storage l = _listings[tokenId];
        require(l.active, "not listed");
        require(msg.value == l.price, "wrong value");
        address seller = l.seller;
        require(seller != msg.sender, "cannot buy your own listing");
        Token storage t = _requireToken(tokenId);
        require(_owners[tokenId] == seller, "seller no longer owns it");
        require(!t.ascended, "ascended cannot be sold");
        l.active = false;
        uint256 poolShare = (msg.value * POOL_FEE_BPS) / 10000;
        uint256 creatorShare = (msg.value * CREATOR_FEE_BPS) / 10000;
        uint256 sellerShare = msg.value - poolShare - creatorShare;
        rewardPool += poolShare;
        _transfer(seller, msg.sender, tokenId);
        (bool ok1, ) = seller.call{value: sellerShare}("");
        require(ok1, "seller payout failed");
        (bool ok2, ) = creator.call{value: creatorShare}("");
        require(ok2, "creator payout failed");
        emit Sold(seller, msg.sender, tokenId, msg.value, poolShare, creatorShare);
    }

    // ----- Views -----

    function totalMinted() external view returns (uint256) {
        return _tokens.length;
    }

    function tokenInfo(uint256 tokenId)
        external
        view
        returns (
            uint8 kind,
            uint8 item,
            uint8 rarity,
            uint32 serial,
            uint32 power,
            uint32 speed,
            uint16 traits,
            uint16 mutationCount,
            uint8 fateMeter,
            uint32 fatedNumber,
            bool ascended,
            bool season2Reserved
        )
    {
        Token storage t = _requireToken(tokenId);
        return (
            t.kind,
            t.item,
            t.rarity,
            t.serial,
            t.power,
            t.speed,
            t.traits,
            t.mutationCount,
            t.fateMeter,
            t.fatedNumber,
            t.ascended,
            t.season2Reserved
        );
    }

    function duelsLeftToday(uint256 tokenId) external view returns (uint8) {
        if (_lastDuelDay[tokenId] != _today()) return uint8(DUELS_PER_DAY);
        uint8 used = _duelsToday[tokenId];
        return used >= DUELS_PER_DAY ? 0 : uint8(DUELS_PER_DAY) - used;
    }

    function canClaimIngredientToday(uint256 tokenId) external view returns (bool) {
        if (tokenId >= _tokens.length || _burned[tokenId]) return false;
        return _lastIngredientDay[tokenId] != _today();
    }

    // ----- ERC-721 -----

    function balanceOf(address account) external view returns (uint256) {
        require(account != address(0), "zero address");
        return _balances[account];
    }

    function ownerOf(uint256 tokenId) public view returns (address) {
        require(tokenId < _tokens.length && !_burned[tokenId], "token does not exist");
        address own = _owners[tokenId];
        require(own != address(0), "token does not exist");
        return own;
    }

    function _isSoulbound(uint256 tokenId) internal view returns (bool) {
        return _tokens[tokenId].ascended;
    }

    function _transfer(address from, address to, uint256 tokenId) internal {
        _tokenApprovals[tokenId] = address(0);
        if (_listings[tokenId].active) _listings[tokenId].active = false;
        _owners[tokenId] = to;
        _balances[from] -= 1;
        _balances[to] += 1;
        emit Transfer(from, to, tokenId);
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        require(tokenId < _tokens.length && !_burned[tokenId], "token does not exist");
        require(!_isSoulbound(tokenId), "ascended is soulbound");
        require(_owners[tokenId] == from, "from is not the owner");
        require(to != address(0), "transfer to zero address");
        require(
            msg.sender == from || msg.sender == _tokenApprovals[tokenId] || _operatorApprovals[from][msg.sender],
            "not owner or approved"
        );
        _transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        safeTransferFrom(from, to, tokenId, "");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public {
        transferFrom(from, to, tokenId);
        require(_checkOnERC721Received(from, to, tokenId, data), "transfer to non-ERC721 receiver");
    }

    function _checkOnERC721Received(address from, address to, uint256 tokenId, bytes memory data)
        internal
        returns (bool)
    {
        if (to.code.length == 0) return true;
        (bool ok, bytes memory ret) = to.call(
            abi.encodeWithSelector(0x150b7a5e, msg.sender, from, tokenId, data)
        );
        if (!ok || ret.length < 32) return false;
        return abi.decode(ret, (bytes4)) == bytes4(0x150b7a5e);
    }

    function approve(address approved, uint256 tokenId) external {
        require(tokenId < _tokens.length && !_burned[tokenId], "token does not exist");
        require(!_isSoulbound(tokenId), "ascended is soulbound");
        address own = _owners[tokenId];
        require(msg.sender == own || _operatorApprovals[own][msg.sender], "not owner or operator");
        _tokenApprovals[tokenId] = approved;
        emit Approval(own, approved, tokenId);
    }

    function setApprovalForAll(address operator, bool approved) external {
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function getApproved(uint256 tokenId) external view returns (address) {
        require(tokenId < _tokens.length && !_burned[tokenId], "token does not exist");
        return _tokenApprovals[tokenId];
    }

    function isApprovedForAll(address account, address operator) external view returns (bool) {
        return _operatorApprovals[account][operator];
    }

    /// @notice 5% royalty to THIS contract (into the reward pool) — for
    /// external marketplaces only. The in-site market charges its own
    /// 5% split and does not add this on top.
    function royaltyInfo(uint256 tokenId, uint256 salePrice)
        external
        view
        returns (address receiver, uint256 royaltyAmount)
    {
        require(tokenId < _tokens.length && !_burned[tokenId], "token does not exist");
        return (address(this), (salePrice * ROYALTY_BPS) / 10000);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return
            interfaceId == 0x01ffc9a7 || // ERC165
            interfaceId == 0x80ac58cd || // ERC721
            interfaceId == 0x5b5e139f || // ERC721Metadata
            interfaceId == 0x2a55205a; // ERC2981
    }

    /// @notice Dynamic metadata (AXR pattern): baseURI + tokenId points at
    /// the Cloudflare Pages Functions endpoint /metadata/<id>, which reads
    /// tokenInfo() and returns JSON whose image and attributes update on
    /// every mutation. NOT IPFS.
    function tokenURI(uint256 tokenId) external view returns (string memory) {
        require(tokenId < _tokens.length && !_burned[tokenId], "token does not exist");
        if (bytes(_baseURI).length == 0) return "";
        return string(abi.encodePacked(_baseURI, _toString(tokenId)));
    }

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}
