// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test, stdJson} from "forge-std/Test.sol";
import {TrieHarness} from "./TrieHarness.sol";
import {Trie} from "../src/lib/Trie.sol";

/// Trie.read on Revive storage proofs captured from the live V3 node (prover/fixtures/slot-*.json).
contract TrieTest is Test {
    using stdJson for string;

    TrieHarness trie;
    uint256[3] BLOCKS = [uint256(292529), 292553, 292560];

    function setUp() public {
        trie = new TrieHarness();
    }

    function load(uint256 b)
        internal
        view
        returns (bytes32 stateRoot, bytes[] memory main, bytes[] memory child, bytes memory childKey, bytes memory key, bytes32 childRoot, bytes memory value)
    {
        string memory json = vm.readFile(string.concat("../prover/fixtures/slot-", vm.toString(b), ".json"));
        stateRoot = json.readBytes32(".stateRoot");
        main = json.readBytesArray(".proof.mainProof");
        child = json.readBytesArray(".proof.childProof");
        childKey = abi.encodePacked(":child_storage:default:", json.readBytes32(".proof.trieId"));
        key = json.readBytes(".proof.key");
        childRoot = json.readBytes32(".expect.childRoot");
        value = json.readBytes(".expect.value");
    }

    function test_readsLiveContractStorage() public view {
        for (uint256 i = 0; i < BLOCKS.length; i++) {
            (bytes32 stateRoot, bytes[] memory main, bytes[] memory child, bytes memory childKey, bytes memory key, bytes32 childRoot, bytes memory value) = load(BLOCKS[i]);
            (bool found, bytes memory got) = trie.read(stateRoot, main, childKey);
            assertTrue(found, "child root present");
            assertEq(bytes32(got), childRoot, "child root");
            (found, got) = trie.read(childRoot, child, key);
            assertTrue(found, "slot present");
            assertEq(got, value, "slot value, the bare 32-byte word");
        }
    }

    function test_absentKeyIsNotFound() public view {
        (, , bytes[] memory child, , bytes memory key, bytes32 childRoot,) = load(BLOCKS[0]);
        key[31] = bytes1(uint8(key[31]) ^ 1);
        (bool found,) = trie.read(childRoot, child, key);
        assertFalse(found);
    }

    function test_proofForAnotherRootIsIncomplete() public {
        (bytes32 stateRoot, bytes[] memory main, , bytes memory childKey, , ,) = load(BLOCKS[0]);
        vm.expectRevert(Trie.ProofIncomplete.selector);
        trie.read(bytes32(uint256(stateRoot) ^ 1), main, childKey);
    }

    function test_gas_readSlot() public {
        (, , bytes[] memory child, , bytes memory key, bytes32 childRoot,) = load(BLOCKS[0]);
        uint256 before = gasleft();
        trie.read(childRoot, child, key);
        emit log_named_uint("child-trie read gas (local)", before - gasleft());
    }
}
