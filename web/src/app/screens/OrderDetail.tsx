import { useState } from 'react';
import { encodeAbiParameters, keccak256 } from 'viem';
import {
  CLAIM_WINDOW_MS, CONTRACTS, PREVIEW, claimOrder, clock, fillOrder, refundOrder, stageOf, useOrders, type Order, type Stage,
} from '../orders';
import { nextJustified, useV3 } from '../v3';
import { useWallet } from '../wallet';
import { Addr, StagePill, fmtBlock, useNow } from '../ui';

const SAMPLE_FILLER = '0x2e90b5c7d1a4f63e8b0c9d2a5f7e1b34c6d8a0f5';

export function OrderDetail({ id }: { id: number }) {
  const orders = useOrders();
  const o = orders.find((x) => x.id === id);
  const now = useNow();
  const v3 = useV3();
  const wallet = useWallet();
  const [forged, setForged] = useState(false);

  if (!o) {
    return (
      <>
        <p className="crumb"><a href="#/orders">Orders</a> /</p>
        <div className="title-row"><div><h1>Order {id}</h1><p className="sub">There is no order {id} on this escrow.</p></div></div>
        <a className="link-btn" href="#/orders">Back to all orders</a>
      </>
    );
  }

  const stage = stageOf(o, now);
  const next = nextJustified(v3);

  let sub: string;
  let action: { label: string; run?: () => void; reason?: string } | null = null;
  switch (stage) {
    case 'open':
      sub = `Waiting for a filler to send ${o.amount} tPOT to this address on V3 before ${clock(o.deadline)}.`;
      action = {
        label: PREVIEW ? 'Fill on V3 (simulated)' : 'Fill on V3',
        run: () => fillOrder(o.id, { filler: wallet.address ?? SAMPLE_FILLER, payee: wallet.address ?? SAMPLE_FILLER, block: v3.best ? v3.best : 0, at: Date.now() }),
      };
      break;
    case 'filled':
      sub = o.fill?.block
        ? `Filled on V3 in block ${fmtBlock(o.fill.block)}. ${next ? `The next signed block is expected in about ${next.seconds} s.` : 'Waiting for the next signed block.'}`
        : 'Filled on V3. Waiting for the V3 node to report the block.';
      action = { label: 'Import and claim', reason: 'Waiting for V3 to sign a block after the fill' };
      break;
    case 'signed':
      sub = `V3’s two BEEFY keys signed block ${fmtBlock(o.signed!.block)}, which holds the fill. The filler can be paid now.`;
      action = { label: PREVIEW ? 'Import and claim (simulated)' : 'Import and claim', run: () => claimOrder(o.id) };
      break;
    case 'claimed':
      sub = `Settled: ${o.price} ETH paid to the payee recorded on V3, after the proof checked out.`;
      break;
    case 'expired':
      sub = `Nobody filled it before ${clock(o.deadline)}. The refund opens after the 30-minute claim window.`;
      action = { label: 'Refund', reason: `Refund opens ${clock(o.deadline + CLAIM_WINDOW_MS)}` };
      break;
    case 'refundable':
      sub = `Nobody filled it in time, and the claim window has closed. The requester can take the ${o.price} ETH back.`;
      action = { label: PREVIEW ? 'Refund (simulated)' : 'Refund', run: () => refundOrder(o.id) };
      break;
    case 'refunded':
      sub = `Refunded: ${o.price} ETH went back to the requester. No claim can be made now.`;
      break;
  }

  const seam = forged ? 'forged' : stage === 'signed' || stage === 'claimed' ? 'fits' : 'waiting';
  const orderKey = CONTRACTS.escrow
    ? keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'address' }, { type: 'uint256' }], [11155111n, CONTRACTS.escrow as `0x${string}`, BigInt(o.id)]))
    : undefined;

  return (
    <>
      <p className="crumb"><a href="#/orders">Orders</a> /</p>
      <div className="title-row">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>Order {o.id} <StagePill stage={stage} /></h1>
          <p className="sub">{sub}</p>
        </div>
        {action && (
          <div className="title-actions">
            <button className="btn btn--primary" onClick={action.run} disabled={!action.run} aria-describedby={action.reason ? 'action-reason' : undefined}>{action.label}</button>
            {!action.run && action.reason && <small className="muted" id="action-reason">{action.reason}</small>}
          </div>
        )}
      </div>
      {PREVIEW && o.simulated && <p className="notice" role="note">Preview: this is a sample order and its transactions are simulated. Block numbers and signatures for new fills come from the live V3 chain.</p>}

      <section className="tally" aria-label="The two halves of this order">
        <div className="half half--sepolia">
          <header><i className="dot dot--sepolia" />Sepolia half<small>TalyxEscrow</small></header>
          <dl className="kv">
            <div><dt>Requester</dt><dd><Addr value={o.requester} /></dd></div>
            <div><dt>Deliver</dt><dd className="num">{o.amount} <span className="unit">tPOT</span></dd></div>
            <div><dt>To on V3</dt><dd><Addr value={o.recipient} /></dd></div>
            <div><dt>Escrow</dt><dd className="num">{o.price} <span className="unit">ETH</span></dd></div>
            <div><dt>Deadline</dt><dd className="num">{clock(o.deadline)}</dd></div>
            <div><dt>Order key</dt><dd>{orderKey ? <Addr value={orderKey} /> : <span className="dash" title="Computed once the escrow is deployed">–</span>}</dd></div>
          </dl>
        </div>
        <div className={`seam seam--${seam}`} aria-hidden="true">
          <svg className="seam__v" viewBox="0 0 28 400" preserveAspectRatio="none"><path d="M14 0 L14 60 L6 76 L14 92 L14 170 L22 186 L14 202 L14 280 L6 296 L14 312 L14 400" /></svg>
          <svg className="seam__h" viewBox="0 0 400 24" preserveAspectRatio="none"><path d="M0 12 L60 12 L76 4 L92 12 L170 12 L186 20 L202 12 L280 12 L296 4 L312 12 L400 12" /></svg>
        </div>
        <div className="half half--v3">
          <header><i className="dot dot--v3" />V3 half<small>FillBook</small></header>
          <dl className="kv">
            <div><dt>Filler</dt><dd><Addr value={o.fill?.filler} /></dd></div>
            <div><dt>Payee</dt><dd><Addr value={o.fill?.payee} /></dd></div>
            <div><dt>Sent</dt><dd className="num">{o.fill ? <>{o.amount} <span className="unit">tPOT</span></> : <span className="dash">–</span>}</dd></div>
            <div><dt>Fill block</dt><dd className="num">{o.fill ? fmtBlock(o.fill.block) : <span className="dash">–</span>}</dd></div>
            <div><dt>Fill time</dt><dd className="num">{o.fill ? clock(o.fill.at) : <span className="dash">–</span>}</dd></div>
            <div><dt>Signed in</dt><dd className="num">{o.signed ? `${fmtBlock(o.signed.block)}, set ${o.signed.setId}` : <span className="dash">–</span>}</dd></div>
          </dl>
        </div>
      </section>
      <p className="fit" aria-live="polite">{fitLine(stage, forged)}</p>

      <div className="grid" style={{ marginTop: 24 }}>
        <section className={`panel ${stage === 'signed' || stage === 'claimed' ? 'span-7' : 'span-12'}`} aria-labelledby="progress-title">
          <header><h2 id="progress-title">Progress</h2><span className="meta">Times in UTC</span></header>
          <Steps o={o} stage={stage} nextSeconds={next?.seconds} nextBlock={next?.block} />
        </section>
        <ForgedProof o={o} stage={stage} onResult={setForged} />
      </div>
    </>
  );
}

