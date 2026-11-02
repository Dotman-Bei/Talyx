import { useEffect, useRef, useState } from 'react';
import { PREVIEW, ago, amountError, clock, createOrder, isAddress, nextStep, priceFor, stageOf, useOrders, type Order, type Stage } from '../orders';
import { nextJustified, useV3, type V3State } from '../v3';
import { useWallet } from '../wallet';
import { Addr, StagePill, go, shortAddr, useNow } from '../ui';

const TABS: { id: string; label: string; stages: Stage[] | null }[] = [
  { id: 'all', label: 'All', stages: null },
  { id: 'open', label: 'Open', stages: ['open', 'expired'] },
  { id: 'filled', label: 'Filled', stages: ['filled', 'signed'] },
  { id: 'claimed', label: 'Claimed', stages: ['claimed'] },
  { id: 'refunds', label: 'Refunds', stages: ['refundable', 'refunded'] },
];

/** The one fact on this screen that most needs attention, as a sentence. */
function finding(orders: Order[], now: number, v3: V3State): string {
  const filled = orders.find((o) => stageOf(o, now) === 'filled');
  if (filled) {
    const next = nextJustified(v3);
    return next
      ? `Order ${filled.id} is filled and waiting for V3’s next signed block, about ${next.seconds} s away.`
      : `Order ${filled.id} is filled and waiting for V3’s next signed block.`;
  }
  const signed = orders.find((o) => stageOf(o, now) === 'signed');
  if (signed) return `Order ${signed.id} is signed by both BEEFY keys and ready to claim.`;
  const refundable = orders.find((o) => stageOf(o, now) === 'refundable');
  if (refundable) return `Order ${refundable.id} passed its claim window unfilled; its ${refundable.price} ETH can be refunded.`;
  const open = orders.filter((o) => stageOf(o, now) === 'open').length;
  return open ? `${open} ${open === 1 ? 'order is' : 'orders are'} waiting for a filler.` : 'Every order is settled.';
}

