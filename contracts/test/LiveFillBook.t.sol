// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test, stdJson} from "forge-std/Test.sol";
import {BeefyStateRoots} from "../src/BeefyStateRoots.sol";
import {TrieHarness} from "./TrieHarness.sol";

/// The claim path on real data: a test fill on the FillBook deployed at 0xbe86…4068 (V3 block 293,236), proven under
/// the BEEFY-signed block 293,243 that BeefyStateRoots imports here.
contract LiveFillBookTest is Test {
    using stdJson for string;

    address constant FILLBOOK_PAYEE = 0x5e3cC65cA2f1a6AC3Bf75f7110E50d296F127fe6;
    bytes32 constant FILLBOOK_TRIE_ID = 0x13cd5a49017997a0635348586915f609bb5a5e0b85acae8583dcc1ac4fe24d30;

    function test_proveARealFillBookRecordUnderAnImportedBlock() public {
        BeefyStateRoots roots = new BeefyStateRoots(
            [0x4D13B6AeA6CD423CC48d7159ac10b26927c2B421, 0x4A69B8F722A9b486f9dB0d243C908170012d7413],
            0xc745b6c2eca708396dde733c7b93f344da8eee0eb435e68fac6a77bce9c1a7d5,
            0xd4f9acbcf7f52388d8b095abe3c198d19fc510e0343e643e87cfbccb155283bd
        );
        string memory imp = vm.readFile("../prover/fixtures/import-293243.json");
        bytes32 blockHash = roots.importBlock(
            imp.readBytes(".input.justification"), imp.readBytes32Array(".input.peaksAtPrev"), imp.readBytes(".input.headerPrev")
        );
        (bytes32 stateRoot, uint32 number) = roots.stateRootOf(blockHash);
        assertEq(number, 293_242);

        string memory slot = vm.readFile("../prover/fixtures/fillbook-293242.json");
        assertEq(slot.readBytes32(".proof.trieId"), FILLBOOK_TRIE_ID);
        TrieHarness trie = new TrieHarness();
        (bool hasChild, bytes memory childRoot) =
            trie.read(stateRoot, slot.readBytesArray(".proof.mainProof"), abi.encodePacked(":child_storage:default:", FILLBOOK_TRIE_ID));
        assertTrue(hasChild);
        (bool hasFill, bytes memory word) = trie.read(bytes32(childRoot), slot.readBytesArray(".proof.childProof"), slot.readBytes(".proof.key"));
        assertTrue(hasFill);
        assertEq(word.length, 32, "the bare word");
        assertEq(address(uint160(uint256(bytes32(word)))), FILLBOOK_PAYEE, "payee in the low 160 bits");
        assertEq(uint256(bytes32(word)) >> 160, 0x6ae8a5f4, "fill time in the next 64 bits");
    }
}
