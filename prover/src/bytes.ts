// Small byte helpers and the SCALE pieces the proofs need (compact integers, little-endian ints).

export type Bytes = Uint8Array;

export function fromHex(hex: string): Bytes {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (h.length % 2) throw new Error(`odd-length hex: ${hex.slice(0, 20)}…`);
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export const toHex = (b: Bytes): `0x${string}` => `0x${Buffer.from(b).toString('hex')}`;

export function concatBytes(...parts: Bytes[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export const equalBytes = (a: Bytes, b: Bytes) => a.length === b.length && a.every((x, i) => x === b[i]);

export const u32le = (n: number): Bytes => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
};
export const readU32 = (b: Bytes, o: number) => new DataView(b.buffer, b.byteOffset).getUint32(o, true);
export const readU64 = (b: Bytes, o: number) => new DataView(b.buffer, b.byteOffset).getBigUint64(o, true);

/** SCALE compact integer: returns the value and the number of bytes it took. */
export function readCompact(b: Bytes, o: number): { value: number; size: number } {
  const mode = b[o] & 3;
  if (mode === 0) return { value: b[o] >> 2, size: 1 };
  if (mode === 1) return { value: (b[o] | (b[o + 1] << 8)) >> 2, size: 2 };
  if (mode === 2) return { value: readU32(b, o) >>> 2, size: 4 };
  const len = (b[o] >> 2) + 4;
  let v = 0;
  for (let i = len - 1; i >= 0; i--) v = v * 256 + b[o + 1 + i];
  return { value: v, size: 1 + len };
}

/** A reader that walks a byte array front to back. */
export class Reader {
  o = 0;
  constructor(readonly b: Bytes) {}
  byte() { if (this.o >= this.b.length) throw new Error('read past end'); return this.b[this.o++]; }
  take(n: number) { if (this.o + n > this.b.length) throw new Error('read past end'); const s = this.b.subarray(this.o, this.o + n); this.o += n; return s; }
  compact() { const c = readCompact(this.b, this.o); this.o += c.size; return c.value; }
  u32() { const v = readU32(this.b, this.o); this.o += 4; return v; }
  u64() { const v = readU64(this.b, this.o); this.o += 8; return v; }
  get done() { return this.o === this.b.length; }
}
