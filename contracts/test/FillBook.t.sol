// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {FillBook} from "../src/FillBook.sol";

contract Refuser {
    receive() external payable { revert("no"); }
}

contract FillBookTest is Test {
    FillBook book;
    bytes32 constant ORDER_KEY = keccak256("order 7");
    address payable constant RECIPIENT = payable(address(0x3F2a9c4e1b7d8a06f5C2E9B13d4a7F60C81ea91c));
    address constant PAYEE = address(0x8c41F2e6a09B3D7c5E1F84A2b6d9c03e7a5102Be);

    function setUp() public {
        book = new FillBook();
        vm.deal(address(this), 10 ether);
        vm.warp(1_793_000_000);
    }

    function test_fillRecordsPayeeAndTimeAndPays() public {
        book.fill{value: 0.5 ether}(ORDER_KEY, RECIPIENT, PAYEE);
        bytes32 fillKey = keccak256(abi.encode(ORDER_KEY, RECIPIENT, uint256(0.5 ether)));
        assertEq(book.fills(fillKey), bytes32(uint256(uint160(PAYEE)) | (uint256(1_793_000_000) << 160)));
        assertEq(RECIPIENT.balance, 0.5 ether);
        // the record sits where the escrow will look for it
        assertEq(vm.load(address(book), book.slotOf(fillKey)), book.fills(fillKey));
    }

    /// T-21: a second correct fill reverts, so a late filler does not pay for nothing.
    function test_T21_secondFillReverts() public {
        book.fill{value: 0.5 ether}(ORDER_KEY, RECIPIENT, PAYEE);
        vm.expectRevert(bytes("FILLED"));
        book.fill{value: 0.5 ether}(ORDER_KEY, RECIPIENT, PAYEE);
    }

    /// A fill with the wrong amount writes another key and cannot block the real fill.
    function test_wrongAmountCannotBlockTheRealFill() public {
        book.fill{value: 0.4 ether}(ORDER_KEY, RECIPIENT, address(0xBAD));
        book.fill{value: 0.5 ether}(ORDER_KEY, RECIPIENT, PAYEE);
        assertEq(RECIPIENT.balance, 0.9 ether);
    }

    /// I-8: a failed transfer records nothing.
    function test_failedSendRecordsNothing() public {
        address payable refuser = payable(address(new Refuser()));
        vm.expectRevert(FillBook.SendFailed.selector);
        book.fill{value: 0.5 ether}(ORDER_KEY, refuser, PAYEE);
        assertEq(book.fills(keccak256(abi.encode(ORDER_KEY, refuser, uint256(0.5 ether)))), bytes32(0));
    }

    function test_zeroValueReverts() public {
        vm.expectRevert(FillBook.NoValue.selector);
        book.fill(ORDER_KEY, RECIPIENT, PAYEE);
    }
}
