// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IFinalizedStateRoots} from "./IFinalizedStateRoots.sol";
import {Blake2b} from "./lib/Blake2b.sol";
import {Trie} from "./lib/Trie.sol";

/// @title TalyxEscrow (Sepolia)
/// @notice A requester locks ETH for tPOT delivered to an address on Portaldot V3. Any filler pays on V3 through
/// FillBook; the escrow pays the payee FillBook recorded, only when a storage proof under a BEEFY-verified V3 state root
/// shows the record. Unfilled orders are refunded after the deadline plus the claim window.
/// Trust: V3's two BEEFY keys (probably development keys) and V3 sudo, through BeefyStateRoots. Testnet only, unaudited.
contract TalyxEscrow {
    error BadAmount();
    error BadDeadline();
    error BadRecipient();
    error NoPrice();
    error NotOpen();
    error TooEarly();
    error ChildRootMismatch();
    error SlotMismatch();
    error WordMismatch();
    error FillTooLate();
    error SendFailed();
    error Reentered();

    enum Status { None, Open, Claimed, Refunded }

    struct Order {
        address requester;
        address v3Recipient;
        uint256 amountV3Wei; // 18-decimal EVM units on V3; 1 tPOT = 1e18
        uint256 price; // wei escrowed on Sepolia
        uint64 deadline; // the fill must be recorded on V3 at or before this time
        Status status;
    }

    event OrderCreated(uint256 indexed orderId, bytes32 indexed orderKey, address indexed requester, address v3Recipient, uint256 amountV3Wei, uint256 price, uint64 deadline);
    event Claimed(uint256 indexed orderId, address indexed payee, uint64 fillTimestamp, bytes32 blockHash);
    event Refunded(uint256 indexed orderId);

    /// tPOT has 14 decimals, Revive counts in 18: amounts finer than 1e4 cannot exist on V3 (prd.md P-15)
    uint256 public constant UNIT = 1e4;

    IFinalizedStateRoots public immutable stateRoots;
    address public immutable fillBook;
    /// ":child_storage:default:" ++ FillBook's trie id, from Revive.AccountInfoOf(fillBook)
    bytes public childStorageKey;
    uint256 public immutable claimWindow;

    uint256 public nextOrderId = 1;
    mapping(uint256 => Order) public orders;
    uint256 private locked = 1;

    constructor(IFinalizedStateRoots stateRoots_, address fillBook_, bytes32 fillBookTrieId, uint256 claimWindow_) {
        stateRoots = stateRoots_;
        fillBook = fillBook_;
        childStorageKey = abi.encodePacked(":child_storage:default:", fillBookTrieId);
        claimWindow = claimWindow_;
    }

    modifier nonReentrant() {
        if (locked != 1) revert Reentered();
        locked = 2;
        _;
        locked = 1;
    }

    /// @notice Lock msg.value for `amountV3Wei` delivered to `v3Recipient` on V3 by `deadline`.
    function createOrder(address v3Recipient, uint256 amountV3Wei, uint64 deadline) external payable returns (uint256 orderId) {
        if (v3Recipient == address(0)) revert BadRecipient();
        if (amountV3Wei == 0 || amountV3Wei % UNIT != 0) revert BadAmount();
        if (deadline <= block.timestamp) revert BadDeadline();
        if (msg.value == 0) revert NoPrice();
        orderId = nextOrderId++;
        orders[orderId] = Order(msg.sender, v3Recipient, amountV3Wei, msg.value, deadline, Status.Open);
        emit OrderCreated(orderId, orderKey(orderId), msg.sender, v3Recipient, amountV3Wei, msg.value, deadline);
    }

    /// @notice Pay the payee FillBook recorded for this order. Anyone can submit the proof; only the payee is paid.
    /// @param blockHash a V3 block whose state root BeefyStateRoots has imported, at or after the fill
    /// @param childRootProof main-trie proof of childStorageKey (FillBook's child root)
    /// @param slotProof child-trie proof of blake2_256(slot of the fill record)
    function claim(
        uint256 orderId,
        address payee,
        uint64 fillTimestamp,
        bytes32 blockHash,
        bytes[] calldata childRootProof,
        bytes[] calldata slotProof
    ) external nonReentrant {
        Order storage o = orders[orderId];
        if (o.status != Status.Open) revert NotOpen();

        (bytes32 stateRoot,) = stateRoots.stateRootOf(blockHash); // reverts for blocks never imported

        (bool hasChild, bytes memory childRoot) = Trie.read(stateRoot, childRootProof, childStorageKey);
        if (!hasChild || childRoot.length != 32) revert ChildRootMismatch();

        bytes32 key = Blake2b.hash256(abi.encodePacked(fillSlot(orderId, o.v3Recipient, o.amountV3Wei)));
        (bool hasFill, bytes memory word) = Trie.read(bytes32(childRoot), slotProof, abi.encodePacked(key));
        if (!hasFill || word.length != 32) revert SlotMismatch(); // another recipient, amount or order: another slot

        // a full slot is stored as the bare 32-byte word (no SCALE length prefix)
        if (bytes32(word) != bytes32(uint256(uint160(payee)) | (uint256(fillTimestamp) << 160))) revert WordMismatch();
        if (fillTimestamp > o.deadline) revert FillTooLate();

        o.status = Status.Claimed;
        emit Claimed(orderId, payee, fillTimestamp, blockHash);
        (bool ok,) = payee.call{value: o.price}("");
        if (!ok) revert SendFailed();
    }

    /// @notice Return the ETH of an unfilled order to its requester, after the deadline plus the claim window.
    function refund(uint256 orderId) external nonReentrant {
        Order storage o = orders[orderId];
        if (o.status != Status.Open) revert NotOpen();
        if (block.timestamp <= uint256(o.deadline) + claimWindow) revert TooEarly();
        o.status = Status.Refunded;
        emit Refunded(orderId);
        (bool ok,) = o.requester.call{value: o.price}("");
        if (!ok) revert SendFailed();
    }

    /// @notice Bound to this chain and this escrow, so other chains and escrows produce other keys (I-6).
    function orderKey(uint256 orderId) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), orderId));
    }

    /// @notice The FillBook storage slot that records a correct fill of this order.
    function fillSlot(uint256 orderId, address recipient, uint256 amountV3Wei) public view returns (bytes32) {
        bytes32 fillKey = keccak256(abi.encode(orderKey(orderId), recipient, amountV3Wei));
        return keccak256(abi.encode(fillKey, uint256(0)));
    }
}
