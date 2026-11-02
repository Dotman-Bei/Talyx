import { useEffect, useState, useSyncExternalStore } from 'react';
import { STAGE_LABEL, type Stage } from './orders';
import type { ActionState } from './useAction';

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function Addr({ value }: { value?: string }) {
  if (!value) return <span className="dash">–</span>;
  return <code title={value}>{shortAddr(value)}</code>;
}

const PILL: Record<Stage, string> = {
  open: 'pill--plain', filled: 'pill--wait', signed: 'pill--wait', claimed: 'pill--ok',
  expired: 'pill--plain', refundable: 'pill--bad', refunded: 'pill--plain',
};
export function StagePill({ stage }: { stage: Stage }) {
  return <span className={`pill ${PILL[stage]}`}>{STAGE_LABEL[stage]}</span>;
}

export const fmtBlock = (n?: number) => (n ? n.toLocaleString('en-US') : '–');

/** Re-render every second, for countdowns and "ago" stamps. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/* ---------- hash routes: #/orders, #/orders/7, #/orders/new, #/fill, #/blocks ---------- */
const hashListeners = new Set<() => void>();
window.addEventListener('hashchange', () => hashListeners.forEach((l) => l()));
export function useRoute(): string[] {
  const hash = useSyncExternalStore((l) => { hashListeners.add(l); return () => hashListeners.delete(l); }, () => location.hash);
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return parts.length ? parts : ['orders'];
}
export const go = (path: string) => { location.hash = path; };

/* ---------- 16px outline icons, one set ---------- */
export function Icon({ name }: { name: 'orders' | 'fill' | 'blocks' | 'menu' | 'close' | 'back' }) {
  const paths: Record<string, string> = {
    orders: 'M3 3.5h10M3 8h10M3 12.5h6',
    fill: 'M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10',
    blocks: 'M2.5 4h4.5v4H2.5zM9 4h4.5v4H9zM5.75 10h4.5v4h-4.5z',
    menu: 'M2.5 4.5h11M2.5 8h11M2.5 11.5h11',
    close: 'M4 4l8 8M12 4l-8 8',
    back: 'M9.5 3.5 5 8l4.5 4.5',
  };
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d={paths[name]} /></svg>
  );
}

export function Mark() {
  return (
    <svg viewBox="0 0 28 20" aria-hidden="true">
      <path d="M0 0h28v9H18l-3-3-3 3H0z" fill="var(--mint)" />
      <path d="M0 11h12l3 3 3-3h10v9H0z" fill="var(--pink)" />
    </svg>
  );
}

/* ---------- transactions ---------- */

export function TxLink({ hash, chain }: { hash?: string; chain?: 'sepolia' | 'v3' }) {
  if (!hash) return <span className="dash">–</span>;
  const label = `${hash.slice(0, 10)}…${hash.slice(-4)}`;
  if (chain === 'sepolia') return <a className="txlink" href={`https://sepolia.etherscan.io/tx/${hash}`} target="_blank" rel="noreferrer"><code>{label}</code></a>;
  return <code title={`${hash} (Portaldot V3: look the block up on node-console.portaldot.dev)`}>{label}</code>;
}

/** What a transaction is doing, how it ended, and its hash. */
export function TxStatus({ state }: { state: ActionState }) {
  if (state.busy) return <p className="txs" role="status"><i className="spinner" aria-hidden="true" />{state.busy}</p>;
  if (state.error) return <p className="txs txs--bad" role="alert">{state.error}</p>;
  if (state.done) return <p className="txs txs--ok" role="status">{state.done.text}{state.done.tx && <> <TxLink hash={state.done.tx} chain={state.done.chain} /></>}</p>;
  return null;
}
