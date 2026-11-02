import { readFileSync } from 'node:fs';
import {
  createPublicClient, createWalletClient, defineChain, http, type Abi, type Address, type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

// EVM side: Sepolia (escrow, state roots) and Portaldot V3's Revive EVM (FillBook). Contract ABIs and bytecode come
// from the Foundry build in ../contracts/out, so run `forge build` there first.

export const v3Evm = defineChain({
  id: 420420777,
  name: 'Portaldot V3 testnet',
  nativeCurrency: { name: 'tPOT', symbol: 'tPOT', decimals: 18 }, // Revive counts in 18 decimals (NativeToEthRatio 10,000)
  rpcUrls: { default: { http: [process.env.TALYX_V3_EVM_RPC ?? 'https://test-evm-rpc-v3.portaldot.dev'] } },
});

const SEPOLIA_RPC = process.env.TALYX_SEPOLIA_RPC ?? 'https://ethereum-sepolia-rpc.publicnode.com';

export const sepoliaPublic = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC) });
export const v3Public = createPublicClient({ chain: v3Evm, transport: http() });

export function account() {
  const key = process.env.TALYX_PRIVATE_KEY as Hex | undefined;
  if (!key) throw new Error('set TALYX_PRIVATE_KEY (a funded testnet key) in prover/.env or the environment');
  return privateKeyToAccount(key);
}
export const sepoliaWallet = () => createWalletClient({ account: account(), chain: sepolia, transport: http(SEPOLIA_RPC) });
export const v3Wallet = () => createWalletClient({ account: account(), chain: v3Evm, transport: http() });

export function artifact(name: 'BeefyStateRoots' | 'TalyxEscrow' | 'FillBook'): { abi: Abi; bytecode: Hex } {
  const path = new URL(`../../contracts/out/${name}.sol/${name}.json`, import.meta.url);
  let raw: string;
  try { raw = readFileSync(path, 'utf8'); } catch { throw new Error(`no build of ${name}: run \`forge build\` in contracts/`); }
  const j = JSON.parse(raw);
  return { abi: j.abi, bytecode: j.bytecode.object };
}

export function addressFromEnv(name: 'TALYX_ESCROW' | 'TALYX_STATE_ROOTS' | 'TALYX_FILLBOOK'): Address {
  const v = process.env[name];
  if (!v || !/^0x[0-9a-fA-F]{40}$/.test(v)) throw new Error(`set ${name} to the deployed contract address`);
  return v as Address;
}

export interface OrderView {
  requester: Address; v3Recipient: Address; amountV3Wei: bigint; price: bigint; deadline: bigint; status: number;
}
export async function readOrder(escrow: Address, id: bigint): Promise<OrderView> {
  const { abi } = artifact('TalyxEscrow');
  const [requester, v3Recipient, amountV3Wei, price, deadline, status] = (await sepoliaPublic.readContract({
    address: escrow, abi, functionName: 'orders', args: [id],
  })) as [Address, Address, bigint, bigint, bigint, number];
  if (status === 0) throw new Error(`order ${id} does not exist on ${escrow}`);
  return { requester, v3Recipient, amountV3Wei, price, deadline, status };
}
