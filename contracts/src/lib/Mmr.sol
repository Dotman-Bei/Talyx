// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @notice pallet_mmr as V3 runs it: one leaf per block, keccak256 nodes, peaks bagged right to left.
/// Proves the newest leaf from the on-chain peaks alone, so no offchain MMR index is needed.
library Mmr {
    error BadPeakCount();

    /// @dev The leaf added in block B commits to block B-1: keccak256(u32le(B-1) ++ hash(B-1)).
    function leaf(uint32 parentNumber, bytes32 parentHash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(_u32le(parentNumber), parentHash));
    }

    /// @notice Root after appending `newLeaf` to an MMR of `leaves` leaves whose peaks (left to right) are `peaks`.
    function rootAfterAppend(bytes32[] calldata peaks, uint256 leaves, bytes32 newLeaf) internal pure returns (bytes32) {
        uint256 count = _popcount(leaves);
        if (peaks.length != count) revert BadPeakCount();

        // the peaks' heights are the set bits of `leaves`, high to low; the lowest ones merge with the new leaf
        bytes32[] memory stack = new bytes32[](count + 1);
        uint256[] memory heights = new uint256[](count + 1);
        uint256 top;
        uint256 h = 64;
        for (uint256 i = 0; i < count; i++) {
            do { h--; } while ((leaves >> h) & 1 == 0);
            stack[top] = peaks[i];
            heights[top] = h;
            top++;
        }
        stack[top] = newLeaf;
        heights[top] = 0;
        top++;
        while (top > 1 && heights[top - 1] == heights[top - 2]) {
            stack[top - 2] = keccak256(abi.encodePacked(stack[top - 2], stack[top - 1]));
            heights[top - 2] += 1;
            top--;
        }

        bytes32 acc = stack[top - 1];
        for (uint256 i = top - 1; i > 0; i--) acc = keccak256(abi.encodePacked(acc, stack[i - 1]));
        return acc;
    }

    function _popcount(uint256 x) private pure returns (uint256 n) {
        while (x != 0) { n += x & 1; x >>= 1; }
    }

    function _u32le(uint32 v) private pure returns (bytes4) {
        return bytes4(uint32((v & 0xff) << 24 | (v & 0xff00) << 8 | (v & 0xff0000) >> 8 | (v >> 24)));
    }
}
