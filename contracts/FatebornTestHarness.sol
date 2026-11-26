// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./FatebornMutant.sol";

/// @title FatebornTestHarness — LOCAL TESTS ONLY
/// @notice FatebornMutant with a forced-entropy override so tests can make
/// a mutation / duel / evolution roll land exactly where they want it.
/// Never deploy this to a live network.
contract FatebornTestHarness is FatebornMutant {
    uint256 public forcedRoll;
    bool public useForced;

    constructor(address registry, address creator_) FatebornMutant(registry, creator_) {}

    function setForcedRoll(uint256 roll) external {
        forcedRoll = roll;
        useForced = true;
    }

    function clearForcedRoll() external {
        useForced = false;
    }

    function _rand(uint256 salt) internal override returns (uint256) {
        if (useForced) {
            return forcedRoll;
        }
        return super._rand(salt);
    }

    /// @notice Test-only: change a Fateborn's tier (e.g. make one a
    /// Lowborn without brewing 1,127 tokens) to exercise the
    /// Lowborn-beats-Ancestor double-shard rule.
    function setTierForTest(uint256 tokenId, uint8 tier) external {
        _tokens[tokenId].item = tier;
    }
}
