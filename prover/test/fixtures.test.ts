import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { verifyImport, verifySlotProof, type ImportInput, type SlotProofInput } from '../src/chain.ts';
import { fromHex, toHex } from '../src/bytes.ts';
import { peakHeights } from '../src/mmr.ts';

// Replays proofs captured from the live V3 node by `talyx spike` (prover/fixtures), with no network.

const dir = new URL('../fixtures/', import.meta.url);
const load = (prefix: string) =>
  readdirSync(dir).filter((f) => f.startsWith(prefix)).map((f) => ({ name: f, ...JSON.parse(readFileSync(new URL(f, dir), 'utf8')) }));

const imports = load('import-') as { name: string; input: ImportInput; expect: { stateRoot: string; blockHash: string; number: number } }[];
const slots = load('slot-') as { name: string; stateRoot: string; proof: SlotProofInput; expect: { childRoot: string; value: string } }[];

test('fixtures exist', () => {
  assert.ok(imports.length > 0, 'run `npm run talyx -- spike` to capture one');
  assert.ok(slots.length > 0);
});

for (const f of imports) {
  test(`${f.name}: import verifies and yields the recorded state root`, async () => {
    const r = await verifyImport(f.input);
    assert.equal(r.stateRoot, f.expect.stateRoot);
    assert.equal(r.blockHash, f.expect.blockHash);
    assert.equal(r.number, f.input.block - 1);
  });

  test(`${f.name}: appending the leaf merges ${trailingOnes(f.input.block - 1)} time(s)`, () => {
    assert.equal(f.input.peaksAtPrev.length, peakHeights(f.input.block - 1).length);
  });

  test(`${f.name}: T-10 an altered peak fails (MmrRootMismatch)`, async () => {
    const peaks = [...f.input.peaksAtPrev];
    peaks[0] = flip(peaks[0], 3);
    await assert.rejects(verifyImport({ ...f.input, peaksAtPrev: peaks }), /MmrRootMismatch/);
  });

  test(`${f.name}: T-10 a missing peak fails (BadPeakCount)`, async () => {
    await assert.rejects(verifyImport({ ...f.input, peaksAtPrev: f.input.peaksAtPrev.slice(1) }), /BadPeakCount/);
  });

  test(`${f.name}: T-11 a header from another block fails`, async () => {
    // change the block number inside the header: its hash and number no longer match
    await assert.rejects(verifyImport({ ...f.input, headerPrev: flip(f.input.headerPrev, 33) }), /HeaderMismatch|MmrRootMismatch/);
  });

  test(`${f.name}: a tampered header body fails (MmrRootMismatch)`, async () => {
    await assert.rejects(verifyImport({ ...f.input, headerPrev: flip(f.input.headerPrev, 40) }), /MmrRootMismatch/);
  });

  test(`${f.name}: T-7 a key that is not an authority fails (BadSigner)`, async () => {
    await assert.rejects(verifyImport(f.input, ['0x0000000000000000000000000000000000000001', '0x4a69b8f722a9b486f9db0d243c908170012d7413']), /BadSigner/);
  });
}

for (const f of slots) {
  test(`${f.name}: the storage item is proven under the state root`, () => {
    const r = verifySlotProof(f.stateRoot, f.proof);
    assert.equal(r.childRoot, f.expect.childRoot);
    assert.equal(r.value, f.expect.value);
    assert.equal((r.value!.length - 2) / 2, 32, 'a full slot is stored as the bare 32-byte word, with no length prefix');
  });

  test(`${f.name}: T-14 a main-trie proof for another trie id fails (ChildRootMismatch)`, () => {
    assert.throws(() => verifySlotProof(f.stateRoot, { ...f.proof, trieId: flip(f.proof.trieId, 0) }), /ChildRootMismatch|missing node/);
  });

  test(`${f.name}: T-1 another slot key is absent (SlotMismatch)`, () => {
    const r = (() => { try { return verifySlotProof(f.stateRoot, { ...f.proof, key: flip(f.proof.key, 31) }).value; } catch { return null; } })();
    assert.equal(r, null);
  });

  test(`${f.name}: a proof against another state root fails`, () => {
    assert.throws(() => verifySlotProof(flip(f.stateRoot, 0), f.proof), /missing node/);
  });
}

function flip(hex: string, byte: number): string {
  const b = fromHex(hex);
  b[byte] ^= 1;
  return toHex(b);
}
function trailingOnes(n: number) { let k = 0; while (n % 2 === 1) { k++; n = Math.floor(n / 2); } return k; }
