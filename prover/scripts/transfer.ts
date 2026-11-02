// Send tPOT on the V3 testnet from a polkadot{.js} keystore file, e.g. to fund the MetaMask account Talyx uses.
// Run it yourself in a terminal: it asks for the keystore password with hidden input and confirms before sending.
//
//   npx tsx scripts/transfer.ts <keystore.json> <destination SS58> <amount in tPOT>

import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { ApiPromise, Keyring, WsProvider } from '@polkadot/api';
import { cryptoWaitReady } from '@polkadot/util-crypto';

const [file, dest, amountText] = process.argv.slice(2);
if (!file || !dest || !amountText) {
  console.log('usage: npx tsx scripts/transfer.ts <keystore.json> <destination SS58> <amount in tPOT>');
  process.exit(2);
}
const DECIMALS = 14n;
const units = (() => {
  const [whole, frac = ''] = amountText.split('.');
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(frac) || frac.length > 14) throw new Error('amount: a number with at most 14 decimals');
  return BigInt(whole) * 10n ** DECIMALS + BigInt(frac.padEnd(14, '0') || '0');
})();
const fmt = (u: bigint) => `${Number(u) / 1e14} tPOT`;

function ask(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      // print the question, swallow the typed characters
      (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
        if (s.includes(question)) process.stdout.write(question);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

await cryptoWaitReady();
const keyring = new Keyring({ type: 'sr25519', ss58Format: 42 });
const pair = keyring.addFromJson(JSON.parse(readFileSync(file, 'utf8')));
try {
  pair.decodePkcs8(await ask(`Password for ${pair.meta.name ?? pair.address}: `, true));
} catch {
  console.error('Wrong password; nothing was sent.');
  process.exit(1);
}

const api = await ApiPromise.create({ provider: new WsProvider(process.env.TALYX_V3_WS ?? 'wss://test-node-v3.portaldot.dev'), noInitWarn: true });
const free = async (who: string) => ((await api.query.system.account(who)) as unknown as { data: { free: { toBigInt(): bigint } } }).data.free.toBigInt();
const tx = api.tx.balances.transferKeepAlive(dest, units);
const fee = (await tx.paymentInfo(pair)).partialFee.toBigInt();

console.log(`\nFrom    ${pair.address}  (has ${fmt(await free(pair.address))})`);
console.log(`To      ${dest}  (has ${fmt(await free(dest))})`);
console.log(`Amount  ${fmt(units)}, fee about ${fmt(fee)}`);
if ((await ask('Send it? Type y to confirm: ')).trim().toLowerCase() !== 'y') {
  console.log('Cancelled; nothing was sent.');
  await api.disconnect();
  process.exit(0);
}

await new Promise<void>((resolve, reject) => {
  tx.signAndSend(pair, ({ status, dispatchError }) => {
    if (dispatchError) {
      const msg = dispatchError.isModule ? (() => { const m = api.registry.findMetaError(dispatchError.asModule); return `${m.section}.${m.name}`; })() : dispatchError.toString();
      reject(new Error(`the transfer failed: ${msg}`));
    } else if (status.isInBlock) {
      console.log(`In block ${status.asInBlock.toHex()}`);
      resolve();
    }
  }).catch(reject);
});
console.log(`Destination now has ${fmt(await free(dest))}`);
await api.disconnect();
