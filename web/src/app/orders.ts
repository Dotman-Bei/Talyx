import { useSyncExternalStore } from 'react';

// Orders as the demo shows them. Until the contracts are deployed (VITE_ESCROW_ADDRESS and friends), the app runs
// in preview: sample orders below, and transactions are simulated in the browser. V3 block data stays live.

export const CONTRACTS = {
  escrow: import.meta.env.VITE_ESCROW_ADDRESS as string | undefined,
  stateRoots: import.meta.env.VITE_STATE_ROOTS_ADDRESS as string | undefined,
  fillBook: import.meta.env.VITE_FILLBOOK_ADDRESS as string | undefined,
};
export const PREVIEW = !CONTRACTS.escrow || !CONTRACTS.stateRoots || !CONTRACTS.fillBook;

export const CLAIM_WINDOW_MS = 30 * 60 * 1000;
export const ETH_PER_TPOT = 0.0002;

export interface Fill { filler: string; payee: string; block: number; at: number }
export interface Signed { block: number; setId: number }
export interface Order {
  id: number;
  requester: string;
  recipient: string; // H160 on V3
  amount: string; // tPOT, up to 14 decimals
  price: string; // ETH escrowed
  createdAt: number;
  deadline: number;
  fill?: Fill;
  signed?: Signed; // first stored BEEFY justification B with B-1 >= the fill block
  claimedAt?: number;
  refundedAt?: number;
  simulated: boolean;
}

export type Stage = 'open' | 'filled' | 'signed' | 'claimed' | 'refundable' | 'refunded' | 'expired';

export function stageOf(o: Order, now = Date.now()): Stage {
  if (o.refundedAt) return 'refunded';
  if (o.claimedAt) return 'claimed';
  if (o.fill && o.fill.at > o.deadline) return now > o.deadline + CLAIM_WINDOW_MS ? 'refundable' : 'expired';
  if (o.signed) return 'signed';
  if (o.fill) return 'filled';
  if (now > o.deadline + CLAIM_WINDOW_MS) return 'refundable';
  if (now > o.deadline) return 'expired';
  return 'open';
}

export const STAGE_LABEL: Record<Stage, string> = {
  open: 'Open',
  filled: 'Filled',
  signed: 'Signed',
  claimed: 'Claimed',
  expired: 'Past deadline',
  refundable: 'Refund open',
  refunded: 'Refunded',
};

/** What the order is waiting for, in the words of the trade. */
export function nextStep(o: Order, now = Date.now()): string {
  switch (stageOf(o, now)) {
    case 'open': return 'Waiting for a filler';
    case 'filled': return 'Waiting for V3 to sign';
    case 'signed': return 'Ready to claim';
    case 'claimed': return 'Settled';
    case 'expired': return `Refund opens ${clock(o.deadline + CLAIM_WINDOW_MS)}`;
    case 'refundable': return 'Ready to refund';
    case 'refunded': return 'ETH returned';
  }
}

export const clock = (t: number) =>
  new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';

