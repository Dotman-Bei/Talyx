// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TalyxEscrow} from "../src/TalyxEscrow.sol";
import {IFinalizedStateRoots} from "../src/IFinalizedStateRoots.sol";
import {Blake2b} from "../src/lib/Blake2b.sol";
import {TrieBuilder} from "./TrieHarness.sol";

/// State roots the test controls; BeefyStateRoots itself is tested against live imports in BeefyStateRoots.t.sol.
contract MockStateRoots is IFinalizedStateRoots {
    error UnknownBlock();
    mapping(bytes32 => bytes32) public roots;
    function set(bytes32 blockHash, bytes32 stateRoot) external { roots[blockHash] = stateRoot; }
    function stateRootOf(bytes32 blockHash) external view returns (bytes32, uint32) {
        if (roots[blockHash] == bytes32(0)) revert UnknownBlock();
        return (roots[blockHash], 292_529);
    }
    function genesisHash() external pure returns (bytes32) { return 0xd4f9acbcf7f52388d8b095abe3c198d19fc510e0343e643e87cfbccb155283bd; }
}

contract TalyxEscrowTest is Test {
    TalyxEscrow escrow;
    MockStateRoots stateRoots;

    address constant FILLBOOK = address(0xF111B00C);
    bytes32 constant TRIE_ID = 0x861191d512414a72c6680d921d112be8cad05b726eeac2e8ef4ffe3004549f4f;
    address constant REQUESTER = address(0x5b1E7d04a2c9F3E86B0d4A17c2E95F38d61A0C47);
    address constant RECIPIENT = address(0x3F2a9c4e1b7d8a06f5C2E9B13d4a7F60C81ea91c);
    address constant PAYEE = address(0x8c41F2e6a09B3D7c5E1F84A2b6d9c03e7a5102Be);
    uint256 constant AMOUNT = 0.5 ether; // 0.5 tPOT in Revive's 18-decimal units
    uint256 constant PRICE = 0.0001 ether;
    uint256 constant WINDOW = 30 minutes;
    bytes32 constant BLOCK_HASH = keccak256("V3 block 292,529");

    uint64 deadline;
    uint256 orderId;

    function setUp() public {
        vm.warp(1_793_000_000);
        stateRoots = new MockStateRoots();
        escrow = new TalyxEscrow(stateRoots, FILLBOOK, TRIE_ID, WINDOW);
        vm.deal(REQUESTER, 1 ether);
        deadline = uint64(block.timestamp + 1 hours);
        vm.prank(REQUESTER);
        orderId = escrow.createOrder{value: PRICE}(RECIPIENT, AMOUNT, deadline);
    }

    /* ---------- proofs: a V3 state whose FillBook child trie holds one fill record ---------- */

    function word(address payee, uint64 ts) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(payee)) | (uint256(ts) << 160));
    }

    /// Writes a state root for BLOCK_HASH whose FillBook trie (`trieId`) holds `value` under `slot`.
    function stage(bytes32 trieId, bytes32 slot, bytes32 value) internal returns (bytes[] memory main, bytes[] memory child) {
        bytes memory childLeaf = TrieBuilder.leaf(abi.encodePacked(Blake2b.hash256(abi.encodePacked(slot))), abi.encodePacked(value));
        bytes32 childRoot = TrieBuilder.root(childLeaf);
        bytes memory mainLeaf = TrieBuilder.leaf(abi.encodePacked(":child_storage:default:", trieId), abi.encodePacked(childRoot));
        stateRoots.set(BLOCK_HASH, TrieBuilder.root(mainLeaf));
        main = new bytes[](1);
        main[0] = mainLeaf;
        child = new bytes[](1);
        child[0] = childLeaf;
    }

    function stageRealFill(uint64 ts) internal returns (bytes[] memory, bytes[] memory) {
        return stage(TRIE_ID, escrow.fillSlot(orderId, RECIPIENT, AMOUNT), word(PAYEE, ts));
    }

    /* ---------- the happy path ---------- */

    function test_claimPaysTheRecordedPayee() public {
        uint64 ts = deadline - 600;
        (bytes[] memory main, bytes[] memory child) = stageRealFill(ts);
        escrow.claim(orderId, PAYEE, ts, BLOCK_HASH, main, child);
        assertEq(PAYEE.balance, PRICE);
        (, , , , , TalyxEscrow.Status status) = escrow.orders(orderId);
        assertEq(uint8(status), uint8(TalyxEscrow.Status.Claimed));
    }

    function test_anyoneCanSubmitTheClaim() public {
        uint64 ts = deadline - 1;
        (bytes[] memory main, bytes[] memory child) = stageRealFill(ts);
        vm.prank(address(0x7E1A7E));
        escrow.claim(orderId, PAYEE, ts, BLOCK_HASH, main, child);
        assertEq(PAYEE.balance, PRICE);
    }

    function test_gas_claim() public {
        uint64 ts = deadline - 600;
        (bytes[] memory main, bytes[] memory child) = stageRealFill(ts);
        uint256 before = gasleft();
        escrow.claim(orderId, PAYEE, ts, BLOCK_HASH, main, child);
        emit log_named_uint("claim gas (local, single-leaf tries)", before - gasleft());
    }

    /* ---------- forged claims (prd.md §12) ---------- */

    /// T-1: the record is for another recipient, so the order's slot is empty.
    function test_T1_otherRecipient() public {
        uint64 ts = deadline - 600;
        (bytes[] memory main, bytes[] memory child) = stage(TRIE_ID, escrow.fillSlot(orderId, address(0xBEEF), AMOUNT), word(PAYEE, ts));
        vm.expectRevert(TalyxEscrow.SlotMismatch.selector);
        escrow.claim(orderId, PAYEE, ts, BLOCK_HASH, main, child);
    }

    /// T-2: the record is for another amount.
    function test_T2_otherAmount() public {
        uint64 ts = deadline - 600;
        (bytes[] memory main, bytes[] memory child) = stage(TRIE_ID, escrow.fillSlot(orderId, RECIPIENT, AMOUNT - 1e4), word(PAYEE, ts));
        vm.expectRevert(TalyxEscrow.SlotMismatch.selector);
        escrow.claim(orderId, PAYEE, ts, BLOCK_HASH, main, child);
    }

    /// T-3: the real proof, claimed for another payee.
    function test_T3_otherPayee() public {
        uint64 ts = deadline - 600;
        (bytes[] memory main, bytes[] memory child) = stageRealFill(ts);
        vm.expectRevert(TalyxEscrow.WordMismatch.selector);
        escrow.claim(orderId, address(0xBAD), ts, BLOCK_HASH, main, child);
    }

    /// T-4: the real proof with the fill time moved.
    function test_T4_otherTimestamp() public {
        uint64 ts = deadline - 600;
        (bytes[] memory main, bytes[] memory child) = stageRealFill(ts);
        vm.expectRevert(TalyxEscrow.WordMismatch.selector);
        escrow.claim(orderId, PAYEE, ts - 1, BLOCK_HASH, main, child);
    }

    /// T-5: a real record written after the deadline.
    function test_T5_fillAfterDeadline() public {
        uint64 ts = deadline + 1;
        (bytes[] memory main, bytes[] memory child) = stageRealFill(ts);
        vm.expectRevert(TalyxEscrow.FillTooLate.selector);
        escrow.claim(orderId, PAYEE, ts, BLOCK_HASH, main, child);
    }

    /// T-14: the main-trie proof is for another contract's trie.
    function test_T14_otherTrieId() public {
        uint64 ts = deadline - 600;
        (bytes[] memory main, bytes[] memory child) = stage(bytes32(uint256(TRIE_ID) ^ 1), escrow.fillSlot(orderId, RECIPIENT, AMOUNT), word(PAYEE, ts));
        vm.expectRevert(TalyxEscrow.ChildRootMismatch.selector);
        escrow.claim(orderId, PAYEE, ts, BLOCK_HASH, main, child);
    }

    /// T-15: a block hash never imported.
    function test_T15_unknownBlock() public {
        uint64 ts = deadline - 600;
        (bytes[] memory main, bytes[] memory child) = stageRealFill(ts);
        vm.expectRevert(MockStateRoots.UnknownBlock.selector);
        escrow.claim(orderId, PAYEE, ts, keccak256("never imported"), main, child);
    }

    /// T-16: a second claim.
    function test_T16_doubleClaim() public {
        uint64 ts = deadline - 600;
        (bytes[] memory main, bytes[] memory child) = stageRealFill(ts);
        escrow.claim(orderId, PAYEE, ts, BLOCK_HASH, main, child);
        vm.expectRevert(TalyxEscrow.NotOpen.selector);
        escrow.claim(orderId, PAYEE, ts, BLOCK_HASH, main, child);
    }

    /// T-17: refund before the window closes.
    function test_T17_refundTooEarly() public {
        vm.warp(deadline + WINDOW);
        vm.expectRevert(TalyxEscrow.TooEarly.selector);
        escrow.refund(orderId);
    }

    /// T-18: claim after a refund (I-5: refund and claim exclude each other).
    function test_T18_claimAfterRefund() public {
        uint64 ts = deadline - 600;
        (bytes[] memory main, bytes[] memory child) = stageRealFill(ts);
        vm.warp(deadline + WINDOW + 1);
        escrow.refund(orderId);
        vm.expectRevert(TalyxEscrow.NotOpen.selector);
        escrow.claim(orderId, PAYEE, ts, BLOCK_HASH, main, child);
    }

    /// T-19: a record keyed by the same order id on another escrow.
    function test_T19_orderKeyFromAnotherEscrow() public {
        TalyxEscrow other = new TalyxEscrow(stateRoots, FILLBOOK, TRIE_ID, WINDOW);
        uint64 ts = deadline - 600;
        (bytes[] memory main, bytes[] memory child) = stage(TRIE_ID, other.fillSlot(orderId, RECIPIENT, AMOUNT), word(PAYEE, ts));
        vm.expectRevert(TalyxEscrow.SlotMismatch.selector);
        escrow.claim(orderId, PAYEE, ts, BLOCK_HASH, main, child);
    }

    /// T-20: amounts finer than 1e4 EVM units cannot exist on V3.
    function test_T20_amountNotDivisible() public {
        vm.prank(REQUESTER);
        vm.expectRevert(TalyxEscrow.BadAmount.selector);
        escrow.createOrder{value: PRICE}(RECIPIENT, AMOUNT + 1, deadline);
    }

    /* ---------- orders and refunds ---------- */

    function test_refundAfterWindowReturnsTheEth() public {
        vm.warp(deadline + WINDOW + 1);
        uint256 before = REQUESTER.balance;
        escrow.refund(orderId);
        assertEq(REQUESTER.balance, before + PRICE);
    }

    function test_createOrderRejectsAPastDeadline() public {
        vm.prank(REQUESTER);
        vm.expectRevert(TalyxEscrow.BadDeadline.selector);
        escrow.createOrder{value: PRICE}(RECIPIENT, AMOUNT, uint64(block.timestamp));
    }

    function test_createOrderNeedsAPrice() public {
        vm.prank(REQUESTER);
        vm.expectRevert(TalyxEscrow.NoPrice.selector);
        escrow.createOrder(RECIPIENT, AMOUNT, deadline);
    }

    /// I-6: the order key binds the chain id and this escrow.
    function test_orderKeyBindsChainAndEscrow() public view {
        assertEq(escrow.orderKey(orderId), keccak256(abi.encode(block.chainid, address(escrow), orderId)));
    }
}
