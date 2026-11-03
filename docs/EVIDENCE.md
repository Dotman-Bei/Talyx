# Testnet evidence

Every figure here comes from a transaction receipt or an `eth_call` against the public testnets, on 2 November 2026.
Sepolia transactions open on `https://sepolia.etherscan.io/tx/<hash>`. Portaldot V3 has no tx-hash search; look up
the block on `https://node-console.portaldot.dev`.

## Contracts

| Contract | Chain | Address | Deploy tx | Block |
| --- | --- | --- | --- | --- |
| FillBook | Portaldot V3 (420420777) | `0xbe86343e5c69f305b61680e142ada94fb4394068` | `0x53edee4d2fe159213a209ff55bb5b673030a2b3a33bee877effcff9f194a6c6e` | 293,226 |
| BeefyStateRoots | Sepolia | `0xbe86343e5c69f305b61680e142ada94fb4394068` | `0x976c648477d7b26152efd8d4096348dd4bf981194193d9be8ea4d37c50e05fe3` | 12,048,946 |
| TalyxEscrow | Sepolia | `0x908d8899795072985e35cb86da3aff88ce4e72e9` | `0x1727711b5dee27740e95c7337b7e8f1ce350de800d7ff03db9aea88ed67a6283` | 12,048,947 |

FillBook and BeefyStateRoots share an address because both were the deployer's first contract on its chain.
FillBook trie id `0x13cd5a49017997a0635348586915f609bb5a5e0b85acae8583dcc1ac4fe24d30`, code hash
`0x23b57059841d103537ac04e8e3a22f077596e0d51aed3f75925b5744cca05086` (`Revive.AccountInfoOf`).
BeefyStateRoots holds the two BEEFY authorities, keyset commitment `0xc745…a7d5` and V3 genesis `0xd4f9acbc…283bd`.

## Slot key reproduced on the deployed FillBook (prd.md DoD 21.3)

A 0.01 tPOT test fill under a dummy order key (V3 block 293,236, tx
`0xf002aa825c9dd09b30206b2551e25dd0230489484f8edd864ead27f89b951662`) is stored in FillBook's child trie under
`blake2_256(keccak256(abi.encode(fillKey, 0)))` as the bare 32-byte word, equal to `fills(fillKey)` read through the
EVM RPC. Proven off-chain and in `contracts/test/LiveFillBook.t.sol` under signed block 293,243.

## Orders

| Order | Step | Chain | Tx | Gas |
| --- | --- | --- | --- | --- |
| 1 | createOrder: 0.5 tPOT for 0.0001 ETH | Sepolia | `0x15b0eeffc39075c9df2293d44aa5bf1b5763f278cd2e25e214af0129b0f72db7` | 589,236 |
| 1 | fill, V3 block 293,346 | V3 | `0xd549b9ef2d1fe8874f36553f0f651bbee9830cbd463fdbf929823f09deb00351` | |
| 1 | importBlock (state root of 293,346) | Sepolia | `0x0ebcdc9f1e94f44ae444b41d609f5e11d3c6785ed01a5342af14829fbfed1bcb` | 296,148 |
| 1 | **claim, 0.0001 ETH to the recorded payee** | Sepolia | `0x9f93af028ed8e6ac8d87861816cabc7a83173c61f709266ee5adfbf172755e0c` | 488,319 |
| 2 | createOrder: 0.25 tPOT, 2-minute deadline, left unfilled | Sepolia | `0xae5d7e59cfc83623b50ebf1612b98821af6b7dddbd2fbd9c516081ec25b6c815` | 589,236 |
| 2 | **refund after deadline + 30-minute window, 0.00005 ETH back to the requester** | Sepolia | `0xaeaeb111dff311ee524061eb09ea5c82c5791834eb0aeb34f0986b687e1022ae` | 45,091 |
| 3 | createOrder: 0.5 tPOT for 0.0001 ETH | Sepolia | `0x86493b7de8b8d26e7f59550b63923779ba4fc9a4fa5be99e9d40c7e82f949609` | |
| 3 | fill, V3 block 293,378 | V3 | `0xd21b2202a57fff03428827b7acfe434953f9d277022284f847ad01cacdf1d6a6` | |
| 3 | importBlock (state root of 293,378) | Sepolia | `0x5ffecdfd55cf1ad1497faa428274251766e0d341fe4f865aec7cdcb223840ae3` | 292,436 |
| 3 | **claim** | Sepolia | `0xcd6ac878883e183d1344a550056fc58dc908cee61f6a02ba7c79220cd0da767c` | 489,845 |
| 4 | createOrder: 0.5 tPOT for 0.0001 ETH | Sepolia | `0xca0666c18bd4d8a22576f9cbb128c5613c2175a6c19e2d3b96a445cf9f26dedf` | |
| 4 | fill, V3 block 293,571 | V3 | `0x611ebacaad5814e95dcfea2b29aed5a19f0f23bef13865eb80edb7cc8ee1a770` | |
| 4 | importBlock (state root of 293,578) | Sepolia | `0x4fa65614fee33bc88d645c9b710796b4a295c105f2f20fb9ae69e4b42ee01b80` | 299,787 |
| 4 | **claim from the demo app in the browser, signed in MetaMask** (proof built in the browser, reusing the imported block) | Sepolia | `0x974a4e376c80f01a3ef57f844ea09dc445e260d828ae787cde7d7f8921c5ca06` | 492,167 |
| 5 | createOrder: 0.5 tPOT for 0.0001 ETH | Sepolia | `0x5f9bae4d98b58af023c6e180620f6e5bd0c2d10fd6b9366ef5773d0f1cd6fad8` | |
| 5 | **fill from a second, unrelated wallet** `0x6E25…5EA8`, V3 block 294,109 | V3 | `0x91d6c1d6044083eb79189fabfe6a55ba83af92b7b960fe31cea9f624530d733b` | |
| 5 | importBlock (state root of 294,114) | Sepolia | `0x6cf901be82aa0fce194da8097689d8a0444e808320ce7fa225dc0ff89b6f3c9f` | 296,112 |
| 5 | **claim submitted by the deployer, paid to the second wallet** (its Sepolia balance went from 0 to 0.0001 ETH) | Sepolia | `0xd0ecba07e4d782ec279f275530fafb67392adfdcaee52db6e8159cff9f498406` | 680,194 |

