import { keccak256, recoverAddress } from 'viem';
import { Reader, toHex, type Bytes } from './bytes.ts';

// V3's BEEFY finality proof, as stored in chain_getBlock(..).justifications under engine id "BEEF".
// Layout (prd.md §8.3): version 0x01, commitment { payload: Vec<([u8;2], Vec<u8>)>, block_number: u32, validator_set_id: u64 },
// then the compact signatures: bitfield Vec<u8>, validator_set_len u32, Vec<[u8;65]> in bitfield order.

export const BEEF = '0x42454546';

export interface Commitment {
  bytes: Bytes; // the SCALE commitment, the message is keccak256(bytes)
  payload: { id: string; data: Bytes }[];
  blockNumber: number;
  setId: bigint;
}
export interface Justification {
  version: number;
  commitment: Commitment;
  bitfield: Bytes;
  setLength: number;
  signatures: Bytes[];
}

/** Accepts the proof with or without its outer SCALE `Bytes` length prefix. */
export function decodeJustification(raw: Bytes): Justification {
  let b = raw;
  if (b[0] !== 0x01) {
    const r = new Reader(b);
    const len = r.compact();
    b = r.take(len);
  }
  const r = new Reader(b);
  const version = r.byte();
  if (version !== 1) throw new Error(`unknown BEEFY proof version ${version}`);

  const start = r.o;
  const items = r.compact();
  const payload = [];
  for (let i = 0; i < items; i++) {
    const id = new TextDecoder().decode(r.take(2));
    const data = r.take(r.compact());
    payload.push({ id, data });
  }
  const blockNumber = r.u32();
  const setId = r.u64();
  const bytes = b.slice(start, r.o);

  const bitfield = r.take(r.compact());
  const setLength = r.u32();
  const count = r.compact();
  const signatures = [];
  for (let i = 0; i < count; i++) signatures.push(r.take(65).slice());
  if (!r.done) throw new Error('trailing bytes after the signatures');
  return { version, commitment: { bytes, payload, blockNumber, setId }, bitfield, setLength, signatures };
}

/** The 32-byte MMR root under payload id "mh"; the escrow requires exactly one item. */
export function mmrRootOf(c: Commitment): Bytes {
  if (c.payload.length !== 1 || c.payload[0].id !== 'mh' || c.payload[0].data.length !== 32) throw new Error('BadPayload');
  return c.payload[0].data;
}

/** Validator indices marked in the bitfield, most significant bit first (0xc0 = validators 0 and 1). */
export function signedIndices(bitfield: Bytes, setLength: number): number[] {
  const out = [];
  for (let i = 0; i < setLength; i++) if (bitfield[i >> 3] & (0x80 >> (i & 7))) out.push(i);
  return out;
}

export async function recoverSigners(j: Justification): Promise<string[]> {
  const hash = keccak256(toHex(j.commitment.bytes));
  return Promise.all(j.signatures.map((s) => {
    const sig = new Uint8Array(65);
    sig.set(s.subarray(0, 64));
    sig[64] = s[64] < 27 ? s[64] + 27 : s[64];
    return recoverAddress({ hash, signature: toHex(sig) }).then((a) => a.toLowerCase());
  }));
}

/**
 * The checks BeefyStateRoots.importBlock makes on signatures: the set has the expected length, every validator signed,
 * and each signature recovers to the authority at its index. Throws the contract's error name.
 */
export async function checkSignatures(j: Justification, authorities: string[]): Promise<string[]> {
  if (j.setLength !== authorities.length) throw new Error('BadSetLength');
  const signed = signedIndices(j.bitfield, j.setLength);
  if (signed.length !== authorities.length || j.signatures.length !== authorities.length) throw new Error('NotEnoughSignatures');
  const recovered = await recoverSigners(j);
  recovered.forEach((addr, k) => {
    if (addr !== authorities[signed[k]].toLowerCase()) throw new Error('BadSigner');
  });
  return recovered;
}
