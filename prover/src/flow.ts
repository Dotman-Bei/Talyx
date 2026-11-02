import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { BaseError, ContractFunctionRevertedError, parseEther, parseUnits, type Address, type Hex } from 'viem';
import type { ApiPromise } from '@polkadot/api';
import { stringToU8a } from '@polkadot/util';
import { buildImport, buildSlotProof, findJustified, verifyImport, verifySlotProof } from './chain.ts';
import { AUTHORITIES, CHILD_STORAGE_PREFIX, KEYSET_COMMITMENT } from './config.ts';
import { concatBytes, fromHex, toHex } from './bytes.ts';
import { blake2_256 } from './trie.ts';
import { addressFromEnv, artifact, readOrder, sepoliaPublic, sepoliaWallet, v3Public, v3Wallet } from './evm.ts';

// The order lifecycle against the deployed contracts: deploy, fill on V3, import a signed block, claim, refund.

const DEPLOYMENTS = new URL('../../deployments/testnet.json', import.meta.url);
const log = (label: string, value: unknown) => console.log(`${label.padEnd(18)}${value}`);

function record(patch: Record<string, unknown>) {
  let current: Record<string, unknown> = {};
  try { current = JSON.parse(readFileSync(DEPLOYMENTS, 'utf8')); } catch { /* first deployment */ }
  mkdirSync(new URL('.', DEPLOYMENTS), { recursive: true });
  writeFileSync(DEPLOYMENTS, JSON.stringify({ ...current, ...patch }, null, 2) + '\n');
}

/** Revive.AccountInfoOf(contract): the child trie id and code hash that bind FillBook to its storage. */
export async function trieIdOf(api: ApiPromise, contract: string): Promise<{ trieId: Hex; codeHash: Hex }> {
  const info = JSON.stringify((await api.query.revive.accountInfoOf(contract)).toJSON());
  const trieId = info.match(/"trieId":"(0x[0-9a-f]+)"/)?.[1];
  const codeHash = info.match(/"codeHash":"(0x[0-9a-f]+)"/)?.[1];
  if (!trieId || !codeHash) throw new Error(`${contract} is not a Revive contract yet (no AccountInfoOf entry)`);
  return { trieId: trieId as Hex, codeHash: codeHash as Hex };
}

export async function deployFillBook(api: ApiPromise) {
  const { abi, bytecode } = artifact('FillBook');
  const wallet = v3Wallet();
  const hash = await wallet.deployContract({ abi, bytecode });
  log('deploy tx (V3)', hash);
  const receipt = await v3Public.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) throw new Error('no contract address in the receipt');
  const { trieId, codeHash } = await trieIdOf(api, receipt.contractAddress);
  log('FillBook', receipt.contractAddress);
  log('V3 block', receipt.blockNumber);
  log('trie id', trieId);
  log('code hash', codeHash);
  record({ fillBook: { address: receipt.contractAddress, tx: hash, block: Number(receipt.blockNumber), trieId, codeHash, deployer: wallet.account.address } });
}

export async function deploySepolia(api: ApiPromise, fillBook: Address, claimWindow: bigint) {
  const { trieId } = await trieIdOf(api, fillBook);
  const genesis = (await api.rpc.chain.getBlockHash(0)).toHex();
  const wallet = sepoliaWallet();

  const roots = artifact('BeefyStateRoots');
  const rootsTx = await wallet.deployContract({ abi: roots.abi, bytecode: roots.bytecode, args: [AUTHORITIES, KEYSET_COMMITMENT, genesis] });
  const rootsReceipt = await sepoliaPublic.waitForTransactionReceipt({ hash: rootsTx });
  log('BeefyStateRoots', `${rootsReceipt.contractAddress} (tx ${rootsTx})`);

  const escrow = artifact('TalyxEscrow');
  const escrowTx = await wallet.deployContract({ abi: escrow.abi, bytecode: escrow.bytecode, args: [rootsReceipt.contractAddress, fillBook, trieId, claimWindow] });
  const escrowReceipt = await sepoliaPublic.waitForTransactionReceipt({ hash: escrowTx });
  log('TalyxEscrow', `${escrowReceipt.contractAddress} (tx ${escrowTx})`);

  record({
    beefyStateRoots: { address: rootsReceipt.contractAddress, tx: rootsTx, block: Number(rootsReceipt.blockNumber), genesis, authorities: AUTHORITIES, keysetCommitment: KEYSET_COMMITMENT },
    talyxEscrow: { address: escrowReceipt.contractAddress, tx: escrowTx, block: Number(escrowReceipt.blockNumber), fillBook, trieId, claimWindow: Number(claimWindow) },
  });
  console.log('\nset TALYX_STATE_ROOTS, TALYX_ESCROW and TALYX_FILLBOOK in prover/.env, and the VITE_* addresses in web/.env');
}