The second filler wallet `0x6E25E6F3822a7B1F9c33653dCc04f2D394B65EA8`
was created for this test and funded with 6 tPOT on V3 (tx
`0xcfd94b7fd2f352b669b11ffccadaba98e2a3d00291f33e17d89e28298349c4bc`, block 294,090); it never deployed anything.

Other imports: `0xe756236cb99a3b7a11574736bcc0566b69be379683eddca6da913f3542c42bcb` (first import, state root of
293,314, 406,522 gas), `0xd3fa0909ab53dab74c6fdf47cce42f948b255f3b5faaa372c0ce89947059aff2`,
`0x49ca35e9a331bbe7d44b6a1052329f492405aa9998da3f0fcd3ffa020314271b`.

## Forged claims (eth_call on Sepolia, order 3, before its real claim)

`npm run talyx -- forge-claim 3 --tamper <what>` sends the real proof with one thing changed.

| Tamper | prd.md case | Result |
| --- | --- | --- |
| none (the real proof) | | would succeed |
| another payee | T-3 | reverts `WordMismatch` |
| fill time minus one second | T-4 | reverts `WordMismatch` |
| the proof against order 2 (another recipient and amount, so another slot) | T-1, T-2 | reverts `SlotMismatch` |
| a block hash never imported | T-15 | reverts (BeefyStateRoots `UnknownBlock`; the tool now decodes it by name) |

## Time from fill to claim (prd.md DoD 21.8)

From the fill's V3 block timestamp (recorded in FillBook) to the Sepolia block that included the claim.

| Order | Fill (V3) | Signed block used | Claim (Sepolia) | Fill to claim | Note |
| --- | --- | --- | --- | --- | --- |
| 1 | #293,346, 15:13:12 UTC | #293,347, set 494 | #12,048,972, 15:14:24 UTC | **1 min 12 s** | claimed as soon as V3 signed the next block |
| 3 | #293,378, 15:16:24 UTC | #293,395, set 494 | #12,048,997, 15:19:24 UTC | 3 min 0 s | forged claims were run first |
| 5 | #294,109, 16:30:48 UTC | #294,115, set 495 | #12,049,361, 16:32:48 UTC | 2 min 0 s | second filler wallet |
| 4 | #293,571, 15:35:42 UTC | #294,115, set 495 | #12,054,720, 10:33:36 UTC next day | 18 h 58 min | left unclaimed on purpose for the browser test |

All times 2 November 2026 unless noted. The wait is bounded by V3's cadence of stored justifications (one in eight
blocks, about 48 s) plus one Sepolia block for the claim; the import can be in the same minute.

## Gas

Measured on Sepolia: `importBlock` 292,436 to 406,522; `claim` 488,319 to 680,194 (the claim proof grows with the
number of records in FillBook's storage: orders 1 and 3 against a nearly empty trie, order 5 against six records);
`refund` 45,091. For comparison, BridgeZero reports about 1.87M gas per GRANDPA header import (prd.md §15.1). Sepolia
charged more than a local Anvil chain for the same calldata (two imports there: 144,323 and 129,533), so the Sepolia
figures are the ones to quote.
