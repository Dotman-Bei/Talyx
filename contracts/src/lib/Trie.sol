// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Blake2b} from "./Blake2b.sol";

/// @notice Reads one key from a Substrate trie proof (layout V1, blake2b-256 node hashes), as returned by
/// state_getReadProof and state_getChildReadProof. Mirrors prover/src/trie.ts, which is tested on live V3 proofs.
/// The node walk follows the format that solidity-merkle-trees' PolkadotTrie (Apache-2.0) also implements.
///
/// Node header (first byte): 0b01 leaf, 0b10 branch, 0b11 branch with value, 0b001 leaf with hashed value,
/// 0b0001 branch with hashed value, 0x00 empty; low bits hold the partial key's nibble count, extended by following
/// bytes while each is 255. Then the partial key, then for branches a u16 LE child bitmap, the value (compact length +
/// bytes, or a 32-byte hash) and each child (compact length + bytes: 32 bytes is a hash, fewer an inline node).
library Trie {
    error ProofIncomplete();
    error BadNode();

    uint8 private constant NOT_FOUND = 0;
    uint8 private constant VALUE = 1;
    uint8 private constant CHILD = 2;

    /// One node of the walk: the key is absent, or the value is here (inline or by hash), or go to a child.
    struct Step {
        uint8 result;
        bool hashedValue;
        uint256 nib;
        bytes data;
    }

    /// @return found whether the key exists, value its stored bytes
    function read(bytes32 root, bytes[] calldata proof, bytes memory key) internal view returns (bool found, bytes memory value) {
        bytes32[] memory hashes = new bytes32[](proof.length);
        for (uint256 i = 0; i < proof.length; i++) hashes[i] = Blake2b.hash256(proof[i]);

        bytes memory node = _fetch(proof, hashes, root);
        uint256 nib; // position in the key, in nibbles
        for (;;) {
            Step memory s = _step(node, key, nib);
            if (s.result == NOT_FOUND) return (false, "");
            if (s.result == VALUE) return (true, s.hashedValue ? _fetch(proof, hashes, bytes32(s.data)) : s.data);
            nib = s.nib;
            node = s.data.length == 32 ? _fetch(proof, hashes, bytes32(s.data)) : s.data; // shorter than a hash: inline
        }
    }

    function _step(bytes memory node, bytes memory key, uint256 nib) private pure returns (Step memory s) {
        (uint8 kind, uint256 count, uint256 o) = _header(node);
        if (kind == 0 || key.length * 2 - nib < count) return s;
        uint256 partialStart = o * 2 + (count % 2); // odd counts are padded in the first byte's high nibble
        for (uint256 i = 0; i < count; i++) {
            if (_nibble(node, partialStart + i) != _nibble(key, nib + i)) return s;
        }
        nib += count;
        o += (count + 1) / 2;
        s.hashedValue = kind == 4 || kind == 5;
        bool atKey = nib == key.length * 2;

        if (kind == 1 || kind == 4) {
            // leaf
            if (!atKey) return s;
            s.result = VALUE;
            s.data = _valueBytes(node, o, s.hashedValue);
            return s;
        }
        // branch: bitmap, optional value, children
        uint256 bitmap = uint256(uint8(node[o])) | uint256(uint8(node[o + 1])) << 8;
        o += 2;
        bool hasValue = kind == 3 || kind == 5;
        if (atKey) {
            if (hasValue) { s.result = VALUE; s.data = _valueBytes(node, o, s.hashedValue); }
            return s;
        }
        if (hasValue) o = _skipValue(node, o, s.hashedValue);
        uint8 want = _nibble(key, nib);
        if (bitmap & (1 << want) == 0) return s;
        for (uint8 c = 0; c < want; c++) {
            if (bitmap & (1 << c) != 0) {
                (uint256 len, uint256 size) = _compact(node, o);
                o += size + len;
            }
        }
        (uint256 childLen, uint256 childSize) = _compact(node, o);
        s.result = CHILD;
        s.nib = nib + 1;
        s.data = _slice(node, o + childSize, childLen);
    }

    /// kind: 0 empty, 1 leaf, 2 branch, 3 branch with value, 4 leaf with hashed value, 5 branch with hashed value
    function _header(bytes memory n) private pure returns (uint8 kind, uint256 count, uint256 o) {
        if (n.length == 0) revert BadNode();
        uint8 b = uint8(n[0]);
        uint256 bits;
        if (b == 0) return (0, 0, 1);
        if (b >> 6 == 1) { kind = 1; bits = 6; }
        else if (b >> 6 == 2) { kind = 2; bits = 6; }
        else if (b >> 6 == 3) { kind = 3; bits = 6; }
        else if (b >> 5 == 1) { kind = 4; bits = 5; }
        else if (b >> 4 == 1) { kind = 5; bits = 4; }
        else revert BadNode();
        uint256 max = (1 << bits) - 1;
        count = b & max;
        o = 1;
        if (count == max) {
            for (;;) {
                uint8 x = uint8(n[o++]);
                count += x;
                if (x < 255) break;
            }
        }
    }

    /// The value bytes, or the 32-byte hash of a value stored outside the node.
    function _valueBytes(bytes memory n, uint256 o, bool hashed) private pure returns (bytes memory) {
        if (hashed) return _slice(n, o, 32);
        (uint256 len, uint256 size) = _compact(n, o);
        return _slice(n, o + size, len);
    }

    function _skipValue(bytes memory n, uint256 o, bool hashed) private pure returns (uint256) {
        if (hashed) return o + 32;
        (uint256 len, uint256 size) = _compact(n, o);
        return o + size + len;
    }

    function _fetch(bytes[] calldata proof, bytes32[] memory hashes, bytes32 h) private pure returns (bytes memory) {
        for (uint256 i = 0; i < hashes.length; i++) if (hashes[i] == h) return proof[i];
        revert ProofIncomplete();
    }

    function _nibble(bytes memory b, uint256 i) private pure returns (uint8) {
        uint8 x = uint8(b[i / 2]);
        return i % 2 == 0 ? x >> 4 : x & 0x0f;
    }

    /// @return value and the number of bytes the compact integer took
    function _compact(bytes memory b, uint256 o) private pure returns (uint256 value, uint256 size) {
        uint8 b0 = uint8(b[o]);
        uint256 mode = b0 & 3;
        if (mode == 0) return (b0 >> 2, 1);
        if (mode == 1) return ((uint256(b0) | uint256(uint8(b[o + 1])) << 8) >> 2, 2);
        if (mode == 2) {
            return ((uint256(b0) | uint256(uint8(b[o + 1])) << 8 | uint256(uint8(b[o + 2])) << 16 | uint256(uint8(b[o + 3])) << 24) >> 2, 4);
        }
        revert BadNode(); // lengths of 2^30 bytes and more do not occur in proofs
    }

    function _slice(bytes memory b, uint256 o, uint256 len) private pure returns (bytes memory out) {
        if (o + len > b.length) revert BadNode();
        out = new bytes(len);
        for (uint256 i = 0; i < len; i++) out[i] = b[o + i];
    }
}