function fitLine(stage: Stage, forged: boolean) {
  if (forged) return 'The forged proof does not fit this order. Nothing would be paid.';
  if (stage === 'signed' || stage === 'claimed') return 'The halves fit: the FillBook record matches this order, in a block both BEEFY keys signed.';
  if (stage === 'refunded' || stage === 'refundable' || stage === 'expired') return 'There is no V3 half. Without a fill, no proof can exist.';
  return 'The V3 half is not proven yet.';
}

type StepState = 'done' | 'now' | 'later';
function Steps({ o, stage, nextSeconds, nextBlock }: { o: Order; stage: Stage; nextSeconds?: number; nextBlock?: number }) {
  const rows: { state: StepState; title: string; detail: string; at?: string }[] = [];
  rows.push({ state: 'done', title: 'Order posted on Sepolia', detail: `${o.price} ETH locked in the escrow.`, at: clock(o.createdAt) });

  if (stage === 'refunded' || stage === 'refundable' || stage === 'expired') {
    rows.push({ state: 'done', title: 'Deadline passed unfilled', detail: 'No FillBook record exists for this order.', at: clock(o.deadline) });
    rows.push({
      state: stage === 'refunded' ? 'done' : stage === 'refundable' ? 'now' : 'later',
      title: 'Refunded to the requester',
      detail: stage === 'refunded' ? `${o.price} ETH returned.` : `Opens at ${clock(o.deadline + CLAIM_WINDOW_MS)}, after the claim window.`,
      at: o.refundedAt ? clock(o.refundedAt) : undefined,
    });
    return <StepList rows={rows} />;
  }

  rows.push({
    state: o.fill ? 'done' : 'now',
    title: 'Filled on V3',
    detail: o.fill ? `FillBook sent ${o.amount} tPOT to the recipient${o.fill.block ? ` in block ${fmtBlock(o.fill.block)}` : ''}.` : 'Any wallet with tPOT on V3 can fill it.',
    at: o.fill ? clock(o.fill.at) : undefined,
  });
  rows.push({
    state: o.signed ? 'done' : o.fill ? 'now' : 'later',
    title: 'Signed by both BEEFY keys',
    detail: o.signed
      ? `Stored justification at block ${fmtBlock(o.signed.block)}, validator set ${o.signed.setId}.`
      : o.fill && nextBlock ? `Next stored justification near block ${fmtBlock(nextBlock)}, in about ${nextSeconds} s.` : 'V3 stores one every 8 blocks, about every 48 s.',
  });
  rows.push({
    state: o.claimedAt ? 'done' : o.signed ? 'now' : 'later',
    title: 'State root imported on Sepolia',
    detail: o.signed ? `BeefyStateRoots stores the state root of block ${fmtBlock(o.signed.block - 1)}.` : 'Anyone can submit the import; nobody can forge it.',
  });
  rows.push({
    state: o.claimedAt ? 'done' : 'later',
    title: 'Claimed by the payee',
    detail: o.claimedAt ? `${o.price} ETH paid to the payee recorded on V3.` : 'The escrow pays only the payee written in the FillBook record.',
    at: o.claimedAt ? clock(o.claimedAt) : undefined,
  });
  return <StepList rows={rows} />;
}

