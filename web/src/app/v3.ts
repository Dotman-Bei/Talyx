import { useSyncExternalStore } from 'react';
import { hexToBytes, isAuthority, readU32LE, readU64LE, recoverSigners } from '../shared/beefy';
import type { Hex } from 'viem';

// Live Portaldot V3 data over the public Substrate RPC: best block, BEEFY-finalized block and every stored
// BEEFY justification seen this session, with both signatures recovered in the browser.

const WS_URL = import.meta.env.VITE_V3_WS || 'wss://test-node-v3.portaldot.dev';
const BEEF = '0x42454546';
export const BLOCK_SECONDS = 6;
export const JUSTIFICATION_EVERY = 8;

export interface Justified {
  number: number;
  hash: string;
  setId: number;
  signers: number; // signatures that recover to a BEEFY authority, out of 2
  seenAt: number;
}

export interface V3State {
  status: 'connecting' | 'live' | 'error';
  error?: string;
  best?: number;
  finalized?: number;
  lastJustified?: Justified;
  justified: Justified[]; // newest first, capped
  updatedAt?: number;
}

let state: V3State = { status: 'connecting', justified: [] };
const listeners = new Set<() => void>();
function set(patch: Partial<V3State>) {
  state = { ...state, ...patch, updatedAt: Date.now() };
  listeners.forEach((l) => l());
}

let ws: WebSocket | null = null;
let nextId = 1;
const pending = new Map<number, (r: { result?: unknown; error?: { message: string } }) => void>();
const subs = new Map<string, (p: unknown) => void>();

function call<T>(method: string, params: unknown[] = []): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return reject(new Error('V3 node not connected'));
    const id = nextId++;
    pending.set(id, (r) => (r.error ? reject(new Error(r.error.message)) : resolve(r.result as T)));
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  });
}

async function subscribe(method: string, onData: (p: unknown) => void) {
  const subId = await call<string>(method);
  subs.set(subId, onData);
}

/** Parse a stored BEEFY justification: SCALE Bytes wrapping a version-1 finality proof. */
export function decodeJustification(raw: Hex | number[]) {
  // the node returns either a hex string or a plain byte array
  let b = typeof raw === 'string' ? hexToBytes(raw) : Uint8Array.from(raw);
  // strip the compact length prefix of the outer Bytes, when present
  if (b[0] !== 0x01) {
    const mode = b[0] & 3;
    b = b.slice(mode === 0 ? 1 : mode === 1 ? 2 : 4);
  }
  if (b[0] !== 0x01) throw new Error('unknown justification version');
  // commitment: payload Vec (1 item: id[2] + compact len 32 + root), block u32, set u64
  const commitment = b.slice(1, 49);
  const number = readU32LE(commitment, 36);
  const setId = readU64LE(commitment, 40);
  let o = 49;
  const bitfieldLen = b[o] >> 2; o += 1 + bitfieldLen;
  o += 4; // validator set length
  const sigCount = b[o] >> 2; o += 1;
  const sigs: Uint8Array[] = [];
  for (let i = 0; i < sigCount; i++) sigs.push(b.slice(o + i * 65, o + (i + 1) * 65));
  return { commitment, number, setId, sigs };
}

async function checkBlock(hash: string) {
  const block = await call<{ justifications: [unknown, Hex | number[]][] | null; block: { header: { number: string } } }>('chain_getBlock', [hash]);
  const entry = block.justifications?.find(([engine]) => {
    const id = Array.isArray(engine) ? '0x' + (engine as number[]).map((x) => x.toString(16).padStart(2, '0')).join('') : String(engine);
    return id.toLowerCase() === BEEF;
  });
  if (!entry) return;
  const j = decodeJustification(entry[1]);
  const recovered = await recoverSigners(j.commitment, j.sigs);
  const signers = recovered.filter((a, i) => isAuthority(a) === i).length;
  const item: Justified = { number: j.number, hash, setId: j.setId, signers, seenAt: Date.now() };
  if (state.justified.some((x) => x.number === item.number)) return;
  const justified = [item, ...state.justified].sort((a, b) => b.number - a.number).slice(0, 24);
  set({ justified, lastJustified: justified[0] });
}

async function backfill(finalized: number) {
  // the last 9 finalized blocks always contain one stored justification
  for (let n = finalized; n > finalized - 9 && n > 0; n--) {
    const hash = await call<string>('chain_getBlockHash', [n]);
    await checkBlock(hash);
  }
}

function connect() {
  set({ status: 'connecting', error: undefined });
  ws = new WebSocket(WS_URL);
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)!(msg); pending.delete(msg.id); }
    else if (msg.params?.subscription) subs.get(msg.params.subscription)?.(msg.params.result);
  };
  ws.onerror = () => set({ status: 'error', error: 'Could not reach the V3 node.' });
  ws.onclose = () => {
    pending.clear(); subs.clear();
    if (state.status !== 'error') set({ status: 'error', error: 'The V3 node closed the connection.' });
  };
  ws.onopen = async () => {
    try {
      await subscribe('chain_subscribeNewHeads', (h) => set({ best: parseInt((h as { number: string }).number, 16), status: 'live' }));
      await subscribe('chain_subscribeFinalizedHeads', async (h) => {
        const n = parseInt((h as { number: string }).number, 16);
        set({ finalized: n });
        const hash = await call<string>('chain_getBlockHash', [n]);
        checkBlock(hash).catch(() => {});
      });
      const head = await call<{ number: string }>('chain_getFinalizedHead').then((hash) => call<{ number: string }>('chain_getHeader', [hash]));
      const fin = parseInt(head.number, 16);
      set({ finalized: fin, status: 'live' });
      backfill(fin).catch(() => {});
    } catch (e) {
      set({ status: 'error', error: (e as Error).message });
    }
  };
}

/** A JSON-RPC call on the shared V3 connection, opening it first when needed. */
export async function v3Call<T>(method: string, params: unknown[] = []): Promise<T> {
  if (!started) { started = true; connect(); }
  for (let i = 0; i < 60 && (!ws || ws.readyState !== WebSocket.OPEN); i++) await new Promise((r) => setTimeout(r, 250));
  return call<T>(method, params);
}

export function retry() {
  try { ws?.close(); } catch { /* already closed */ }
  connect();
}

let started = false;
export function useV3(): V3State {
  if (!started) { started = true; connect(); }
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state);
}

/** Blocks until the next stored justification, estimated from the last one seen (they come every 8 blocks). */
export function nextJustified(s: V3State): { block: number; seconds: number } | null {
  if (!s.lastJustified || !s.best) return null;
  let next = s.lastJustified.number + JUSTIFICATION_EVERY;
  while (next <= (s.finalized ?? s.best)) next += JUSTIFICATION_EVERY;
  return { block: next, seconds: Math.max(0, (next - s.best) * BLOCK_SECONDS + 12) };
}