/** Post an order on Sepolia: deliver `amount` tPOT to `recipient` on V3 within `minutes`, escrowing `priceEth`. */
export async function createOrder(recipient: Address, amount: string, priceEth: string, minutes: number) {
  const escrow = addressFromEnv('TALYX_ESCROW');
  const wallet = sepoliaWallet();
  const amountV3Wei = parseUnits(amount, 18);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + minutes * 60);
  const { abi } = artifact('TalyxEscrow');
  const { request, result } = await sepoliaPublic.simulateContract({
    account: wallet.account, address: escrow, abi, functionName: 'createOrder', args: [recipient, amountV3Wei, deadline], value: parseEther(priceEth),
  });
  const hash = await wallet.writeContract(request);
  const receipt = await sepoliaPublic.waitForTransactionReceipt({ hash });
  log('order', result);
  log('create tx', hash);
  log('gas used', receipt.gasUsed);
  log('deliver', `${amount} tPOT to ${recipient} on V3 by ${new Date(Number(deadline) * 1000).toISOString()}`);
  log('escrowed', `${priceEth} ETH`);
}

/** Pay an order on V3 through FillBook. The payee defaults to the filler's own address. */
export async function fill(orderId: bigint, payee?: Address) {
  const escrow = addressFromEnv('TALYX_ESCROW');
  const fillBook = addressFromEnv('TALYX_FILLBOOK');
  const order = await readOrder(escrow, orderId);
  if (order.status !== 1) throw new Error(`order ${orderId} is not open`);
  const orderKey = (await sepoliaPublic.readContract({ address: escrow, abi: artifact('TalyxEscrow').abi, functionName: 'orderKey', args: [orderId] })) as Hex;
  const wallet = v3Wallet();
  const hash = await wallet.writeContract({
    address: fillBook, abi: artifact('FillBook').abi, functionName: 'fill',
    args: [orderKey, order.v3Recipient, payee ?? wallet.account.address], value: order.amountV3Wei,
  });
  const receipt = await v3Public.waitForTransactionReceipt({ hash });
  log('fill tx (V3)', hash);
  log('V3 block', receipt.blockNumber);
  log('sent', `${Number(order.amountV3Wei) / 1e18} tPOT to ${order.v3Recipient}`);
  log('payee', payee ?? wallet.account.address);
}

/**
 * prd.md DoD 21.3: the Revive child key blake2_256(keccak256(abi.encode(fillKey, 0))) and its value, reproduced
 * against the deployed FillBook, and compared with FillBook.fills() read through the EVM RPC.
 */
export async function checkSlot(api: ApiPromise, orderId: bigint) {
  const escrow = addressFromEnv('TALYX_ESCROW');
  const fillBook = addressFromEnv('TALYX_FILLBOOK');
  const order = await readOrder(escrow, orderId);
  const slot = (await sepoliaPublic.readContract({
    address: escrow, abi: artifact('TalyxEscrow').abi, functionName: 'fillSlot', args: [orderId, order.v3Recipient, order.amountV3Wei],
  })) as Hex;
  const key = toHex(blake2_256(fromHex(slot)));
  const { trieId } = await trieIdOf(api, fillBook);
  const childKey = toHex(concatBytes(stringToU8a(CHILD_STORAGE_PREFIX), fromHex(trieId)));
  const stored = await api.rpc.childstate.getStorage(childKey, key);
  const raw = stored.isSome ? toHex(stored.unwrap().toU8a(true)) : null;
  const viaEvm = (await v3Public.getStorageAt({ address: fillBook, slot })) ?? null;
  log('slot', slot);
  log('child key', key);
  log('stored (raw)', raw ?? 'absent');
  log('FillBook slot', viaEvm ?? 'absent');
  if (!raw) throw new Error('no record under blake2_256(slot): either the order is not filled yet or the key scheme differs');
  if (raw.length !== 66) throw new Error(`expected a bare 32-byte word, got ${(raw.length - 2) / 2} bytes`);
  if (viaEvm && viaEvm.toLowerCase() !== raw.toLowerCase()) throw new Error('the child-trie value and the EVM slot differ');
  log('result', 'the slot key and value scheme match the escrow');
}

/** Import the stored justification of block B into BeefyStateRoots, after checking it off-chain. */
export async function importBlock(api: ApiPromise, B: number) {
  const input = await buildImport(api, B);
  const expected = await verifyImport(input);
  const roots = addressFromEnv('TALYX_STATE_ROOTS');
  const { abi } = artifact('BeefyStateRoots');
  const already = await sepoliaPublic.readContract({ address: roots, abi, functionName: 'stateRootOf', args: [expected.blockHash] }).then(() => true, () => false);
  if (already) { log('already imported', `${expected.number} (${expected.blockHash})`); return expected; }
  const wallet = sepoliaWallet();
  const hash = await wallet.writeContract({ address: roots, abi, functionName: 'importBlock', args: [input.justification, input.peaksAtPrev, input.headerPrev] });
  const receipt = await sepoliaPublic.waitForTransactionReceipt({ hash });
  log('import tx', hash);
  log('gas used', receipt.gasUsed);
  log('state root of', `${expected.number} ${expected.stateRoot}`);
  return expected;
}

