import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromHex, toHex } from '../src/bytes.ts';
import { checkSignatures, decodeJustification, mmrRootOf, signedIndices } from '../src/beefy.ts';
import { bagPeaks, peakPositions } from '../src/mmr.ts';
import { AUTHORITIES } from '../src/config.ts';

// prd.md Appendix A: values captured from the live V3 node on 1-2 November 2026.
const J_279494 = '0x01046d68808dca1dc9b511f35a70fa4dda937a4773b3c37f5329ae7908ec0ab8ce8157829dc6430400d70100000000000004c00200000008cf7dfa025d742fb6e989162e1ad9118dd3fb21eb7fafe1300d0898adab11d53866c87442e32187a455e08fe3e956668112c1df0c148ad62221950655f7e0351f013c9b25c542fa057e860d223594aec2ac1b3deca07035d3102f5a9f1e88af772701b5b16fe6510a761ae10087022a35b10570fa59743d68bff91e49945c71603301';
const PEAKS_279493 = [
  [524286, '0xa65329486f3dfa39457a540a3127d56c2df5abca963db3abdb342b05e069cb72'],
  [557053, '0x442b41167037ec0ae39e00e97d1230bb97d583d8f2c43403677e042963e48321'],
  [558076, '0xd5e18dbd3338de4092f941e75e82c163e4b1c5baf0da127159b79b27350022c0'],
  [558587, '0xc1656d9c5c5424a34bbd954e2df38b68bde3bdd7cf140c6470b156998193ff1d'],
  [558842, '0x6b2fec68e210367dd0dde5d2d55fb6803e3cff9242fb943e83a401e76938b835'],
  [558969, '0xb41b2c90d985278910a8a698348a88913d8e7bf11320974c972728ebe69ea0b2'],
  [558976, '0x908c80bc691bf631d1c31a1cb13bc787f1065e4475a8db67afa6f221f3ef605d'],
  [558977, '0x58d1405a87b99546836d0c38ae6b8b79ea938aae5c544813009fa7e9d4a21922'],
] as const;

test('decodes the #279,494 justification field by field', () => {
  const j = decodeJustification(fromHex(J_279494));
  assert.equal(j.version, 1);
  assert.equal(j.commitment.blockNumber, 279_494);
  assert.equal(j.commitment.setId, 471n);
  assert.equal(toHex(j.commitment.bytes), '0x046d68808dca1dc9b511f35a70fa4dda937a4773b3c37f5329ae7908ec0ab8ce8157829dc6430400d701000000000000');
  assert.equal(toHex(mmrRootOf(j.commitment)), '0x8dca1dc9b511f35a70fa4dda937a4773b3c37f5329ae7908ec0ab8ce8157829d');
  assert.deepEqual(signedIndices(j.bitfield, j.setLength), [0, 1]);
  assert.equal(j.signatures.length, 2);
});

test('accepts the justification with its SCALE Bytes prefix too', () => {
  const raw = fromHex(J_279494);
  const prefixed = new Uint8Array([0xe9, 0x02, ...raw]); // compact(186) = 0x02e9
  assert.equal(decodeJustification(prefixed).commitment.blockNumber, 279_494);
});

test('both signatures recover to the BEEFY authorities in order', async () => {
  const signers = await checkSignatures(decodeJustification(fromHex(J_279494)), AUTHORITIES);
  assert.deepEqual(signers, AUTHORITIES);
});

test('T-9: a flipped root byte recovers a stranger (BadSigner)', async () => {
  const raw = fromHex(J_279494);
  raw[1 + 1 + 2 + 1 + 5] ^= 1;
  await assert.rejects(checkSignatures(decodeJustification(raw), AUTHORITIES), /BadSigner/);
});

test('T-6: one bit missing from the bitfield (NotEnoughSignatures)', async () => {
  const raw = fromHex(J_279494);
  raw[50] = 0x80;
  await assert.rejects(checkSignatures(decodeJustification(raw), AUTHORITIES), /NotEnoughSignatures/);
});

test('T-8: the same signature twice (BadSigner)', async () => {
  const j = decodeJustification(fromHex(J_279494));
  j.signatures[1] = j.signatures[0];
  await assert.rejects(checkSignatures(j, AUTHORITIES), /BadSigner/);
});

test('peak positions for 279,493 leaves match Mmr.Nodes', () => {
  assert.deepEqual(peakPositions(279_493), PEAKS_279493.map(([p]) => p));
});

test('bagging the peaks at #279,493 reproduces mmr_root', () => {
  const root = bagPeaks(PEAKS_279493.map(([, h]) => fromHex(h)));
  assert.equal(toHex(root), '0x073b27ff1b381451104e37acf301ca4268704fe706632308b4b8ac06cc2393a1');
});

test('T-10: a missing peak changes the root', () => {
  const root = bagPeaks(PEAKS_279493.slice(1).map(([, h]) => fromHex(h)));
  assert.notEqual(toHex(root), '0x073b27ff1b381451104e37acf301ca4268704fe706632308b4b8ac06cc2393a1');
});
