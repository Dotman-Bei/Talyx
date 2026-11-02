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

## Gas

Measured on Sepolia: `importBlock` 292,436 to 406,522; `claim` 488,319 and 489,845. For comparison, BridgeZero reports
about 1.87M gas per GRANDPA header import (prd.md §15.1). Sepolia charged more than a local Anvil chain for the same
calldata (two imports there: 144,323 and 129,533), so the Sepolia figures are the ones to quote.

## Still to record

- Fills from a second, unrelated filler wallet (prd.md DoD 21.4).