export function ago(t: number, now = Date.now()) {
  const s = Math.round((now - t) / 1000);
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

/** tPOT amounts must divide by 10^4 EVM units, i.e. have at most 14 decimals. */
export function amountError(v: string): string | null {
  if (!/^\d+(\.\d+)?$/.test(v.trim())) return 'Enter an amount such as 0.5';
  const [, dec = ''] = v.trim().split('.');
  if (dec.length > 14) return 'tPOT has 14 decimals; this amount has more';
  if (Number(v) <= 0) return 'The amount must be more than 0';
  return null;
}
export const isAddress = (v: string) => /^0x[0-9a-fA-F]{40}$/.test(v.trim());
export const priceFor = (amount: string) => {
  const p = Number(amount) * ETH_PER_TPOT;
  return Number.isFinite(p) ? p.toFixed(6).replace(/0+$/, '').replace(/\.$/, '') : '0';
};

/* ---------- sample orders (preview only; listed in the report as sample data) ---------- */
const MIN = 60_000;
function samples(now: number): Order[] {
  return [
    {
      id: 7, requester: '0x5b1e7d04a2c9f3e86b0d4a17c2e95f38d61a0c47', recipient: '0x3f2a9c4e1b7d8a06f5c2e9b13d4a7f60c81ea91c',
      amount: '0.5', price: '0.0001', createdAt: now - 190 * MIN, deadline: now - 130 * MIN,
      fill: { filler: '0x8c41f2e6a09b3d7c5e1f84a2b6d9c03e7a5102be', payee: '0x8c41f2e6a09b3d7c5e1f84a2b6d9c03e7a5102be', block: 285190, at: now - 186 * MIN },
      signed: { block: 285197, setId: 480 }, claimedAt: now - 183 * MIN, simulated: true,
    },
    {
      id: 8, requester: '0x5b1e7d04a2c9f3e86b0d4a17c2e95f38d61a0c47', recipient: '0x3f2a9c4e1b7d8a06f5c2e9b13d4a7f60c81ea91c',
      amount: '1', price: '0.0002', createdAt: now - 150 * MIN, deadline: now - 120 * MIN, refundedAt: now - 85 * MIN, simulated: true,
    },
    {
      id: 9, requester: '0xa71c3e5d9f02b84e6c1d7a39f5e208b4c6d3e1f0', recipient: '0xa71c3e5d9f02b84e6c1d7a39f5e208b4c6d3e1f0',
      amount: '0.25', price: '0.00005', createdAt: now - 3 * MIN, deadline: now + 57 * MIN,
      fill: { filler: '0x2e90b5c7d1a4f63e8b0c9d2a5f7e1b34c6d8a0f5', payee: '0x2e90b5c7d1a4f63e8b0c9d2a5f7e1b34c6d8a0f5', block: 0, at: now - 20_000 },
      simulated: true,
    },
    {
      id: 10, requester: '0x5b1e7d04a2c9f3e86b0d4a17c2e95f38d61a0c47', recipient: '0x3f2a9c4e1b7d8a06f5c2e9b13d4a7f60c81ea91c',
      amount: '2', price: '0.0004', createdAt: now - 9 * MIN, deadline: now + 51 * MIN, simulated: true,
    },
    {
      id: 11, requester: '0xd04f6b2a8e1c5d93f7a0b6e4c2d8f1a39e5b7c06', recipient: '0xd04f6b2a8e1c5d93f7a0b6e4c2d8f1a39e5b7c06',
      amount: '0.5', price: '0.0001', createdAt: now - 14 * MIN, deadline: now + 16 * MIN, simulated: true,
    },
    {
      id: 6, requester: '0xa71c3e5d9f02b84e6c1d7a39f5e208b4c6d3e1f0', recipient: '0xa71c3e5d9f02b84e6c1d7a39f5e208b4c6d3e1f0',
      amount: '0.1', price: '0.00002', createdAt: now - 70 * MIN, deadline: now - 40 * MIN, simulated: true,
    },
  ];
}

/* ---------- the store ---------- */
let orders: Order[] = samples(Date.now());
const listeners = new Set<() => void>();
const emit = () => { orders = [...orders]; listeners.forEach((l) => l()); };

export function useOrders(): Order[] {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => orders);
}
export const getOrder = (id: number) => orders.find((o) => o.id === id);

export function createOrder(input: { requester: string; recipient: string; amount: string; price: string; minutes: number }): Order {
  const now = Date.now();
  const o: Order = {
    id: Math.max(...orders.map((x) => x.id)) + 1,
    requester: input.requester, recipient: input.recipient, amount: input.amount, price: input.price,
    createdAt: now, deadline: now + input.minutes * MIN, simulated: true,
  };
  orders.unshift(o);
  emit();
  return o;
}

function update(id: number, patch: Partial<Order>) {
  const i = orders.findIndex((o) => o.id === id);
  if (i < 0) return;
  orders[i] = { ...orders[i], ...patch };
  emit();
}

export const fillOrder = (id: number, fill: Fill) => update(id, { fill });
export const claimOrder = (id: number) => update(id, { claimedAt: Date.now() });
export const refundOrder = (id: number) => update(id, { refundedAt: Date.now() });

/**
 * Tie preview fills to the live chain: a fill with no block takes the current V3 head, and a filled order becomes
 * "signed" once a stored BEEFY justification for a later block has been seen (the proof reads the state root of B-1).
 */
export function syncWithV3(best: number | undefined, justified: { number: number; setId: number }[]) {
  let changed = false;
  orders = orders.map((o) => {
    if (!o.fill || o.signed || o.claimedAt) return o;
    let next = o;
    if (!o.fill.block && best) { next = { ...next, fill: { ...o.fill, block: best - 2 } }; changed = true; }
    const j = next.fill!.block ? [...justified].reverse().find((x) => x.number > next.fill!.block) : undefined;
    if (j) { next = { ...next, signed: { block: j.number, setId: j.setId } }; changed = true; }
    return next;
  });
  if (changed) emit();
}
