import { useState } from 'react';
import { PREVIEW, clock, fillOrder, isAddress, stageOf, useOrders } from '../orders';
import { useV3 } from '../v3';
import { useWallet } from '../wallet';
import { Addr, go, shortAddr, useNow } from '../ui';

export function FillQueue() {
  const orders = useOrders();
  const wallet = useWallet();
  const v3 = useV3();
  const now = useNow();
  const [payee, setPayee] = useState(wallet.address ?? '');
  const [touched, setTouched] = useState(false);

  const open = orders.filter((o) => stageOf(o, now) === 'open').sort((a, b) => a.deadline - b.deadline);
  const need = open.reduce((s, o) => s + Number(o.amount), 0);
  const earn = open.reduce((s, o) => s + Number(o.price), 0);
  const payeeOk = isAddress(payee);

  function fill(id: number) {
    setTouched(true);
    if (!payeeOk) return;
    const filler = wallet.address ?? payee;
    fillOrder(id, { filler, payee: payee.trim(), block: v3.best ?? 0, at: Date.now() });
    go(`/orders/${id}`);
  }

  return (
    <>
      <div className="title-row">
        <div>
          <h1>Fill</h1>
          <p className="sub">
            {open.length
              ? <>{open.length} {open.length === 1 ? 'order is' : 'orders are'} open. Filling all of them takes <b>{trim(need)} tPOT</b> on V3 and pays <b>{trim(earn)} ETH</b> on Sepolia.</>
              : 'No orders are open right now. New ones appear here as requesters post them.'}
          </p>
        </div>
      </div>
      {PREVIEW && <p className="notice" role="note">Preview: fills are simulated, but each one takes the current V3 block and waits for a real BEEFY signature.</p>}

        <section className="panel" aria-labelledby="queue-title">
          <header><h2 id="queue-title">Open orders</h2><span className="meta">Soonest deadline first</span></header>
          <div className="field" style={{ maxWidth: 520, marginBottom: 16 }}>
            <label htmlFor="payee">Pay me on Sepolia at</label>
            <input id="payee" className="input mono" value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="0x…" spellCheck={false}
              aria-invalid={touched && !payeeOk} aria-describedby="payee-help" />
            <p id="payee-help" className={touched && !payeeOk ? 'error' : 'help'}>
              {touched && !payeeOk ? 'Enter a full 0x address, 42 characters.' : 'FillBook writes this payee into the fill record. Only it can be paid.'}
            </p>
          </div>
          {open.length === 0 ? (
            <p className="empty">Nothing to fill. Every order is filled, settled or past its deadline.</p>
          ) : (
            <>
              <table className="table wide-only">
                <thead><tr><th>Order</th><th className="r">Send on V3</th><th>To</th><th className="r">Earn</th><th>Deadline</th><th className="r"><span className="sr-only">Action</span></th></tr></thead>
                <tbody>
                  {open.map((o) => (
                    <tr key={o.id} onClick={(e) => (e.target as HTMLElement).closest('button') || go(`/orders/${o.id}`)}>
                      <td className="id"><a href={`#/orders/${o.id}`}>Order {o.id}</a></td>
                      <td className="r">{o.amount} <span className="unit">tPOT</span></td>
                      <td><Addr value={o.recipient} /></td>
                      <td className="r">{o.price} <span className="unit">ETH</span></td>
                      <td>{clock(o.deadline)} <span className="unit">· {Math.max(0, Math.round((o.deadline - now) / 60_000))} min left</span></td>
                      <td className="r"><button className="btn btn--ghost btn--sm" onClick={() => fill(o.id)}>Fill</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ul className="mlist" aria-label="Open orders">
                {open.map((o) => (
                  <li key={o.id}>
                    <span className="line1"><b>Order {o.id} · {o.amount} tPOT</b></span>
                    <span className="sub">Earn {o.price} ETH · to {shortAddr(o.recipient)} · by {clock(o.deadline)}</span>
                    <span className="end"><button className="btn btn--ghost btn--sm" onClick={() => fill(o.id)}>Fill</button></span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
    </>
  );
}

const trim = (n: number) => String(Number(n.toFixed(6)));
