// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @notice Finalized Portaldot V3 state roots, the same interface BridgeZero's proof kit exposes.
interface IFinalizedStateRoots {
    /// @return stateRoot the state root of the block, number its height; reverts for blocks never imported
    function stateRootOf(bytes32 blockHash) external view returns (bytes32 stateRoot, uint32 number);
    function genesisHash() external view returns (bytes32);
}
