import { blake2b } from '@noble/hashes/blake2.js';
import {
  BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient, custom, defineChain, encodeAbiParameters,
  http, keccak256, parseAbi, toHex, type Address, type Hex,
} from 'viem';
import { sepolia } from 'viem/chains';
import { hexToBytes } from '../shared/beefy';
import { v3Call } from './v3';

// The deployed contracts, read and written from the browser: Sepolia (TalyxEscrow, BeefyStateRoots) through a public
// RPC and MetaMask, Portaldot V3 (FillBook) through its EVM RPC and MetaMask, and V3's Substrate RPC for proofs.

export const ADDR = {
  escrow: import.meta.env.VITE_ESCROW_ADDRESS as Address,
  stateRoots: import.meta.env.VITE_STATE_ROOTS_ADDRESS as Address,
  fillBook: import.meta.env.VITE_FILLBOOK_ADDRESS as Address,
};
// where the event scans start: the deployment blocks (deployments/testnet.json)
const ESCROW_FROM = BigInt(import.meta.env.VITE_ESCROW_BLOCK ?? 0);
const FILLBOOK_FROM = BigInt(import.meta.env.VITE_FILLBOOK_BLOCK ?? 0);

export const v3Chain = defineChain({
  id: 420420777,
  name: 'Portaldot V3 testnet',
  nativeCurrency: { name: 'tPOT', symbol: 'tPOT', decimals: 18 },
  rpcUrls: { default: { http: [import.meta.env.VITE_V3_EVM_RPC || 'https://test-evm-rpc-v3.portaldot.dev'] } },
});
const SEPOLIA_RPC = import.meta.env.VITE_SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com';
export const sepoliaClient = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC) });
export const v3Client = createPublicClient({ chain: v3Chain, transport: http() });

export const escrowAbi = parseAbi([
  'function createOrder(address v3Recipient, uint256 amountV3Wei, uint64 deadline) payable returns (uint256)',
  'function claim(uint256 orderId, address payee, uint64 fillTimestamp, bytes32 blockHash, bytes[] childRootProof, bytes[] slotProof)',
  'function refund(uint256 orderId)',
  'function orders(uint256) view returns (address requester, address v3Recipient, uint256 amountV3Wei, uint256 price, uint64 deadline, uint8 status)',
  'function orderKey(uint256 orderId) view returns (bytes32)',
  'function fillSlot(uint256 orderId, address recipient, uint256 amountV3Wei) view returns (bytes32)',
  'function childStorageKey() view returns (bytes)',
  'event OrderCreated(uint256 indexed orderId, bytes32 indexed orderKey, address indexed requester, address v3Recipient, uint256 amountV3Wei, uint256 price, uint64 deadline)',
  'event Claimed(uint256 indexed orderId, address indexed payee, uint64 fillTimestamp, bytes32 blockHash)',
  'event Refunded(uint256 indexed orderId)',
  'error BadAmount()', 'error BadDeadline()', 'error BadRecipient()', 'error NoPrice()', 'error NotOpen()', 'error TooEarly()',
  'error ChildRootMismatch()', 'error SlotMismatch()', 'error WordMismatch()', 'error FillTooLate()', 'error SendFailed()',
  'error ProofIncomplete()', 'error BadNode()',
  // raised by BeefyStateRoots.stateRootOf inside claim
  'error UnknownBlock()',
]);
export const stateRootsAbi = parseAbi([
  'function importBlock(bytes justification, bytes32[] peaksAtPrev, bytes headerPrev) returns (bytes32)',
  'function stateRootOf(bytes32 blockHash) view returns (bytes32 stateRoot, uint32 number)',
  'event Imported(uint32 indexed number, bytes32 indexed blockHash, bytes32 stateRoot, uint64 setId)',
  'error BadVersion()', 'error BadPayload()', 'error StaleSetId()', 'error BadSetLength()', 'error NotEnoughSignatures()',
  'error BadSigner()', 'error HeaderMismatch()', 'error MmrRootMismatch()', 'error UnknownBlock()', 'error BadPeakCount()',
]);
export const fillBookAbi = parseAbi([
  'function fill(bytes32 orderKey, address recipient, address payee) payable',
  'function fills(bytes32) view returns (bytes32)',
  'event Filled(bytes32 indexed orderKey, address indexed recipient, uint256 amount, address indexed payee, uint256 timestamp)',
]);

/* ---------- reading the chains ---------- */

export interface ChainOrder {
  id: number; orderKey: Hex; requester: Address; recipient: Address; amountWei: bigint; priceWei: bigint;
  deadline: number; status: number; createdAt: number; createTx: Hex;
  fill?: { filler: Address; payee: Address; block: number; at: number; tx: Hex };
  claimedAt?: number; claimTx?: Hex; refundedAt?: number; refundTx?: Hex;
}

