import { useState } from 'react';
import { encodeAbiParameters, keccak256, type Address } from 'viem';
import {
  CLAIM_WINDOW_MS, CONTRACTS, PREVIEW, claimOrder, clock, fillOrder, refreshOrders, refundOrder, stageOf, useOrders, type Order, type Stage,
} from '../orders';
import { nextJustified, useV3, type V3State } from '../v3';
import { useWallet } from '../wallet';
import { Addr, StagePill, TxLink, TxStatus, fmtBlock, useNow } from '../ui';
import { useAction } from '../useAction';
import type { ClaimArgs } from '../chain';

const SAMPLE_FILLER = '0x2e90b5c7d1a4f63e8b0c9d2a5f7e1b34c6d8a0f5';

// Claim arguments built for an order against a signed block, kept so the forged-proof panel and the claim reuse them.
const prepared = new Map<number, { B: number; args: ClaimArgs }>();
async function claimArgs(o: Order, v3: V3State, step: (s: string) => void): Promise<ClaimArgs> {
  const B = v3.lastJustified?.number;
  if (!B || !o.chain || !o.fill || B <= o.fill.block) throw new Error('Waiting for V3 to sign a block after the fill.');
  const cached = prepared.get(o.id);
  if (cached && cached.B >= o.fill.block + 1) return cached.args;
  const { prepareClaim } = await import('../chain');
  const args = await prepareClaim(o.chain, B, step);
  prepared.set(o.id, { B, args });
  return args;
}

export function OrderDetail({ id }: { id: number }) {
  const orders = useOrders();
  const o = orders.find((x) => x.id === id);
  const now = useNow();
  const v3 = useV3();
  const wallet = useWallet();
  const tx = useAction();
  const [forged, setForged] = useState(false);

  if (!o) {
    return (
      <>
        <p className="crumb"><a href="#/orders">Orders</a> /</p>
        <div className="title-row"><div><h1>Order {id}</h1><p className="sub">{PREVIEW ? `There is no order ${id} in this preview.` : `Reading order ${id} from Sepolia, or it does not exist on this escrow.`}</p></div></div>
        <a className="link-btn" href="#/orders">Back to all orders</a>
      </>
    );
  }

  const stage = stageOf(o, now);
  const next = nextJustified(v3);

  const live = {
    fill: () => tx.run('Confirm the fill in MetaMask, on Portaldot V3', async (step) => {
      const { fillTx } = await import('../chain');
      const hash = await fillTx(o.chain!, wallet.address as Address | undefined);
      step('Filled. Reading it back from V3');
      await refreshOrders();
      return { text: 'Filled on V3', tx: hash, chain: 'v3' };
    }),
    claim: () => tx.run('Building the proof from V3', async (step) => {
      const args = await claimArgs(o, v3, step);
      step('Confirm the claim in MetaMask, on Sepolia');
      const { claimTx } = await import('../chain');
      const hash = await claimTx(args);
      step('Claimed. Reading it back');
      await refreshOrders();
      return { text: 'Paid the recorded payee', tx: hash, chain: 'sepolia' };
    }),
    refund: () => tx.run('Confirm the refund in MetaMask, on Sepolia', async () => {
      const { refundTx } = await import('../chain');
      const hash = await refundTx(o.id);
      await refreshOrders();
      return { text: 'Refunded', tx: hash, chain: 'sepolia' };
    }),
  };

  let sub: string;
  let action: { label: string; run?: () => void; reason?: string } | null = null;
  switch (stage) {
    case 'open':
      sub = `Waiting for a filler to send ${o.amount} tPOT to this address on V3 before ${clock(o.deadline)}.`;
      action = {
        label: PREVIEW ? 'Fill on V3 (simulated)' : 'Fill on V3',
        run: PREVIEW
          ? () => fillOrder(o.id, { filler: wallet.address ?? SAMPLE_FILLER, payee: wallet.address ?? SAMPLE_FILLER, block: v3.best ? v3.best : 0, at: Date.now() })
          : live.fill,
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
      action = { label: PREVIEW ? 'Import and claim (simulated)' : 'Import and claim', run: PREVIEW ? () => claimOrder(o.id) : live.claim };
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
      action = { label: PREVIEW ? 'Refund (simulated)' : 'Refund', run: PREVIEW ? () => refundOrder(o.id) : live.refund };
      break;
    case 'refunded':
      sub = `Refunded: ${o.price} ETH went back to the requester. No claim can be made now.`;
      break;
  }

  const seam = forged ? 'forged' : stage === 'signed' || stage === 'claimed' ? 'fits' : 'waiting';
  const orderKey = o.chain?.orderKey ?? (CONTRACTS.escrow
    ? keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'address' }, { type: 'uint256' }], [11155111n, CONTRACTS.escrow as `0x${string}`, BigInt(o.id)]))
    : undefined);

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
            <button className="btn btn--primary" onClick={action.run} disabled={!action.run || !!tx.busy} aria-describedby={action.reason ? 'action-reason' : undefined}>{action.label}</button>
            {!action.run && action.reason && <small className="muted" id="action-reason">{action.reason}</small>}
          </div>
        )}
      </div>
      {(tx.busy || tx.error || tx.done) && <div className="txbar"><TxStatus state={tx} /></div>}
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
        <ForgedProof o={o} stage={stage} v3={v3} others={orders.filter((x) => x.id !== o.id && x.chain?.status === 1).map((x) => x.id)} onResult={setForged} />
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
interface StepRow { state: StepState; title: string; detail: string; at?: string; tx?: string; chain?: 'sepolia' | 'v3' }

