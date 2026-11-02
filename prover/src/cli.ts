#!/usr/bin/env -S npx tsx
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildImport, buildSlotProof, connect, findJustified, verifyImport, verifySlotProof } from './chain.ts';
import { checkSlot, claim, createOrder, deployFillBook, deploySepolia, fill, forgeClaim, importBlock, refund, trieIdOf } from './flow.ts';
import type { Address } from 'viem';

// talyx: build and check Portaldot V3 proofs against the public RPC. Usage: npm run talyx -- <command> [args]

const USAGE = `talyx <command>

  find-justified [--after <block>]        next block with a stored BEEF justification (latest if no --after)
  build-import <B> [--out <file>]         justification, peaks at B-1 and SCALE header B-1, as JSON
  verify-import <B>                       every importBlock check, off-chain
  prove-slot <contract> --at <block> [--key <hex>]
                                          Revive child-root and storage proofs at a block, checked
  spike [--contract <addr>]               the whole path on the latest justified block, saved to fixtures/

  deploy-fillbook                         deploy FillBook on V3; prints its trie id and code hash
  deploy-sepolia --fillbook <addr> [--window <s>]
                                          deploy BeefyStateRoots and TalyxEscrow (claim window, default 1800 s)
  trie-id <contract>                      Revive.AccountInfoOf: trie id and code hash
  create-order <recipient> <tPOT> <ETH> [--minutes <m>]
                                          post an order on Sepolia (deadline default 60 min)
  fill <orderId> [--payee <addr>]         pay an order on V3 through FillBook
  check-slot <orderId>                    the fill record under blake2_256(slot), as the escrow expects it
  import [<B>]                            import a signed block (default: the latest) into BeefyStateRoots
  claim <orderId>                         prove the fill under the latest signed block and pay the payee
  forge-claim <orderId> --tamper <what>   the same claim with payee, time, block or order:<id> changed, as eth_call
  refund <orderId>                        return an unfilled order's ETH after the deadline and claim window

Environment (prover/.env): TALYX_PRIVATE_KEY, TALYX_FILLBOOK, TALYX_STATE_ROOTS, TALYX_ESCROW,
TALYX_V3_WS, TALYX_V3_EVM_RPC, TALYX_SEPOLIA_RPC. See .env.example.`;

// IntentRegistry (RelayMesh), a live Revive contract with storage (prd.md A.5)
const SAMPLE_CONTRACT = '0xfcfc36e3ea951640d1e495a1e671d66c75eb5123';

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const json = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x), 2);

async function main() {
  const cmd = args[0];
  if (!cmd || cmd === 'help' || cmd === '--help') { console.log(USAGE); return; }
  const api = await connect();
  try {
    switch (cmd) {
      case 'find-justified': {
        const after = flag('after');
        console.log(await findJustified(api, { after: after ? Number(after) : undefined }));
        break;
      }
      case 'build-import': {
        const input = await buildImport(api, Number(args[1]));
        const out = flag('out');
        if (out) { writeFileSync(out, json(input)); console.log(`wrote ${out}`); } else console.log(json(input));
        break;
      }
      case 'verify-import': {
        const result = await verifyImport(await buildImport(api, Number(args[1])));
        console.log(json({ ok: true, ...result }));
        break;
      }
      case 'prove-slot': {
        const at = (await api.rpc.chain.getBlockHash(Number(flag('at')))).toHex();
        const header = await api.rpc.chain.getHeader(at);
        const proof = await buildSlotProof(api, args[1], at, flag('key'));
        console.log(json({ ...verifySlotProof(header.stateRoot.toHex(), proof), key: proof.key, trieId: proof.trieId }));
        break;
      }
      case 'spike': await spike(api, flag('contract') ?? SAMPLE_CONTRACT); break;
      case 'deploy-fillbook': await deployFillBook(api); break;
      case 'deploy-sepolia': await deploySepolia(api, (flag('fillbook') ?? process.env.TALYX_FILLBOOK) as Address, BigInt(flag('window') ?? 1800)); break;
      case 'trie-id': console.log(json(await trieIdOf(api, args[1]))); break;
      case 'create-order': await createOrder(args[1] as Address, args[2], args[3], Number(flag('minutes') ?? 60)); break;
      case 'fill': await fill(BigInt(args[1]), flag('payee') as Address | undefined); break;
      case 'check-slot': await checkSlot(api, BigInt(args[1])); break;
      case 'import': await importBlock(api, args[1] ? Number(args[1]) : await findJustified(api)); break;
      case 'claim': await claim(api, BigInt(args[1])); break;
      case 'forge-claim': await forgeClaim(api, BigInt(args[1]), flag('tamper') ?? 'payee'); break;
      case 'refund': await refund(BigInt(args[1])); break;
      default: console.error(`unknown command: ${cmd}\n\n${USAGE}`); process.exitCode = 2;
    }
  } finally {
    await api.disconnect();
  }
}

/** M1 in one run: signatures -> MMR root -> header -> state root -> contract child root -> storage item. */
async function spike(api: Awaited<ReturnType<typeof connect>>, contract: string) {
  const B = await findJustified(api);
  console.log(`justified block   ${B}`);
  const input = await buildImport(api, B);
  console.log(`peaks at ${B - 1}   ${input.peaksAtPrev.length}, header ${(input.headerPrev.length - 2) / 2} bytes`);
  const imported = await verifyImport(input);
  console.log(`signatures        2 of 2 BEEFY keys, set ${imported.setId}`);
  console.log(`mmr root          ${imported.mmrRoot} reproduced from peaks + newest leaf`);
  console.log(`state root ${imported.number}  ${imported.stateRoot}`);

  const slot = await buildSlotProof(api, contract, imported.blockHash);
  const proven = verifySlotProof(imported.stateRoot, slot);
  // compare raw bytes: polkadot.js prints StorageData with a SCALE length prefix (0x80 for 32 bytes) that is not in the trie
  const stored = await api.rpc.childstate.getStorage(
    `0x${Buffer.from(':child_storage:default:').toString('hex')}${slot.trieId.slice(2)}`, slot.key, imported.blockHash,
  );
  const direct = stored.isSome ? `0x${Buffer.from(stored.unwrap().toU8a(true)).toString('hex')}` : null;
  if (proven.value !== direct) throw new Error(`proof value ${proven.value} differs from the node's ${direct}`);
  console.log(`child root        ${proven.childRoot} (${contract})`);
  console.log(`storage item      ${slot.key.slice(0, 18)}… = ${proven.value}`);
  console.log('every step checked');

  mkdirSync('fixtures', { recursive: true });
  writeFileSync(`fixtures/import-${B}.json`, json({ captured: new Date().toISOString(), input, expect: imported }));
  writeFileSync(`fixtures/slot-${B - 1}.json`, json({ captured: new Date().toISOString(), stateRoot: imported.stateRoot, proof: slot, expect: proven }));
  console.log(`fixtures          fixtures/import-${B}.json, fixtures/slot-${B - 1}.json`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