const blockTimes = new Map<bigint, number>();
async function timeOf(block: bigint) {
  if (!blockTimes.has(block)) blockTimes.set(block, Number((await sepoliaClient.getBlock({ blockNumber: block })).timestamp) * 1000);
  return blockTimes.get(block)!;
}

export async function loadOrders(): Promise<ChainOrder[]> {
  const [created, claimed, refunded, filled] = await Promise.all([
    sepoliaClient.getContractEvents({ address: ADDR.escrow, abi: escrowAbi, eventName: 'OrderCreated', fromBlock: ESCROW_FROM }),
    sepoliaClient.getContractEvents({ address: ADDR.escrow, abi: escrowAbi, eventName: 'Claimed', fromBlock: ESCROW_FROM }),
    sepoliaClient.getContractEvents({ address: ADDR.escrow, abi: escrowAbi, eventName: 'Refunded', fromBlock: ESCROW_FROM }),
    v3Client.getContractEvents({ address: ADDR.fillBook, abi: fillBookAbi, eventName: 'Filled', fromBlock: FILLBOOK_FROM }),
  ]);
  const out: ChainOrder[] = [];
  for (const e of created) {
    const a = e.args as Required<typeof e.args>;
    const o: ChainOrder = {
      id: Number(a.orderId), orderKey: a.orderKey as Hex, requester: a.requester as Address, recipient: a.v3Recipient as Address,
      amountWei: a.amountV3Wei as bigint, priceWei: a.price as bigint, deadline: Number(a.deadline) * 1000, status: 1,
      createdAt: await timeOf(e.blockNumber), createTx: e.transactionHash,
    };
    // the fill that counts is the one for this order's key, recipient and amount
    const f = filled.find((x) => x.args.orderKey === o.orderKey && x.args.recipient?.toLowerCase() === o.recipient.toLowerCase() && x.args.amount === o.amountWei);
    if (f) {
      const tx = await v3Client.getTransaction({ hash: f.transactionHash });
      o.fill = { filler: tx.from, payee: f.args.payee as Address, block: Number(f.blockNumber), at: Number(f.args.timestamp) * 1000, tx: f.transactionHash };
    }
    const c = claimed.find((x) => x.args.orderId === a.orderId);
    if (c) { o.status = 2; o.claimedAt = await timeOf(c.blockNumber); o.claimTx = c.transactionHash; }
    const r = refunded.find((x) => x.args.orderId === a.orderId);
    if (r) { o.status = 3; o.refundedAt = await timeOf(r.blockNumber); o.refundTx = r.transactionHash; }
    out.push(o);
  }
  return out;
}

/** V3 block numbers whose state roots BeefyStateRoots holds. */
export async function loadImported(): Promise<Map<number, Hex>> {
  const logs = await sepoliaClient.getContractEvents({ address: ADDR.stateRoots, abi: stateRootsAbi, eventName: 'Imported', fromBlock: ESCROW_FROM - 1n });
  return new Map(logs.map((l) => [Number(l.args.number), l.transactionHash]));
}

/* ---------- MetaMask ---------- */

type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
const provider = () => {
  const p = (window as unknown as { ethereum?: Eip1193 }).ethereum;
  if (!p) throw new Error('No browser wallet found. Install MetaMask to sign.');
  return p;
};

async function walletOn(chain: typeof sepolia | typeof v3Chain) {
  const p = provider();
  const [account] = (await p.request({ method: 'eth_requestAccounts' })) as Address[];
  const hex = toHex(chain.id);
  try {
    await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
  } catch (e) {
    if ((e as { code?: number }).code !== 4902 || chain.id !== v3Chain.id) throw e;
    await p.request({
      method: 'wallet_addEthereumChain',
      params: [{ chainId: hex, chainName: v3Chain.name, nativeCurrency: v3Chain.nativeCurrency, rpcUrls: v3Chain.rpcUrls.default.http }],
    });
  }
  return createWalletClient({ account, chain, transport: custom(p) });
}

/* ---------- writes ---------- */

export async function createOrderTx(recipient: Address, amountWei: bigint, priceWei: bigint, deadlineSec: number) {
  const wallet = await walletOn(sepolia);
  const { request } = await sepoliaClient.simulateContract({
    account: wallet.account, address: ADDR.escrow, abi: escrowAbi, functionName: 'createOrder', args: [recipient, amountWei, BigInt(deadlineSec)], value: priceWei,
  });
  const hash = await wallet.writeContract(request);
  await sepoliaClient.waitForTransactionReceipt({ hash });
  return hash;
}

