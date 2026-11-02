import { blake2AsU8a } from '@polkadot/util-crypto';
import { Reader, equalBytes, toHex, type Bytes } from './bytes.ts';

// Substrate trie proofs, layout V1 (state version 1), with blake2b-256 node hashes: what state_getReadProof and
// state_getChildReadProof return. The Solidity Trie library walks the same node format.
//
// Node header (first byte): 0b01 leaf, 0b10 branch without value, 0b11 branch with value,
// 0b001 leaf with hashed value, 0b0001 branch with hashed value, 0x00 empty. The low bits hold the partial key's
// nibble count, extended by following bytes while each is 255. Then the partial key (odd counts are padded in the
// first byte's high nibble), then for branches a u16 LE child bitmap, then the value, then each child as compact
// length + bytes (32 bytes = a hash reference, fewer = an inline node).

export const blake2_256 = (b: Bytes) => blake2AsU8a(b, 256);

type Node =
  | { kind: 'empty' }
  | { kind: 'leaf'; partial: number[]; value: Value }
  | { kind: 'branch'; partial: number[]; value?: Value; children: (Bytes | undefined)[] };
type Value = { inline: Bytes } | { hash: Bytes };

function readNibbleCount(r: Reader, first: number, bits: number): number {
  const max = (1 << bits) - 1;
  let n = first & max;
  if (n < max) return n;
  for (;;) {
    const x = r.byte();
    n += x;
    if (x < 255) return n;
  }
}

function readPartial(r: Reader, count: number): number[] {
  const bytes = r.take(Math.ceil(count / 2));
  const nibbles = [];
  for (const b of bytes) nibbles.push(b >> 4, b & 15);
  return count % 2 ? nibbles.slice(1) : nibbles;
}

export function decodeNode(enc: Bytes): Node {
  const r = new Reader(enc);
  const first = r.byte();
  let kind: 'leaf' | 'branch' | 'branchValue';
  let hashed = false;
  let count: number;
  if (first === 0) return { kind: 'empty' };
  if (first >> 6 === 0b01) { kind = 'leaf'; count = readNibbleCount(r, first, 6); }
  else if (first >> 6 === 0b10) { kind = 'branch'; count = readNibbleCount(r, first, 6); }
  else if (first >> 6 === 0b11) { kind = 'branchValue'; count = readNibbleCount(r, first, 6); }
  else if (first >> 5 === 0b001) { kind = 'leaf'; hashed = true; count = readNibbleCount(r, first, 5); }
  else if (first >> 4 === 0b0001) { kind = 'branchValue'; hashed = true; count = readNibbleCount(r, first, 4); }
  else throw new Error(`unknown trie node header 0x${first.toString(16)}`);

  const partial = readPartial(r, count);
  const readValue = (): Value => (hashed ? { hash: r.take(32) } : { inline: r.take(r.compact()) });
  if (kind === 'leaf') return { kind, partial, value: readValue() };

  const bitmap = r.byte() | (r.byte() << 8);
  const value = kind === 'branchValue' ? readValue() : undefined;
  const children: (Bytes | undefined)[] = [];
  for (let i = 0; i < 16; i++) children.push(bitmap & (1 << i) ? r.take(r.compact()) : undefined);
  return { kind: 'branch', partial, value, children };
}

const nibblesOf = (key: Bytes) => [...key].flatMap((b) => [b >> 4, b & 15]);

/**
 * Look a key up in a proof. Returns the value, null when the proof shows the key is absent, and throws when the
 * proof is missing a node it needs or a node does not hash to its parent's reference.
 */
export function readProof(root: Bytes, proof: Bytes[], key: Bytes): Bytes | null {
  const db = new Map(proof.map((n) => [toHex(blake2_256(n)), n]));
  const fetch = (hash: Bytes) => {
    const n = db.get(toHex(hash));
    if (!n) throw new Error(`proof is missing node ${toHex(hash).slice(0, 18)}…`);
    return n;
  };
  const resolve = (v: Value) => ('inline' in v ? v.inline : fetch(v.hash));

  let nibbles = nibblesOf(key);
  let enc = fetch(root);
  for (;;) {
    const node = decodeNode(enc);
    if (node.kind === 'empty') return null;
    const p = node.partial;
    if (nibbles.length < p.length || p.some((x, i) => nibbles[i] !== x)) return null;
    nibbles = nibbles.slice(p.length);
    if (node.kind === 'leaf') return nibbles.length === 0 ? resolve(node.value) : null;
    if (nibbles.length === 0) return node.value ? resolve(node.value) : null;
    const child = node.children[nibbles[0]];
    if (!child) return null;
    nibbles = nibbles.slice(1);
    enc = child.length === 32 ? fetch(child) : child; // shorter than a hash: the node is inline
  }
}

export const sameRoot = (a: Bytes, b: Bytes) => equalBytes(a, b);