function Steps({ o, stage, nextSeconds, nextBlock }: { o: Order; stage: Stage; nextSeconds?: number; nextBlock?: number }) {
  const c = o.chain;
  const rows: StepRow[] = [];
  rows.push({ state: 'done', title: 'Order posted on Sepolia', detail: `${o.price} ETH locked in the escrow.`, at: clock(o.createdAt), tx: c?.createTx, chain: 'sepolia' });

  if (stage === 'refunded' || stage === 'refundable' || stage === 'expired') {
    rows.push({ state: 'done', title: 'Deadline passed unfilled', detail: 'No FillBook record exists for this order.', at: clock(o.deadline) });
    rows.push({
      state: stage === 'refunded' ? 'done' : stage === 'refundable' ? 'now' : 'later',
      title: 'Refunded to the requester',
      detail: stage === 'refunded' ? `${o.price} ETH returned.` : `Opens at ${clock(o.deadline + CLAIM_WINDOW_MS)}, after the claim window.`,
      at: o.refundedAt ? clock(o.refundedAt) : undefined, tx: c?.refundTx, chain: 'sepolia',
    });
    return <StepList rows={rows} />;
  }

  rows.push({
    state: o.fill ? 'done' : 'now',
    title: 'Filled on V3',
    detail: o.fill ? `FillBook sent ${o.amount} tPOT to the recipient${o.fill.block ? ` in block ${fmtBlock(o.fill.block)}` : ''}.` : 'Any wallet with tPOT on V3 can fill it.',
    at: o.fill ? clock(o.fill.at) : undefined, tx: o.fill?.tx, chain: 'v3',
  });
  rows.push({
    state: o.signed || o.claimedAt ? 'done' : o.fill ? 'now' : 'later',
    title: 'Signed by both BEEFY keys',
    detail: o.signed
      ? `Stored justification at block ${fmtBlock(o.signed.block)}, validator set ${o.signed.setId}.`
      : o.claimedAt ? 'A stored justification after the fill was imported for the claim.'
      : o.fill && nextBlock ? `Next stored justification near block ${fmtBlock(nextBlock)}, in about ${nextSeconds} s.` : 'V3 stores one every 8 blocks, about every 48 s.',
  });
  rows.push({
    state: o.claimedAt ? 'done' : o.signed ? 'now' : 'later',
    title: 'State root imported on Sepolia',
    detail: o.claimedAt
      ? 'BeefyStateRoots held a signed V3 state root that includes the fill.'
      : o.signed
        ? `The claim reuses a block Sepolia already imported after the fill, or imports signed block ${fmtBlock(o.signed.block)}.`
        : 'Anyone can submit the import; nobody can forge it.',
  });
  rows.push({
    state: o.claimedAt ? 'done' : 'later',
    title: 'Claimed by the payee',
    detail: o.claimedAt ? `${o.price} ETH paid to the payee recorded on V3.` : 'The escrow pays only the payee written in the FillBook record.',
    at: o.claimedAt ? clock(o.claimedAt) : undefined, tx: c?.claimTx, chain: 'sepolia',
  });
  return <StepList rows={rows} />;
}

function StepList({ rows }: { rows: StepRow[] }) {
  return (
    <ol className="steps">
      {rows.map((r) => (
        <li key={r.title} className={`step step--${r.state}`} aria-current={r.state === 'now' ? 'step' : undefined}>
          <span className="step__mark" aria-hidden="true" />
          <div><b>{r.title}</b><p>{r.detail}</p>{r.tx && <p className="step__tx"><TxLink hash={r.tx} chain={r.chain} /></p>}</div>
          {r.at ? <time>{r.at}</time> : <span />}
        </li>
      ))}
    </ol>
  );
}

/* ---------- try a forged proof (prd.md §12) ---------- */
const TAMPERS = [
  { id: 'payee', label: 'Pay a different address', error: 'WordMismatch', why: 'The slot exists but records a different payee.' },
  { id: 'time', label: 'Move the fill time by one second', error: 'WordMismatch', why: 'The recorded timestamp is part of the stored word.' },
  { id: 'order', label: 'Use this proof for another order', error: 'SlotMismatch', why: 'Another order has another recipient, amount and key, so its FillBook slot holds nothing.' },
  { id: 'block', label: 'Use a block Sepolia never imported', error: 'UnknownBlock', why: 'BeefyStateRoots has no state root for that block hash.' },
] as const;
type TamperId = (typeof TAMPERS)[number]['id'];

