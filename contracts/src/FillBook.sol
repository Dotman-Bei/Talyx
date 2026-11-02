// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @title FillBook (Portaldot V3, Revive EVM)
/// @notice A filler pays an order's recipient through this contract, which records who filled it in the same call.
/// TalyxEscrow on Sepolia pays the recorded payee only once V3's BEEFY proof shows this record in a signed block.
/// @dev fills lives in slot 0, so the record for fillKey is at keccak256(abi.encode(fillKey, 0)); Revive stores it in
/// the contract's child trie under blake2_256 of that slot, as the bare 32-byte word.
contract FillBook {
    error NoValue();
    error SendFailed();

    /// fillKey => payee | fillTimestamp << 160
    mapping(bytes32 => bytes32) public fills;

    event Filled(bytes32 indexed orderKey, address indexed recipient, uint256 amount, address indexed payee, uint256 timestamp);

    /// @param orderKey keccak256(abi.encode(11155111, escrow, orderId)) of the Sepolia order
    /// @param recipient the order's V3 recipient
    /// @param payee the Sepolia address the escrow will pay
    /// @dev Keyed by (orderKey, recipient, amount), so a fill with the wrong recipient or amount writes a different key
    /// and cannot block the real one. A second correct fill reverts, so a late filler does not pay for nothing.
    function fill(bytes32 orderKey, address payable recipient, address payee) external payable {
        if (msg.value == 0) revert NoValue();
        bytes32 fillKey = keccak256(abi.encode(orderKey, recipient, msg.value));
        require(fills[fillKey] == bytes32(0), "FILLED");
        fills[fillKey] = bytes32(uint256(uint160(payee)) | (uint256(uint64(block.timestamp)) << 160));
        (bool ok,) = recipient.call{value: msg.value}("");
        if (!ok) revert SendFailed();
        emit Filled(orderKey, recipient, msg.value, payee, block.timestamp);
    }

    /// @notice The storage slot of a fill record, for building proofs.
    function slotOf(bytes32 fillKey) external pure returns (bytes32) {
        return keccak256(abi.encode(fillKey, uint256(0)));
    }
}
