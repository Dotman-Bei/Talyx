# Portaldot V3: BEEFY, MMR and storage formats

Portaldot's official docs describe V1. This is what the V3 testnet (`portaldot-v3`, spec 3002, state version 1) does,
as Talyx relies on it. Every format here is checked on live data by `prover/` (`npm run talyx -- spike`) and replayed
in `contracts/test/` from captured fixtures.

## BEEFY justifications

- V3 has two BEEFY validators. Both must sign (more than two thirds of two). Their keys are in `Beefy.Authorities`
  as compressed secp256k1 keys; the Ethereum addresses are `0x4d13b6aea6cd423cc48d7159ac10b26927c2b421` and
  `0x4a69b8f722a9b486f9db0d243c908170012d7413`.
- `MmrLeaf.BeefyAuthorities` commits to them as `keccak256(keccak256(addr0) ++ keccak256(addr1))`
  = `0xc745b6c2eca708396dde733c7b93f344da8eee0eb435e68fac6a77bce9c1a7d5`.
- A justification is stored in `chain_getBlock(hash).justifications` under engine id `BEEF` (`0x42454546`), on one
  block in eight (about every 48 seconds). The phase of that cadence shifts, so scan rather than assume it. The RPC
  may return the bytes as hex or as a plain byte array.
- Layout, after an optional SCALE `Bytes` length prefix (186 bytes in total for two signers):

| Bytes | Field |
| --- | --- |
| `01` | version |
| `04` `6d68` `80` + 32 bytes | payload: one item, id `mh`, the 32-byte MMR root of block B |
| 4 bytes, little-endian | block number B |
| 8 bytes, little-endian | validator set id (it rises every session with the same two keys) |
| `04` `c0` | signature bitfield: both validators |
| `02000000` | validator set length |
| `08` + 2 × 65 bytes | signatures in bitfield order; byte 64 is the recovery id 0 or 1 (add 27 for `ecrecover`) |

- The signed message is `keccak256` of the 48 commitment bytes (payload, block number, set id).

## MMR (pallet_mmr)

- One leaf per block. The leaf added in block B commits to block B−1:
  `keccak256(u32le(B−1) ++ hash(B−1))`. The leaf count at block n is n.
- `Mmr.Nodes` (Identity-hashed `u64` positions, storage prefix
  `0xa8c65209d47ee80f56b0011e8fd91f50519dfc7fdad21b84f64a5310fa178ef2`) keeps only the peaks, readable at any past
  block on an archive node. The peaks of an MMR with n leaves are one per set bit of n, high to low; a peak of height h
  spans 2^(h+1) − 1 nodes, so its position is the running size minus one.
- Append a leaf: push it with height 0, then while the last two peaks have equal height, replace them with
  `keccak256(left ++ right)`.
- Bag the peaks into the root: start from the rightmost, `acc = keccak256(acc ++ peak)` moving left.
- `mmr_generateProof` fails on the public node (`LeafNotFound`: no offchain indexing). The newest-leaf method above
  needs no offchain data: take the peaks at B−1, append B's leaf, bag, compare with the root V3 signed for B.

## Headers

- `blake2b-256(SCALE(header))` is the block hash.
- SCALE layout: `parent_hash[32] ++ compact(number) ++ state_root[32] ++ extrinsics_root[32] ++ digest`, where the
  digest is `compact(count)` followed by each log as returned in `chain_getHeader(..).digest.logs`.

## Revive (EVM) contract storage

- `Revive.AccountInfoOf(h160)` holds the contract's `trie_id` and `code_hash`.
- The contract's storage is a child trie. Its root sits in the main trie under
  `":child_storage:default:" ++ trie_id`.
- A 32-byte Solidity slot `s` sits in that child trie under `blake2_256(s)`, stored as the **bare 32-byte word**.
  The `0x80` that polkadot.js prints in front of it is the SCALE length prefix of its `StorageData` type, not part of
  the stored value. Confirmed on the deployed FillBook: the child-trie value equals `fills(fillKey)` read through the
  EVM RPC (docs/EVIDENCE.md).
- Proofs come from `state_getReadProof([childKey], at)` and `state_getChildReadProof(childKey, [key], at)`: lists of
  trie nodes, hashed with blake2b-256, layout V1 (values of 33 bytes or more are stored by hash).

## Units

- tPOT has 14 decimals. Revive counts in 18 (`NativeToEthRatio` is 10,000), so `msg.value` and EVM balances are in
  18-decimal units, and amounts finer than 10⁴ of them cannot exist on V3.
- With `AutoMap`, a MetaMask address `0x…` is the account `0x… ++ 0xEE × 12` on the Substrate side; send native tPOT
  to that account's SS58 form to fund it.
