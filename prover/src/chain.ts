import { ApiPromise, WsProvider } from '@polkadot/api';
import { stringToU8a } from '@polkadot/util';
import { BEEF, checkSignatures, decodeJustification, mmrRootOf } from './beefy.ts';
import { Reader, concatBytes, equalBytes, fromHex, toHex, type Bytes } from './bytes.ts';
import { AUTHORITIES, CHILD_STORAGE_PREFIX, V3_WS } from './config.ts';
import { appendLeaf, bagPeaks, leafHash, peakPositions } from './mmr.ts';
import { blake2_256, readProof } from './trie.ts';

export async function connect(url = V3_WS): Promise<ApiPromise> {
  return ApiPromise.create({ provider: new WsProvider(url), noInitWarn: true });
}

const hashOf = async (api: ApiPromise, n: number) => (await api.rpc.chain.getBlockHash(n)).toHex();

/** The stored BEEFY justification of block n, or null when the block has none. */
export async function justificationAt(api: ApiPromise, n: number): Promise<Bytes | null> {
  const signed = await api.rpc.chain.getBlock(await hashOf(api, n));
  const list = signed.justifications.unwrapOr(null);
  if (!list) return null;
  for (const [engine, data] of list) if (engine.toHex() === BEEF) return data.toU8a(true);
  return null;
}

/** Scan for the next block with a stored justification. Never assumes the 8-block cadence: its phase shifts. */
export async function findJustified(api: ApiPromise, opts: { after?: number } = {}): Promise<number> {
  const finalized = (await api.rpc.chain.getHeader(await api.rpc.chain.getFinalizedHead())).number.toNumber();
  if (opts.after === undefined) {
    for (let n = finalized; n > finalized - 32; n--) if (await justificationAt(api, n)) return n;
    throw new Error(`no stored justification in the 32 blocks up to ${finalized}`);
  }
  for (let n = opts.after + 1; n <= finalized; n++) if (await justificationAt(api, n)) return n;
  throw new Error(`no stored justification after ${opts.after} yet (finalized: ${finalized}); try again in a minute`);
}

/** SCALE header: parent_hash[32] ++ compact(number) ++ state_root[32] ++ extrinsics_root[32] ++ digest. */
export function parseHeader(b: Bytes) {
  const r = new Reader(b);
  const parentHash = r.take(32).slice();
  const number = r.compact();
  const stateRoot = r.take(32).slice();
  return { parentHash, number, stateRoot, hash: blake2_256(b) };
}

export interface ImportInput {
  block: number; // B, the justified block
  justification: string; // hex, without the Bytes prefix
  peaksAtPrev: string[]; // Mmr.Nodes at B-1, left to right
  headerPrev: string; // SCALE header of B-1
}

/** Everything BeefyStateRoots.importBlock(justification, peaksAtPrev, headerPrev) takes, read from the node. */
export async function buildImport(api: ApiPromise, B: number): Promise<ImportInput> {
  const j = await justificationAt(api, B);
  if (!j) throw new Error(`block ${B} has no stored BEEFY justification`);
  const prevHash = await hashOf(api, B - 1);
  const header = await api.rpc.chain.getHeader(prevHash);
  const at = await api.at(prevHash);
  const leaves = Number((await at.query.mmr.numberOfLeaves()).toString());
  if (leaves !== B - 1) throw new Error(`leaf count at ${B - 1} is ${leaves}; this prover assumes one leaf per block`);
  const peaks: string[] = [];
  for (const pos of peakPositions(leaves)) {
    const node = (await at.query.mmr.nodes(pos)) as unknown as { isSome: boolean; unwrap: () => { toHex: () => string } };
    if (!node.isSome) throw new Error(`Mmr.Nodes(${pos}) is empty at ${B - 1}`);
    peaks.push(node.unwrap().toHex());
  }
  return { block: B, justification: toHex(j), peaksAtPrev: peaks, headerPrev: toHex(header.toU8a()) };
}

export interface ImportResult { number: number; blockHash: string; stateRoot: string; setId: bigint; mmrRoot: string }

/** The same checks importBlock makes, in the same order, throwing the contract's error names. */
export async function verifyImport(input: ImportInput, authorities = AUTHORITIES): Promise<ImportResult> {
  const j = decodeJustification(fromHex(input.justification));
  const signedRoot = mmrRootOf(j.commitment);
  const B = j.commitment.blockNumber;
  await checkSignatures(j, authorities);

  const header = parseHeader(fromHex(input.headerPrev));
  if (header.number !== B - 1) throw new Error('HeaderMismatch');

  const leaf = leafHash(B - 1, header.hash);
  const peaks = appendLeaf(input.peaksAtPrev.map(fromHex), B - 1, leaf);
  if (!equalBytes(bagPeaks(peaks), signedRoot)) throw new Error('MmrRootMismatch');

  return { number: B - 1, blockHash: toHex(header.hash), stateRoot: toHex(header.stateRoot), setId: j.commitment.setId, mmrRoot: toHex(signedRoot) };
}

export interface SlotProofInput {
  contract: string;
  at: string; // block hash whose state root the proof is against
  trieId: string;
  key: string; // child trie key, blake2_256(slot)
  mainProof: string[];
  childProof: string[];
}

/** A Revive contract's child root, proven in the main trie, and one storage item, proven in the child trie. */
export async function buildSlotProof(api: ApiPromise, contract: string, at: string, key?: string): Promise<SlotProofInput> {
  const apiAt = await api.at(at);
  const info = (await apiAt.query.revive.accountInfoOf(contract)).toJSON() as Record<string, unknown> | null;
  const trieId = findField(info, 'trieId');
  if (!trieId) throw new Error(`${contract} is not a Revive contract (no trie id in AccountInfoOf)`);
  const childKey = concatBytes(stringToU8a(CHILD_STORAGE_PREFIX), fromHex(trieId));

  if (!key) {
    const keys = await api.rpc.childstate.getKeysPaged(toHex(childKey), '0x', 1, null, at);
    if (!keys.length) throw new Error(`${contract} has no storage items`);
    key = keys[0].toHex();
  }
  const main = await api.rpc.state.getReadProof([toHex(childKey)], at);
  const child = await api.rpc.state.getChildReadProof(toHex(childKey), [key], at);
  return {
    contract, at, trieId, key,
    mainProof: main.proof.map((p) => p.toHex()),
    childProof: child.proof.map((p) => p.toHex()),
  };
}

/** Walk both proofs against a state root. Returns the raw stored value (SCALE Vec<u8>, 0x80 ++ word for a full slot). */
export function verifySlotProof(stateRoot: string, p: SlotProofInput): { childRoot: string; value: string | null } {
  const childKey = concatBytes(stringToU8a(CHILD_STORAGE_PREFIX), fromHex(p.trieId));
  const childRoot = readProof(fromHex(stateRoot), p.mainProof.map(fromHex), childKey);
  if (!childRoot || childRoot.length !== 32) throw new Error('ChildRootMismatch');
  const value = readProof(childRoot, p.childProof.map(fromHex), fromHex(p.key));
  return { childRoot: toHex(childRoot), value: value ? toHex(value) : null };
}

function findField(o: unknown, name: string): string | undefined {
  if (!o || typeof o !== 'object') return undefined;
  for (const [k, v] of Object.entries(o)) {
    if (k === name && typeof v === 'string') return v;
    const inner = findField(v, name);
    if (inner) return inner;
  }
  return undefined;
}
