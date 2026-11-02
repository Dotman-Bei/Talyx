// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test, stdJson} from "forge-std/Test.sol";
import {BeefyStateRoots} from "../src/BeefyStateRoots.sol";
import {Blake2b} from "../src/lib/Blake2b.sol";

/// Imports captured from the live V3 node by `talyx spike` (prover/fixtures), plus the forged-proof cases of prd.md §12.
contract BeefyStateRootsTest is Test {
    using stdJson for string;

    address constant KEY_1 = 0x4D13B6AeA6CD423CC48d7159ac10b26927c2B421;
    address constant KEY_2 = 0x4A69B8F722A9b486f9dB0d243C908170012d7413;
    bytes32 constant KEYSET = 0xc745b6c2eca708396dde733c7b93f344da8eee0eb435e68fac6a77bce9c1a7d5;
    bytes32 constant GENESIS = keccak256("V3 genesis placeholder for tests");

    // three live justifications: 292,530 and 292,554 (set 492), 292,561 (set 493)
    uint256[3] BLOCKS = [uint256(292530), 292554, 292561];

    BeefyStateRoots roots;

    struct Fixture {
        bytes justification;
        bytes32[] peaks;
        bytes header;
        bytes32 blockHash;
        bytes32 stateRoot;
    }

    function setUp() public {
        roots = new BeefyStateRoots([KEY_1, KEY_2], KEYSET, GENESIS);
    }

    function load(uint256 b) internal view returns (Fixture memory f) {
        string memory json = vm.readFile(string.concat("../prover/fixtures/import-", vm.toString(b), ".json"));
        f.justification = json.readBytes(".input.justification");
        f.peaks = json.readBytes32Array(".input.peaksAtPrev");
        f.header = json.readBytes(".input.headerPrev");
        f.blockHash = json.readBytes32(".expect.blockHash");
        f.stateRoot = json.readBytes32(".expect.stateRoot");
    }

    /* ---------- live imports ---------- */

    function test_importsEachLiveJustification() public {
        for (uint256 i = 0; i < BLOCKS.length; i++) {
            Fixture memory f = load(BLOCKS[i]);
            bytes32 h = roots.importBlock(f.justification, f.peaks, f.header);
            assertEq(h, f.blockHash, "block hash");
            (bytes32 stateRoot, uint32 number) = roots.stateRootOf(h);
            assertEq(stateRoot, f.stateRoot, "state root");
            assertEq(number, BLOCKS[i] - 1, "number");
        }
        assertEq(roots.lastSetId(), 493);
    }

    function test_importEmitsEvent() public {
        Fixture memory f = load(BLOCKS[0]);
        vm.expectEmit(true, true, false, true);
        emit BeefyStateRoots.Imported(uint32(BLOCKS[0] - 1), f.blockHash, f.stateRoot, 492);
        roots.importBlock(f.justification, f.peaks, f.header);
    }

    function test_gas_importBlock() public {
        Fixture memory f = load(BLOCKS[0]);
        uint256 before = gasleft();
        roots.importBlock(f.justification, f.peaks, f.header);
        emit log_named_uint("importBlock gas (local, 10 peaks)", before - gasleft());
    }

    /// I-7: a second import of the same block changes nothing.
    function test_reimportIsANoOp() public {
        Fixture memory f = load(BLOCKS[0]);
        roots.importBlock(f.justification, f.peaks, f.header);
        roots.importBlock(f.justification, f.peaks, f.header);
        (bytes32 stateRoot,) = roots.stateRootOf(f.blockHash);
        assertEq(stateRoot, f.stateRoot);
    }

    function test_genesisHash() public view {
        assertEq(roots.genesisHash(), GENESIS);
    }

    /* ---------- forged proofs (prd.md §12) ---------- */

    function test_T6_oneSignatureOnly() public {
        Fixture memory f = load(BLOCKS[0]);
        f.justification[50] = 0x80; // bitfield marks validator 0 only
        vm.expectRevert(BeefyStateRoots.NotEnoughSignatures.selector);
        roots.importBlock(f.justification, f.peaks, f.header);
    }

    function test_T7_signerNotAnAuthority() public {
        address stranger = vm.addr(0xBEEF);
        BeefyStateRoots other = new BeefyStateRoots(
            [stranger, KEY_2],
            keccak256(abi.encodePacked(keccak256(abi.encodePacked(stranger)), keccak256(abi.encodePacked(KEY_2)))),
            GENESIS
        );
        Fixture memory f = load(BLOCKS[0]);
        vm.expectRevert(BeefyStateRoots.BadSigner.selector);
        other.importBlock(f.justification, f.peaks, f.header);
    }

    function test_T8_duplicateSignature() public {
        Fixture memory f = load(BLOCKS[0]);
        for (uint256 i = 0; i < 65; i++) f.justification[121 + i] = f.justification[56 + i];
        vm.expectRevert(BeefyStateRoots.BadSigner.selector);
        roots.importBlock(f.justification, f.peaks, f.header);
    }

    function test_T9_signedRootByteFlipped() public {
        Fixture memory f = load(BLOCKS[0]);
        f.justification[10] = bytes1(uint8(f.justification[10]) ^ 1);
        vm.expectRevert(BeefyStateRoots.BadSigner.selector);
        roots.importBlock(f.justification, f.peaks, f.header);
    }

    function test_T10_peakAltered() public {
        Fixture memory f = load(BLOCKS[0]);
        f.peaks[0] = bytes32(uint256(f.peaks[0]) ^ 1);
        vm.expectRevert(BeefyStateRoots.MmrRootMismatch.selector);
        roots.importBlock(f.justification, f.peaks, f.header);
    }

    function test_T10_peakMissing() public {
        Fixture memory f = load(BLOCKS[0]);
        bytes32[] memory fewer = new bytes32[](f.peaks.length - 1);
        for (uint256 i = 0; i < fewer.length; i++) fewer[i] = f.peaks[i + 1];
        vm.expectRevert(bytes4(keccak256("BadPeakCount()")));
        roots.importBlock(f.justification, fewer, f.header);
    }

    function test_T11_headerFromAnotherBlock() public {
        Fixture memory f = load(BLOCKS[0]);
        Fixture memory g = load(BLOCKS[1]);
        vm.expectRevert(BeefyStateRoots.HeaderMismatch.selector);
        roots.importBlock(f.justification, f.peaks, g.header);
    }

    function test_T11_headerBodyTampered() public {
        Fixture memory f = load(BLOCKS[0]);
        f.header[60] = bytes1(uint8(f.header[60]) ^ 1); // inside the state root
        vm.expectRevert(BeefyStateRoots.MmrRootMismatch.selector);
        roots.importBlock(f.justification, f.peaks, f.header);
    }

    function test_T12_staleSetId() public {
        Fixture memory newer = load(BLOCKS[2]); // set 493
        Fixture memory older = load(BLOCKS[1]); // set 492
        roots.importBlock(newer.justification, newer.peaks, newer.header);
        vm.expectRevert(BeefyStateRoots.StaleSetId.selector);
        roots.importBlock(older.justification, older.peaks, older.header);
    }

    function test_T13_payloadIdNotMh() public {
        Fixture memory f = load(BLOCKS[0]);
        f.justification[2] = 0x6e; // "nh"
        vm.expectRevert(BeefyStateRoots.BadPayload.selector);
        roots.importBlock(f.justification, f.peaks, f.header);
    }

    function test_T13_extraPayloadItem() public {
        Fixture memory f = load(BLOCKS[0]);
        f.justification[1] = 0x08; // two items
        vm.expectRevert(BeefyStateRoots.BadPayload.selector);
        roots.importBlock(f.justification, f.peaks, f.header);
    }

    function test_T15_unknownBlock() public {
        vm.expectRevert(BeefyStateRoots.UnknownBlock.selector);
        roots.stateRootOf(keccak256("never imported"));
    }

    function test_badVersion() public {
        Fixture memory f = load(BLOCKS[0]);
        f.justification[0] = 0x02;
        vm.expectRevert(BeefyStateRoots.BadVersion.selector);
        roots.importBlock(f.justification, f.peaks, f.header);
    }

    /* ---------- authorities ---------- */

    function test_constructorRejectsAWrongKeyset() public {
        vm.expectRevert(BeefyStateRoots.BadKeyset.selector);
        new BeefyStateRoots([KEY_1, KEY_2], bytes32(uint256(KEYSET) ^ 1), GENESIS);
    }

    function test_onlyOwnerUpdatesAuthorities() public {
        vm.prank(address(0xCAFE));
        vm.expectRevert(BeefyStateRoots.NotOwner.selector);
        roots.setAuthorities([KEY_1, KEY_2], KEYSET);
    }

    /* ---------- BLAKE2b-256 over EIP-152 ---------- */

    function test_blake2bVectors() public view {
        assertEq(Blake2b.hash256(""), 0x0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8);
        assertEq(Blake2b.hash256("abc"), 0xbddd813c634239723171ef3fee98579b94964e3bb1cb3e427262c8c068d52319);
        bytes memory exactBlock = new bytes(128);
        for (uint256 i = 0; i < 128; i++) exactBlock[i] = bytes1(uint8(i));
        assertEq(Blake2b.hash256(exactBlock), 0xc3582f71ebb2be66fa5dd750f80baae97554f3b015663c8be377cfcb2488c1d1);
        bytes memory threeBlocks = new bytes(300);
        for (uint256 i = 0; i < 300; i++) threeBlocks[i] = bytes1(uint8(i % 251));
        assertEq(Blake2b.hash256(threeBlocks), 0x940563f11807c8ba3192299e05cf544b82463742c8a5e80c2a5d81751cd8b0ca);
    }
}
