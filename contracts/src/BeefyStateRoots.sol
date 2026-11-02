// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Blake2b} from "./lib/Blake2b.sol";
import {Mmr} from "./lib/Mmr.sol";

/// @title BeefyStateRoots
/// @notice Stores Portaldot V3 state roots that V3's own BEEFY validators signed. Anyone can import a block; nobody can
/// forge one. `stateRootOf` and `genesisHash` match BridgeZero's IFinalizedStateRoots, so other builds can read from it.
/// @dev importBlock checks, in order (prd.md §9.4):
///   1. the version-1 proof and its one payload item ("mh", 32-byte MMR root), block B and validator set id;
///   2. the set id never goes backwards;
///   3. both validators signed (bitfield 0xc0, set length 2) and each signature recovers to its authority;
///   4. blake2b-256(headerPrev) and its number B-1;
///   5. the MMR root rebuilt from the peaks at B-1 plus the leaf for B-1 equals the signed root;
/// then stores (hash(B-1) => state root of B-1). Trust: V3's two BEEFY keys (probably development keys) and V3 sudo.
contract BeefyStateRoots {
    error BadVersion();
    error BadPayload();
    error StaleSetId();
    error BadSetLength();
    error NotEnoughSignatures();
    error BadSigner();
    error HeaderMismatch();
    error MmrRootMismatch();
    error UnknownBlock();
    error BadKeyset();
    error NotOwner();

    struct Root {
        bytes32 stateRoot;
        uint32 number;
    }

    event Imported(uint32 indexed number, bytes32 indexed blockHash, bytes32 stateRoot, uint64 setId);
    event AuthoritiesUpdated(address[2] authorities, bytes32 keysetCommitment);

    // Fixed layout of a proof signed by exactly two validators with one "mh" payload item.
    uint256 private constant COMMITMENT_START = 1;
    uint256 private constant COMMITMENT_LEN = 48;
    uint256 private constant PROOF_LEN = 186; // 1 + 48 + 2 (bitfield) + 4 (set length) + 1 + 2 * 65

    bytes32 private immutable GENESIS;
    address public owner;
    address[2] public authorities;
    bytes32 public keysetCommitment;
    uint64 public lastSetId;
    mapping(bytes32 => Root) private roots;

    constructor(address[2] memory authorities_, bytes32 keysetCommitment_, bytes32 genesis_) {
        owner = msg.sender;
        GENESIS = genesis_;
        _setAuthorities(authorities_, keysetCommitment_);
    }

    /// @notice Verify a stored V3 justification for block B and record the state root of block B-1.
    /// @param justification the BEEFY proof, without its SCALE length prefix
    /// @param peaksAtPrev Mmr.Nodes at B-1, left to right (popcount(B-1) of them)
    /// @param headerPrev the SCALE-encoded header of B-1
    /// @return blockHash hash(B-1), the key for stateRootOf
    function importBlock(bytes calldata justification, bytes32[] calldata peaksAtPrev, bytes calldata headerPrev)
        external
        returns (bytes32 blockHash)
    {
        // 1. layout and payload
        if (justification.length == 0 || justification[0] != 0x01) revert BadVersion();
        if (justification.length < COMMITMENT_START + COMMITMENT_LEN) revert BadPayload();
        bytes calldata c = justification[COMMITMENT_START:COMMITMENT_START + COMMITMENT_LEN];
        if (c[0] != 0x04 || c[1] != 0x6d || c[2] != 0x68 || c[3] != 0x80) revert BadPayload(); // one item, "mh", 32 bytes
        bytes32 signedRoot = bytes32(c[4:36]);
        uint32 number = _u32(c[36:40]);
        uint64 setId = _u64(c[40:48]);

        // 2. set id
        if (setId < lastSetId) revert StaleSetId();

        // 3. signatures: bitfield, set length, two signatures from the two authorities in order
        if (justification.length != PROOF_LEN) revert NotEnoughSignatures();
        if (justification[49] != 0x04 || justification[50] != 0xc0) revert NotEnoughSignatures();
        if (_u32(justification[51:55]) != 2) revert BadSetLength();
        if (justification[55] != 0x08) revert NotEnoughSignatures();
        _checkSigners(justification, keccak256(c));

        // 4. header of B-1
        if (number == 0) revert HeaderMismatch();
        blockHash = Blake2b.hash256(headerPrev);
        (uint32 headerNumber, bytes32 stateRoot) = _parseHeader(headerPrev);
        if (headerNumber != number - 1) revert HeaderMismatch();

        // 5. newest-leaf MMR proof
        bytes32 root = Mmr.rootAfterAppend(peaksAtPrev, number - 1, Mmr.leaf(number - 1, blockHash));
        if (root != signedRoot) revert MmrRootMismatch();

        lastSetId = setId;
        if (roots[blockHash].stateRoot == bytes32(0)) {
            roots[blockHash] = Root(stateRoot, number - 1);
            emit Imported(number - 1, blockHash, stateRoot, setId);
        }
    }

    /// @notice The state root of an imported V3 block. Reverts UnknownBlock for blocks never imported.
    function stateRootOf(bytes32 blockHash) external view returns (bytes32 stateRoot, uint32 number) {
        Root memory r = roots[blockHash];
        if (r.stateRoot == bytes32(0)) revert UnknownBlock();
        return (r.stateRoot, r.number);
    }

    function genesisHash() external view returns (bytes32) {
        return GENESIS;
    }

    /// @notice Owner-set authority update (trusted, emits an event). Proving Beefy.NextAuthorities instead is P2.
    function setAuthorities(address[2] calldata authorities_, bytes32 keysetCommitment_) external {
        if (msg.sender != owner) revert NotOwner();
        _setAuthorities(authorities_, keysetCommitment_);
    }

    function _setAuthorities(address[2] memory a, bytes32 keyset) private {
        // MmrLeaf.BeefyAuthorities commits to keccak256(keccak256(addr0) ++ keccak256(addr1))
        bytes32 expected = keccak256(abi.encodePacked(keccak256(abi.encodePacked(a[0])), keccak256(abi.encodePacked(a[1]))));
        if (expected != keyset || a[0] == address(0) || a[0] == a[1]) revert BadKeyset();
        authorities = a;
        keysetCommitment = keyset;
        emit AuthoritiesUpdated(a, keyset);
    }

    /// @dev Each of the two 65-byte signatures (r, s, recovery id 0/1) must recover to the authority at its index.
    function _checkSigners(bytes calldata j, bytes32 message) private view {
        for (uint256 i = 0; i < 2; i++) {
            uint256 o = 56 + i * 65;
            uint8 v = uint8(j[o + 64]);
            if (v < 27) v += 27;
            address signer = ecrecover(message, v, bytes32(j[o:o + 32]), bytes32(j[o + 32:o + 64]));
            if (signer == address(0) || signer != authorities[i]) revert BadSigner();
        }
    }

    /// @dev parent_hash[32] ++ compact(number) ++ state_root[32] ++ ...
    function _parseHeader(bytes calldata h) private pure returns (uint32 number, bytes32 stateRoot) {
        if (h.length < 33) revert HeaderMismatch();
        uint8 b0 = uint8(h[32]);
        uint256 size;
        uint256 mode = b0 & 3;
        if (mode == 0) { number = b0 >> 2; size = 1; }
        else if (mode == 1) { number = uint32((uint16(b0) | uint16(uint8(h[33])) << 8) >> 2); size = 2; }
        else if (mode == 2) { number = _u32(h[32:36]) >> 2; size = 4; }
        else revert HeaderMismatch(); // block numbers above 2^30 do not occur
        if (h.length < 32 + size + 32) revert HeaderMismatch();
        stateRoot = bytes32(h[32 + size:64 + size]);
    }

    function _u32(bytes calldata b) private pure returns (uint32 v) {
        v = uint32(uint8(b[0])) | uint32(uint8(b[1])) << 8 | uint32(uint8(b[2])) << 16 | uint32(uint8(b[3])) << 24;
    }

    function _u64(bytes calldata b) private pure returns (uint64 v) {
        for (uint256 i = 0; i < 8; i++) v |= uint64(uint8(b[i])) << uint64(8 * i);
    }
}
