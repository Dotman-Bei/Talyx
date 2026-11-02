// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Trie} from "../src/lib/Trie.sol";
import {Blake2b} from "../src/lib/Blake2b.sol";

/// Exposes Trie.read (which takes calldata proofs) to tests.
contract TrieHarness {
    function read(bytes32 root, bytes[] calldata proof, bytes calldata key) external view returns (bool, bytes memory) {
        return Trie.read(root, proof, key);
    }
}

/// Builds single-leaf Substrate tries (layout V1) for synthetic proofs.
library TrieBuilder {
    /// A leaf node holding `value` under the whole `key`: header, partial key, compact(len) ++ value.
    function leaf(bytes memory key, bytes memory value) internal pure returns (bytes memory) {
        uint256 nibbles = key.length * 2;
        bytes memory header;
        if (nibbles < 63) {
            header = abi.encodePacked(uint8(0x40 | nibbles));
        } else {
            header = abi.encodePacked(uint8(0x7f));
            uint256 rest = nibbles - 63;
            while (rest >= 255) { header = abi.encodePacked(header, uint8(255)); rest -= 255; }
            header = abi.encodePacked(header, uint8(rest));
        }
        require(value.length < 64, "short values only");
        return abi.encodePacked(header, key, uint8(value.length << 2), value);
    }

    function root(bytes memory node) internal view returns (bytes32) {
        return Blake2b.hash256(node);
    }
}