/** Pay an order on V3. The payee, the Sepolia address the escrow will pay, defaults to the filling account. */
export async function fillTx(o: ChainOrder, payee?: Address) {
  const wallet = await walletOn(v3Chain);
  const hash = await wallet.writeContract({ address: ADDR.fillBook, abi: fillBookAbi, functionName: 'fill', args: [o.orderKey, o.recipient, payee ?? wallet.account.address], value: o.amountWei });
  await v3Client.waitForTransactionReceipt({ hash });
  return hash;
}

export async function refundTx(id: number) {
  const wallet = await walletOn(sepolia);
  const { request } = await sepoliaClient.simulateContract({ account: wallet.account, address: ADDR.escrow, abi: escrowAbi, functionName: 'refund', args: [BigInt(id)] });
  const hash = await wallet.writeContract(request);
  await sepoliaClient.waitForTransactionReceipt({ hash });
  return hash;
}

/* ---------- proofs, built in the browser from V3's Substrate RPC ---------- */

const MMR_NODES = '0xa8c65209d47ee80f56b0011e8fd91f50519dfc7fdad21b84f64a5310fa178ef2'; // twox128("Mmr") ++ twox128("Nodes")
const MMR_LEAVES = '0xa8c65209d47ee80f56b0011e8fd91f508156209906244f2341137c136774c91d'; // twox128("Mmr") ++ twox128("NumberOfLeaves")
const blake256 = (b: Uint8Array) => blake2b(b, { dkLen: 32 });
const cat = (...p: Uint8Array[]) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
const u64le = (n: number) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return b; };
function compact(n: number): Uint8Array {
  if (n < 64) return Uint8Array.of(n << 2);
  if (n < 2 ** 14) return Uint8Array.of(((n << 2) | 1) & 0xff, (n << 2 | 1) >> 8);
  if (n < 2 ** 30) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, ((n << 2) | 2) >>> 0, true); return b; }
  throw new Error('compact too large');
}
function peakPositions(leaves: number) {
  const out = []; let start = 0;
  for (let h = 52; h >= 0; h--) {
    if (Math.floor(leaves / 2 ** h) % 2 !== 1) continue;
    const size = 2 ** (h + 1) - 1; out.push(start + size - 1); start += size;
  }
  return out;
}

interface Header { parentHash: Hex; number: Hex; stateRoot: Hex; extrinsicsRoot: Hex; digest: { logs: Hex[] } }
const scaleHeader = (h: Header) => cat(
  hexToBytes(h.parentHash), compact(parseInt(h.number, 16)), hexToBytes(h.stateRoot), hexToBytes(h.extrinsicsRoot),
  compact(h.digest.logs.length), ...h.digest.logs.map(hexToBytes),
);

/** The import of signed block B: justification, Mmr.Nodes peaks at B-1, SCALE header of B-1. */
async function buildImport(B: number) {
  const hashB = await v3Call<Hex>('chain_getBlockHash', [B]);
  const block = await v3Call<{ justifications: [unknown, Hex | number[]][] | null }>('chain_getBlock', [hashB]);
  const entry = block.justifications?.find(([id]) => (Array.isArray(id) ? String.fromCharCode(...(id as number[])) : id) === 'BEEF' || id === '0x42454546');
  if (!entry) throw new Error(`V3 block ${B} has no stored BEEFY justification`);
  let j = typeof entry[1] === 'string' ? hexToBytes(entry[1]) : Uint8Array.from(entry[1]);
  if (j[0] !== 1) j = j.slice((j[0] & 3) === 1 ? 2 : (j[0] & 3) === 2 ? 4 : 1); // drop the Bytes length prefix

  const prevHash = await v3Call<Hex>('chain_getBlockHash', [B - 1]);
  const header = scaleHeader(await v3Call<Header>('chain_getHeader', [prevHash]));
  if (toHex(blake256(header)) !== prevHash) throw new Error('re-encoded header does not hash to its block hash');
  const leavesRaw = await v3Call<Hex>('state_getStorage', [MMR_LEAVES, prevHash]);
  const leaves = Number(new DataView(hexToBytes(leavesRaw).buffer).getBigUint64(0, true));
  if (leaves !== B - 1) throw new Error(`MMR leaf count ${leaves} at ${B - 1}: expected one leaf per block`);
  const peaks: Hex[] = [];
  for (const pos of peakPositions(leaves)) {
    const v = await v3Call<Hex | null>('state_getStorage', [toHex(cat(hexToBytes(MMR_NODES), u64le(pos))), prevHash]);
    if (!v) throw new Error(`Mmr.Nodes(${pos}) missing at ${B - 1}`);
    peaks.push(v);
  }
  return { justification: toHex(j), peaks, header: toHex(header), prevHash };
}