interface ClaimArgs { orderId: bigint; payee: Address; fillTimestamp: bigint; blockHash: Hex; childRootProof: Hex[]; slotProof: Hex[] }

/** Build claim arguments against the newest signed block, importing it first when needed. */
async function buildClaim(api: ApiPromise, orderId: bigint): Promise<ClaimArgs> {
  const escrow = addressFromEnv('TALYX_ESCROW');
  const fillBook = addressFromEnv('TALYX_FILLBOOK');
  const order = await readOrder(escrow, orderId);
  const slot = (await sepoliaPublic.readContract({
    address: escrow, abi: artifact('TalyxEscrow').abi, functionName: 'fillSlot', args: [orderId, order.v3Recipient, order.amountV3Wei],
  })) as Hex;
  const B = await findJustified(api); // state is cumulative: any signed block after the fill holds the record
  const imported = await importBlock(api, B);
  const proof = await buildSlotProof(api, fillBook, imported.blockHash, toHex(blake2_256(fromHex(slot))));
  const { value } = verifySlotProof(imported.stateRoot, proof);
  if (!value) throw new Error(`order ${orderId} has no fill record at block ${imported.number}: not filled yet, or the fill is newer than the last signed block`);
  const word = BigInt(value);
  return {
    orderId,
    payee: `0x${(word & ((1n << 160n) - 1n)).toString(16).padStart(40, '0')}` as Address,
    fillTimestamp: word >> 160n,
    blockHash: imported.blockHash as Hex,
    childRootProof: proof.mainProof as Hex[],
    slotProof: proof.childProof as Hex[],
  };
}

const claimCall = (a: ClaimArgs) => [a.orderId, a.payee, a.fillTimestamp, a.blockHash, a.childRootProof, a.slotProof] as const;

export async function claim(api: ApiPromise, orderId: bigint) {
  const a = await buildClaim(api, orderId);
  const escrow = addressFromEnv('TALYX_ESCROW');
  const wallet = sepoliaWallet();
  const { request } = await sepoliaPublic.simulateContract({ account: wallet.account, address: escrow, abi: artifact('TalyxEscrow').abi, functionName: 'claim', args: claimCall(a) });
  const hash = await wallet.writeContract(request);
  const receipt = await sepoliaPublic.waitForTransactionReceipt({ hash });
  log('claim tx', hash);
  log('gas used', receipt.gasUsed);
  log('paid', a.payee);
}

/** The demo's forged proof: the real claim with one thing changed, sent as eth_call, so it costs nothing. */
export async function forgeClaim(api: ApiPromise, orderId: bigint, tamper: string) {
  const real = await buildClaim(api, orderId);
  const forged = { ...real };
  if (tamper === 'payee') forged.payee = `0x${'00'.repeat(19)}01`;
  else if (tamper === 'time') forged.fillTimestamp = real.fillTimestamp - 1n;
  else if (tamper === 'block') forged.blockHash = toHex(blake2_256(fromHex(real.blockHash))) as Hex;
  else if (tamper.startsWith('order:')) forged.orderId = BigInt(tamper.slice(6)); // another order: another recipient or amount, another slot
  else throw new Error('tamper with payee, time, block or order:<id>');
  for (const [label, args] of [['real proof', real], [`forged (${tamper})`, forged]] as const) {
    try {
      // the escrow's ABI plus BeefyStateRoots' errors, so a revert from stateRootOf (UnknownBlock) decodes by name
      const abi = [...artifact('TalyxEscrow').abi, ...artifact('BeefyStateRoots').abi.filter((x) => x.type === 'error')];
      await sepoliaPublic.simulateContract({ address: addressFromEnv('TALYX_ESCROW'), abi, functionName: 'claim', args: claimCall(args) });
      log(label, 'would succeed');
    } catch (e) {
      const revert = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
      log(label, `reverts: ${revert instanceof ContractFunctionRevertedError ? revert.data?.errorName ?? revert.shortMessage : (e as Error).message}`);
    }
  }
}

export async function refund(orderId: bigint) {
  const escrow = addressFromEnv('TALYX_ESCROW');
  const wallet = sepoliaWallet();
  const hash = await wallet.writeContract({ address: escrow, abi: artifact('TalyxEscrow').abi, functionName: 'refund', args: [orderId] });
  const receipt = await sepoliaPublic.waitForTransactionReceipt({ hash });
  log('refund tx', hash);
  log('gas used', receipt.gasUsed);
}
