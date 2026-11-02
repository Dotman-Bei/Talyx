import { concat, keccak256, recoverAddress, toHex, type Hex } from 'viem';

// Live V3 test vectors, captured from wss://test-node-v3.portaldot.dev (prd.md Appendix A).

export const AUTHORITIES = [
  '0x4d13b6aea6cd423cc48d7159ac10b26927c2b421',
  '0x4a69b8f722a9b486f9db0d243c908170012d7413',
] as const;

export const KEYSET_COMMITMENT = '0xc745b6c2eca708396dde733c7b93f344da8eee0eb435e68fac6a77bce9c1a7d5';

// Justification for block #279,494 without its SCALE `Bytes` length prefix.
export const JUSTIFICATION_279494: Hex =
  '0x01046d68808dca1dc9b511f35a70fa4dda937a4773b3c37f5329ae7908ec0ab8ce8157829dc6430400d70100000000000004c00200000008cf7dfa025d742fb6e989162e1ad9118dd3fb21eb7fafe1300d0898adab11d53866c87442e32187a455e08fe3e956668112c1df0c148ad62221950655f7e0351f013c9b25c542fa057e860d223594aec2ac1b3deca07035d3102f5a9f1e88af772701b5b16fe6510a761ae10087022a35b10570fa59743d68bff91e49945c71603301';

export const PEAKS_279493: Hex[] = [
  '0xa65329486f3dfa39457a540a3127d56c2df5abca963db3abdb342b05e069cb72',
  '0x442b41167037ec0ae39e00e97d1230bb97d583d8f2c43403677e042963e48321',
  '0xd5e18dbd3338de4092f941e75e82c163e4b1c5baf0da127159b79b27350022c0',
  '0xc1656d9c5c5424a34bbd954e2df38b68bde3bdd7cf140c6470b156998193ff1d',
  '0x6b2fec68e210367dd0dde5d2d55fb6803e3cff9242fb943e83a401e76938b835',
  '0xb41b2c90d985278910a8a698348a88913d8e7bf11320974c972728ebe69ea0b2',
  '0x908c80bc691bf631d1c31a1cb13bc787f1065e4475a8db67afa6f221f3ef605d',
  '0x58d1405a87b99546836d0c38ae6b8b79ea938aae5c544813009fa7e9d4a21922',
];
export const MMR_ROOT_279493 = '0x073b27ff1b381451104e37acf301ca4268704fe706632308b4b8ac06cc2393a1';

export function hexToBytes(hex: Hex): Uint8Array {
  const out = new Uint8Array((hex.length - 2) / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 + i * 2, 4 + i * 2), 16);
  return out;
}

const raw = hexToBytes(JUSTIFICATION_279494);

/** The 48 commitment bytes: payload [("mh", root)], block number u32 LE, validator set id u64 LE. */
export const COMMITMENT = raw.slice(1, 49);
/** Signatures in bitfield order, 65 bytes each (r, s, recovery id 0/1). */
export const SIGNATURES = [raw.slice(56, 121), raw.slice(121, 186)];

export type ByteGroup = 'payload' | 'root' | 'block' | 'set';
export const GROUPS: { id: ByteGroup; label: string; from: number; to: number }[] = [
  { id: 'payload', label: 'Payload “mh”', from: 0, to: 4 },
  { id: 'root', label: 'MMR root', from: 4, to: 36 },
  { id: 'block', label: 'Block number', from: 36, to: 40 },
  { id: 'set', label: 'Validator set', from: 40, to: 48 },
];
export const groupOf = (i: number) => GROUPS.find((g) => i >= g.from && i < g.to)!;

export const readU32LE = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
export const readU64LE = (b: Uint8Array, o: number) => readU32LE(b, o) + readU32LE(b, o + 4) * 2 ** 32;

export async function recoverSigners(commitment: Uint8Array, signatures: Uint8Array[] = SIGNATURES): Promise<string[]> {
  const hash = keccak256(toHex(commitment));
  return Promise.all(
    signatures.map((s) => {
      const sig = new Uint8Array(65);
      sig.set(s.slice(0, 64));
      sig[64] = s[64] + 27;
      return recoverAddress({ hash, signature: toHex(sig) }).then((a) => a.toLowerCase());
    }),
  );
}

export function isAuthority(addr: string) {
  return AUTHORITIES.indexOf(addr.toLowerCase() as (typeof AUTHORITIES)[number]);
}

/** Bag MMR peaks right to left: acc = keccak256(acc ++ peak). */
export function bagPeaks(peaks: Hex[]): Hex {
  let acc = peaks[peaks.length - 1];
  for (let i = peaks.length - 2; i >= 0; i--) acc = keccak256(concat([acc, peaks[i]]));
  return acc;
}

export function keysetCommitment(addrs: readonly string[]): Hex {
  return keccak256(concat(addrs.map((a) => keccak256(a as Hex))));
}

export const short = (h: string, a = 6, b = 4) => `${h.slice(0, a)}…${h.slice(-b)}`;
