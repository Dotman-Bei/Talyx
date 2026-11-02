import { useSyncExternalStore } from 'react';

// MetaMask through the injected EIP-1193 provider. The same 0x address receives on V3 (chain 420420777).

export const SEPOLIA = { id: 11155111, hex: '0xaa36a7', name: 'Sepolia' };
export const V3 = { id: 420420777, hex: '0x190f1ca9', name: 'Portaldot V3' };

type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown>; on?: (e: string, f: (x: unknown) => void) => void };
const eth = () => (window as unknown as { ethereum?: Eip1193 }).ethereum;

export interface WalletState { available: boolean; address?: string; chainId?: number; error?: string; busy: boolean }
let state: WalletState = { available: false, busy: false };
const listeners = new Set<() => void>();
const set = (p: Partial<WalletState>) => { state = { ...state, ...p }; listeners.forEach((l) => l()); };

let started = false;
function start() {
  if (started) return;
  started = true;
  const p = eth();
  if (!p) return;
  set({ available: true });
  p.request({ method: 'eth_accounts' }).then((a) => set({ address: (a as string[])[0] })).catch(() => {});
  p.request({ method: 'eth_chainId' }).then((c) => set({ chainId: parseInt(c as string, 16) })).catch(() => {});
  p.on?.('accountsChanged', (a) => set({ address: (a as string[])[0] }));
  p.on?.('chainChanged', (c) => set({ chainId: parseInt(c as string, 16) }));
}

export function useWallet(): WalletState {
  start();
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state);
}

export async function connect() {
  const p = eth();
  if (!p) { set({ error: 'No browser wallet found. Install MetaMask to sign on Sepolia.' }); return; }
  set({ busy: true, error: undefined });
  try {
    const a = (await p.request({ method: 'eth_requestAccounts' })) as string[];
    set({ address: a[0] });
  } catch (e) {
    set({ error: (e as { message?: string }).message ?? 'The wallet refused the request.' });
  } finally {
    set({ busy: false });
  }
}

export const chainName = (id?: number) => (id === SEPOLIA.id ? SEPOLIA.name : id === V3.id ? V3.name : id ? `Chain ${id}` : '');