function StepList({ rows }: { rows: { state: StepState; title: string; detail: string; at?: string }[] }) {
  return (
    <ol className="steps">
      {rows.map((r) => (
        <li key={r.title} className={`step step--${r.state}`} aria-current={r.state === 'now' ? 'step' : undefined}>
          <span className="step__mark" aria-hidden="true" />
          <div><b>{r.title}</b><p>{r.detail}</p></div>
          {r.at ? <time>{r.at}</time> : <span />}
        </li>
      ))}
    </ol>
  );
}

/* ---------- try a forged proof (prd.md §12, T-1 to T-4 and T-15) ---------- */
const TAMPERS = [
  { id: 'recipient', label: 'Change one byte of the recipient', hint: 'Claim as if the tPOT went to another address.', error: 'SlotMismatch', why: 'The proof now points at a FillBook slot that holds nothing.' },
  { id: 'amount', label: 'Ask for more tPOT than was sent', hint: 'Claim one unit above the amount filled.', error: 'SlotMismatch', why: 'The fill key includes the amount, so the slot is empty.' },
  { id: 'payee', label: 'Pay a different address', hint: 'Keep the proof, change who is paid.', error: 'WordMismatch', why: 'The slot exists but records a different payee.' },
  { id: 'time', label: 'Move the fill time by one second', hint: 'Pretend the fill landed before the deadline.', error: 'WordMismatch', why: 'The recorded timestamp is part of the stored word.' },
  { id: 'block', label: 'Use a block Sepolia never imported', hint: 'Prove against a state root nobody verified.', error: 'UnknownBlock', why: 'BeefyStateRoots has no state root for that block hash.' },
] as const;

function ForgedProof({ o, stage, onResult }: { o: Order; stage: Stage; onResult: (forged: boolean) => void }) {
  const [choice, setChoice] = useState<(typeof TAMPERS)[number]['id']>('recipient');
  const [result, setResult] = useState<(typeof TAMPERS)[number] | 'clean' | null>(null);
  const ready = stage === 'signed' || stage === 'claimed';

  function send(clean: boolean) {
    const r = clean ? 'clean' : TAMPERS.find((t) => t.id === choice)!;
    setResult(r);
    onResult(!clean);
  }

  return (
    <section className={`panel ${ready ? 'span-5' : 'span-12'}`} aria-labelledby="forge-title">
      <header><h2 id="forge-title">Try a forged proof</h2>{PREVIEW && <span className="meta">Simulated</span>}</header>
      {!ready ? (
        <p className="empty">A proof exists once V3 signs a block after the fill. {stage === 'open' ? 'Fill the order first.' : stage === 'filled' ? 'That should take under a minute.' : 'This order was never filled, so there is nothing to forge.'}</p>
      ) : (
        <>
          <fieldset className="tampers">
            <legend className="sr-only">What to change in the claim</legend>
            {TAMPERS.map((t) => (
              <label key={t.id} className="tamper">
                <input type="radio" name="tamper" checked={choice === t.id} onChange={() => { setChoice(t.id); setResult(null); onResult(false); }} />
                <span title={t.hint}>{t.label}</span>
              </label>
            ))}
          </fieldset>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn--ghost" onClick={() => send(false)}>Send as eth_call</button>
            <button className="btn btn--secondary" onClick={() => send(true)}>Send the real proof</button>
          </div>
          {result && (
            <div className={`result ${result === 'clean' ? 'result--ok' : 'result--bad'}`} role="status">
              {result === 'clean' ? (
                <><b>Would succeed</b>The unchanged proof pays {o.price} ETH to <Addr value={o.fill?.payee} />.{stage === 'claimed' && ' This order is already claimed, so a real send reverts with NotOpen.'}</>
              ) : (
                <><b>Reverted: <code>{result.error}</code></b>{result.why} Nothing is paid.</>
              )}
            </div>
          )}
          {PREVIEW && <p className="help" style={{ marginTop: 12 }}>Once deployed, this sends <code>eth_call</code> to <code>TalyxEscrow.claim</code> on Sepolia, so no gas is spent.</p>}
        </>
      )}
    </section>
  );
}
