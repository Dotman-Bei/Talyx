import { keccak256 } from 'viem';
import { concatBytes, fromHex, toHex, u32le, type Bytes } from './bytes.ts';

// pallet_mmr on V3 (prd.md §8.4). One leaf per block; the leaf added in block B commits to block B-1 as
// keccak256(SCALE(u32 parent_number, H256 parent_hash)). Mmr.Nodes keeps only the peaks, so a proof of the
// newest leaf needs no offchain data: take the peaks at B-1, append B's leaf, bag, compare with the signed root.

const k = (a: Bytes, b: Bytes) => fromHex(keccak256(concatBytes(a, b)));

/** Positions (0-indexed, as in Mmr.Nodes) of the peaks of an MMR with `leaves` leaves, left to right. */
export function peakPositions(leaves: number): number[] {
  const out = [];
  let start = 0;
  for (let h = 52; h >= 0; h--) {
    if (Math.floor(leaves / 2 ** h) % 2 !== 1) continue;
    const size = 2 ** (h + 1) - 1;
    out.push(start + size - 1);
    start += size;
  }
  return out;
}

/** Heights of those peaks, left to right (the set bits of the leaf count, high to low). */
export function peakHeights(leaves: number): number[] {
  const out = [];
  for (let h = 52; h >= 0; h--) if (Math.floor(leaves / 2 ** h) % 2 === 1) out.push(h);
  return out;
}

export const leafHash = (parentNumber: number, parentHash: Bytes) => fromHex(keccak256(concatBytes(u32le(parentNumber), parentHash)));

/** Append one leaf to the peaks of an MMR with `leaves` leaves, merging equal heights. Returns the new peaks. */
export function appendLeaf(peaks: Bytes[], leaves: number, leaf: Bytes): Bytes[] {
  const heights = peakHeights(leaves);
  if (heights.length !== peaks.length) throw new Error('BadPeakCount');
  const stack = peaks.map((p, i) => ({ h: heights[i], p }));
  stack.push({ h: 0, p: leaf });
  while (stack.length > 1 && stack[stack.length - 1].h === stack[stack.length - 2].h) {
    const right = stack.pop()!;
    const left = stack.pop()!;
    stack.push({ h: left.h + 1, p: k(left.p, right.p) });
  }
  return stack.map((x) => x.p);
}

/** Bag peaks into the root: start from the rightmost, acc = keccak256(acc ++ peak) moving left. */
export function bagPeaks(peaks: Bytes[]): Bytes {
  let acc = peaks[peaks.length - 1];
  for (let i = peaks.length - 2; i >= 0; i--) acc = k(acc, peaks[i]);
  return acc;
}

export const hex = toHex;