export interface ClaimArgs { orderId: bigint; payee: Address; fillTimestamp: bigint; blockHash: Hex; childRootProof: Hex[]; slotProof: Hex[] }

/**
 * Everything a claim needs against signed block B (> the fill block): imports B through MetaMask when Sepolia does not
 * have it yet, then reads FillBook's child root and the fill record as trie proofs at B-1.
 */
export async function prepareClaim(o: ChainOrder, B: number, onStep: (s: string) => void): Promise<ClaimArgs> {
  if (!o.fill) throw new Error('this order has no fill on V3 yet');
  if (B <= o.fill.block) throw new Error('wait for V3 to sign a block after the fill');

  // state is cumulative: any imported block at or after the fill holds the record, so reuse one when Sepolia has it
  onStep('Checking which V3 blocks Sepolia has imported');
  const imported = [...(await loadImported()).keys()].filter((n) => n >= o.fill!.block);
  let at: Hex;
  if (imported.length) {
    const n = Math.max(...imported);
    onStep(`Using V3 block ${n.toLocaleString('en-US')}, already imported on Sepolia`);
    at = await v3Call<Hex>('chain_getBlockHash', [n]);
  } else {
    onStep(`Reading signed block ${B.toLocaleString('en-US')} from V3`);
    const imp = await buildImport(B);
    onStep('Importing the signed block on Sepolia: confirm in MetaMask');
    const wallet = await walletOn(sepolia);
    const { request } = await sepoliaClient.simulateContract({ account: wallet.account, address: ADDR.stateRoots, abi: stateRootsAbi, functionName: 'importBlock', args: [imp.justification, imp.peaks, imp.header] });
    await sepoliaClient.waitForTransactionReceipt({ hash: await wallet.writeContract(request) });
    at = imp.prevHash;
  }
  onStep('Building the storage proof of the fill');
  const [slot, childKey] = await Promise.all([
    sepoliaClient.readContract({ address: ADDR.escrow, abi: escrowAbi, functionName: 'fillSlot', args: [BigInt(o.id), o.recipient, o.amountWei] }),
    sepoliaClient.readContract({ address: ADDR.escrow, abi: escrowAbi, functionName: 'childStorageKey' }),
  ]);
  const key = toHex(blake256(hexToBytes(slot)));
  const [main, child, word] = await Promise.all([
    v3Call<{ proof: Hex[] }>('state_getReadProof', [[childKey], at]),
    v3Call<{ proof: Hex[] }>('state_getChildReadProof', [childKey, [key], at]),
    v3Call<Hex | null>('childstate_getStorage', [childKey, key, at]),
  ]);
  if (!word) throw new Error(`no fill record for order ${o.id} at the proven V3 block`);
  const w = BigInt(word);
  return {
    orderId: BigInt(o.id),
    payee: `0x${(w & ((1n << 160n) - 1n)).toString(16).padStart(40, '0')}` as Address,
    fillTimestamp: w >> 160n,
    blockHash: at,
    childRootProof: main.proof,
    slotProof: child.proof,
  };
}

const call = (a: ClaimArgs) => [a.orderId, a.payee, a.fillTimestamp, a.blockHash, a.childRootProof, a.slotProof] as const;

export async function claimTx(a: ClaimArgs) {
  const wallet = await walletOn(sepolia);
  const { request } = await sepoliaClient.simulateContract({ account: wallet.account, address: ADDR.escrow, abi: escrowAbi, functionName: 'claim', args: call(a) });
  const hash = await wallet.writeContract(request);
  await sepoliaClient.waitForTransactionReceipt({ hash });
  return hash;
}

/** Send a claim as eth_call. Returns null when it would succeed, else the revert's error name. */
export async function simulateClaim(a: ClaimArgs): Promise<string | null> {
  try {
    await sepoliaClient.simulateContract({ address: ADDR.escrow, abi: escrowAbi, functionName: 'claim', args: call(a) });
    return null;
  } catch (e) {
    const r = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
    return r instanceof ContractFunctionRevertedError ? r.data?.errorName ?? r.shortMessage : (e as Error).message.split('\n')[0];
  }
}

/** The escrow's order key, as FillBook records it (prd.md I-6). */
export const orderKeyOf = (id: number) =>
  keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'address' }, { type: 'uint256' }], [11155111n, ADDR.escrow, BigInt(id)]));

export const sepoliaTx = (hash: string) => `https://sepolia.etherscan.io/tx/${hash}`;

export function errorText(e: unknown): string {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (r instanceof ContractFunctionRevertedError && r.data?.errorName) return `The contract refused: ${r.data.errorName}.`;
    if (/User (rejected|denied)/i.test(e.message)) return 'You declined the request in MetaMask.';
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : String(e);
}