const WHY: Record<string, string> = {
  WordMismatch: 'The FillBook record exists but says something else.',
  SlotMismatch: 'There is no FillBook record at the slot this claim points to.',
  UnknownBlock: 'BeefyStateRoots never imported that block, so nothing about it is proven.',
  NotOpen: 'This order is already settled.',
  ChildRootMismatch: 'The proof is not for FillBook’s storage.',
  ProofIncomplete: 'The proof does not reach the state root.',
};

function ForgedProof({ o, stage, v3, others, onResult }: { o: Order; stage: Stage; v3: V3State; others: number[]; onResult: (forged: boolean) => void }) {
  const [choice, setChoice] = useState<TamperId>('payee');
  const [result, setResult] = useState<{ clean: boolean; error: string | null; why: string } | null>(null);
  const tx = useAction();
  const ready = PREVIEW ? stage === 'signed' || stage === 'claimed' : stage === 'signed';

  function tamper(a: ClaimArgs, id: TamperId): ClaimArgs {
    if (id === 'payee') return { ...a, payee: '0x0000000000000000000000000000000000000001' };
    if (id === 'time') return { ...a, fillTimestamp: a.fillTimestamp - 1n };
    if (id === 'order') return { ...a, orderId: BigInt(others[0]) };
    return { ...a, blockHash: keccak256(a.blockHash) };
  }

  function send(clean: boolean) {
    const t = TAMPERS.find((x) => x.id === choice)!;
    if (PREVIEW) {
      setResult(clean ? { clean, error: null, why: '' } : { clean, error: t.error, why: t.why });
      onResult(!clean);
      return;
    }
    tx.run('Building the proof from V3', async (step) => {
      const args = await claimArgs(o, v3, step);
      step('Sending as eth_call to TalyxEscrow.claim on Sepolia');
      const { simulateClaim } = await import('../chain');
      const error = await simulateClaim(clean ? args : tamper(args, choice));
      setResult({ clean, error, why: error ? WHY[error] ?? '' : '' });
      onResult(!!error && !clean);
    });
  }

  return (
    <section className={`panel ${ready ? 'span-5' : 'span-12'}`} aria-labelledby="forge-title">
      <header><h2 id="forge-title">Try a forged proof</h2><span className="meta">{PREVIEW ? 'Simulated' : 'eth_call on Sepolia'}</span></header>
      {!ready ? (
        <p className="empty">{stage === 'claimed' && !PREVIEW
          ? 'This order is settled, so any claim now reverts with NotOpen. Try a forged proof on an order that is signed but not yet claimed.'
          : <>A proof exists once V3 signs a block after the fill. {stage === 'open' ? 'Fill the order first.' : stage === 'filled' ? 'That should take under a minute.' : 'This order was never filled, so there is nothing to forge.'}</>}</p>
      ) : (
        <>
          <fieldset className="tampers">
            <legend className="sr-only">What to change in the claim</legend>
            {TAMPERS.map((t) => (
              <label key={t.id} className="tamper">
                <input type="radio" name="tamper" checked={choice === t.id} disabled={t.id === 'order' && !PREVIEW && others.length === 0}
                  onChange={() => { setChoice(t.id); setResult(null); onResult(false); }} />
                <span>{t.label}{t.id === 'order' && !PREVIEW && others.length > 0 && ` (order ${others[0]})`}</span>
              </label>
            ))}
          </fieldset>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn--ghost" onClick={() => send(false)} disabled={!!tx.busy}>Send as eth_call</button>
            <button className="btn btn--secondary" onClick={() => send(true)} disabled={!!tx.busy}>Send the real proof</button>
          </div>
          {(tx.busy || tx.error) && <div style={{ marginTop: 12 }}><TxStatus state={tx} /></div>}
          {result && !tx.busy && (
            <div className={`result ${result.error ? 'result--bad' : 'result--ok'}`} role="status">
              {result.error
                ? <><b>Reverted: <code>{result.error}</code></b>{result.why} Nothing is paid.</>
                : <><b>Would succeed</b>The unchanged proof pays {o.price} ETH to <Addr value={o.fill?.payee} />.</>}
            </div>
          )}
          <p className="help" style={{ marginTop: 12 }}>
            {PREVIEW
              ? <>Once deployed, this sends <code>eth_call</code> to <code>TalyxEscrow.claim</code> on Sepolia, so no gas is spent.</>
              : <>Sent as <code>eth_call</code> to the deployed <code>TalyxEscrow.claim</code>: no gas, no signature. If Sepolia has not imported the signed block yet, MetaMask asks to import it first.</>}
          </p>
        </>
      )}
    </section>
  );
}
