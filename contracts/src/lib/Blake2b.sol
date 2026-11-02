// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @notice BLAKE2b-256 (no key, 32-byte digest) over the EIP-152 F precompile at address 0x09.
/// Substrate hashes headers and trie nodes with it. Written for Talyx; the approach follows
/// blake2b-solidity (MIT, https://github.com/dhl/blake2b-solidity).
library Blake2b {
    error Blake2bFailed();

    // IV with the parameter block folded into h[0] (digest length 32, no key, fanout 1, depth 1),
    // each 64-bit word little-endian as the precompile expects.
    bytes constant H0 =
        hex"28c9bdf267e6096a3ba7ca8485ae67bb2bf894fe72f36e3cf1361d5f3af54fa5d182e6ad7f520e511f6c3e2b8c68059b6bbd41fbabd9831f79217e1319cde05b";

    function hash256(bytes memory data) internal view returns (bytes32 digest) {
        // precompile input: rounds (4, big-endian) | h (64) | m (128) | t (16, little-endian) | f (1)
        bytes memory input = new bytes(213);
        bytes memory h0 = H0;
        uint256 len = data.length;
        uint256 blocks = len == 0 ? 1 : (len + 127) / 128;
        bool ok = true;
        assembly {
            let in := add(input, 32)
            mstore8(add(in, 3), 12) // 12 rounds
            mstore(add(in, 4), mload(add(h0, 32)))
            mstore(add(in, 36), mload(add(h0, 64)))
            let src := add(data, 32)
            for { let i := 0 } lt(i, blocks) { i := add(i, 1) } {
                let off := mul(i, 128)
                let n := sub(len, off)
                if gt(n, 128) { n := 128 }
                let m := add(in, 68)
                // copy n bytes of the block, zero the rest
                for { let j := 0 } lt(j, 128) { j := add(j, 32) } {
                    let w := 0
                    if lt(j, n) {
                        w := mload(add(src, add(off, j)))
                        let keep := sub(n, j)
                        if lt(keep, 32) { w := and(w, not(sub(shl(mul(sub(32, keep), 8), 1), 1))) }
                    }
                    mstore(add(m, j), w)
                }
                // byte counter t, little-endian, and the final-block flag
                let t := add(off, n)
                let tp := add(in, 196)
                for { let k := 0 } lt(k, 16) { k := add(k, 1) } { mstore8(add(tp, k), and(shr(mul(k, 8), t), 0xff)) }
                mstore8(add(in, 212), eq(i, sub(blocks, 1)))
                ok := and(ok, staticcall(gas(), 0x09, in, 213, add(in, 4), 64))
            }
            digest := mload(add(in, 4))
        }
        if (!ok) revert Blake2bFailed();
    }
}