export function Orders({ creating }: { creating: boolean }) {
  const orders = useOrders();
  const v3 = useV3();
  const now = useNow();
  const [tab, setTab] = useState('all');

  const counts = Object.fromEntries(TABS.map((t) => [t.id, t.stages ? orders.filter((o) => t.stages!.includes(stageOf(o, now))).length : orders.length]));
  const current = TABS.find((t) => t.id === tab)!;
  const rows = orders
    .filter((o) => !current.stages || current.stages.includes(stageOf(o, now)))
    .sort((a, b) => b.createdAt - a.createdAt);

  return (
    <>
      <div className="title-row">
        <div>
          <h1>Orders</h1>
          <p className="sub">{finding(orders, now, v3)}</p>
        </div>
        <a className="btn btn--primary" href="#/orders/new">New order</a>
      </div>
      {PREVIEW && (
        <p className="notice" role="note">Preview: the contracts aren’t deployed yet, so these orders are samples and transactions are simulated. V3 block data is live.</p>
      )}

      {creating && <NewOrder />}

      <div className="tabs" role="tablist" aria-label="Filter orders">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}<span>{counts[t.id]}</span>
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="empty" style={{ marginTop: 16 }}>No {current.label.toLowerCase()} orders right now.</p>
      ) : (
        <>
          <table className="table wide-only">
            <thead>
              <tr>
                <th>Order</th><th className="r">Deliver</th><th>To on V3</th><th className="r">Escrow</th><th>Deadline</th><th>Status</th><th>Next step</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} onClick={() => go(`/orders/${o.id}`)}>
                  <td className="id"><a href={`#/orders/${o.id}`}>Order {o.id}</a><small>{ago(o.createdAt, now)}</small></td>
                  <td className="r">{o.amount} <span className="unit">tPOT</span></td>
                  <td><Addr value={o.recipient} /></td>
                  <td className="r">{o.price} <span className="unit">ETH</span></td>
                  <td>{clock(o.deadline)}</td>
                  <td><StagePill stage={stageOf(o, now)} /></td>
                  <td className="muted">{nextStep(o, now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="mlist" aria-label="Orders">
            {rows.map((o) => (
              <li key={o.id}>
                <a href={`#/orders/${o.id}`}>
                  <span className="line1"><b>Order {o.id} · {o.amount} tPOT</b></span>
                  <span className="sub">{nextStep(o, now)} · to {shortAddr(o.recipient)}</span>
                  <span className="end"><StagePill stage={stageOf(o, now)} /></span>
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function NewOrder() {
  const wallet = useWallet();
  const params = new URLSearchParams(location.search);
  const [to, setTo] = useState(params.get('to') ?? wallet.address ?? '');
  const [amount, setAmount] = useState(params.get('amount') ?? '0.5');
  const [price, setPrice] = useState(priceFor(params.get('amount') ?? '0.5'));
  const [minutes, setMinutes] = useState(60);
  const [touched, setTouched] = useState(false);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toError = touched && !isAddress(to) ? 'Enter a full 0x address, 42 characters' : null;
  const amtError = touched ? amountError(amount) : null;
  const priceError = touched && !(Number(price) > 0) ? 'Enter the ETH you will escrow' : null;

  function close() { history.replaceState(null, '', location.pathname + '#/orders'); dispatchEvent(new HashChangeEvent('hashchange')); }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!isAddress(to) || amountError(amount) || !(Number(price) > 0)) return;
    const o = createOrder({ requester: wallet.address ?? to, recipient: to.trim(), amount: amount.trim(), price, minutes });
    history.replaceState(null, '', location.pathname + `#/orders/${o.id}`);
    dispatchEvent(new HashChangeEvent('hashchange'));
  }

  return (
    <form className="panel neworder" aria-labelledby="new-title" onSubmit={submit} noValidate>
        <header><h2 id="new-title">New order</h2><span className="meta">You sign createOrder on Sepolia</span></header>
        <div className="neworder__fields">
        <div className="field">
          <label htmlFor="no-to">Deliver to on V3</label>
          <input ref={first} id="no-to" className="input mono" value={to} onChange={(e) => setTo(e.target.value)} spellCheck={false} autoComplete="off"
            aria-invalid={!!toError} aria-describedby="no-to-help" placeholder="0x…" />
          <p className={toError ? 'error' : 'help'} id="no-to-help">{toError ?? 'Your MetaMask address works: it is the same on Sepolia and on V3.'}</p>
        </div>
        <div className="field">
          <label htmlFor="no-amount">Amount</label>
          <input id="no-amount" className="input num" inputMode="decimal" value={amount}
            onChange={(e) => { setAmount(e.target.value); setPrice(priceFor(e.target.value)); }}
            aria-invalid={!!amtError} aria-describedby="no-amount-help" />
          <p className={amtError ? 'error' : 'help'} id="no-amount-help">{amtError ?? 'In tPOT, up to 14 decimals.'}</p>
        </div>
        <div className="field">
          <label htmlFor="no-price">Escrow</label>
          <input id="no-price" className="input num" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} aria-invalid={!!priceError} aria-describedby="no-price-help" />
          <p className={priceError ? 'error' : 'help'} id="no-price-help">{priceError ?? 'In Sepolia ETH. The filler is paid this once V3’s proof checks out.'}</p>
        </div>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend>Deadline</legend>
          <div className="seg">
            {[15, 60, 180].map((m) => (
              <label key={m}><input type="radio" name="deadline" checked={minutes === m} onChange={() => setMinutes(m)} /><span>{m < 60 ? `${m} min` : `${m / 60} h`}</span></label>
            ))}
          </div>
        </fieldset>
        </div>
        <p className="modal__terms">If nobody fills it by {clock(Date.now() + minutes * 60_000)}, you can take your <b>{price || '0'} ETH</b> back 30 minutes later.</p>
        <div className="modal__actions">
          <button type="button" className="btn btn--secondary" onClick={close}>Cancel</button>
          <button type="submit" className="btn btn--primary">{PREVIEW ? 'Post order (simulated)' : 'Post order'}</button>
        </div>
    </form>
  );
}
