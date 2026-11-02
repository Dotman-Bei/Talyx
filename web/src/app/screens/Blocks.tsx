import { CONTRACTS } from '../orders';
import { nextJustified, retry, useV3 } from '../v3';
import { AUTHORITIES, KEYSET_COMMITMENT } from '../../shared/beefy';
import { fmtBlock, useNow } from '../ui';

export function Blocks() {
  const v3 = useV3();
  const now = useNow();
  const next = nextJustified(v3);
  const loading = v3.status === 'connecting';
  const updated = v3.updatedAt ? Math.round((now - v3.updatedAt) / 1000) : null;

  return (
    <>
      <div className="title-row">
        <div>
          <h1>Blocks</h1>
          <p className="sub">
            {v3.lastJustified
              ? <>V3 last stored a signed justification at block <b>{fmtBlock(v3.lastJustified.number)}</b>; both signatures recover to its BEEFY keys in this browser.</>
              : 'Live BEEFY justifications from the Portaldot V3 testnet, checked in this browser.'}
          </p>
        </div>
        {updated !== null && v3.status === 'live' && <span className="muted" style={{ fontSize: 12 }}>Updated {updated} s ago</span>}
      </div>

      {v3.status === 'error' && (
        <p className="notice" role="alert">
          {v3.error} Last good data: {v3.best ? `block ${fmtBlock(v3.best)}` : 'none this session'}.{' '}
          <button className="link-btn" onClick={retry}>Retry</button>
        </p>
      )}

      <div className="kpis" aria-label="V3 right now">
        <div className="kpi kpi--lead"><span>Next signed block</span><strong>{loading || !next ? <i className="skeleton" /> : `~${next.seconds} s`}</strong><small>{next ? `near block ${fmtBlock(next.block)}` : 'waiting for the first one'}</small></div>
        <div className="kpi"><span>Best block</span><strong>{loading ? <i className="skeleton" /> : fmtBlock(v3.best)}</strong><small>a new one every 6 s</small></div>
        <div className="kpi"><span>BEEFY-finalized</span><strong>{loading ? <i className="skeleton" /> : fmtBlock(v3.finalized)}</strong><small>{v3.best && v3.finalized ? `${v3.best - v3.finalized} behind best` : '–'}</small></div>
        <div className="kpi"><span>Imported on Sepolia</span><strong>{CONTRACTS.stateRoots ? '–' : '0'}</strong><small>{CONTRACTS.stateRoots ? 'BeefyStateRoots' : 'contract not deployed yet'}</small></div>
      </div>

      <div className="grid">
      <section className="panel span-8" aria-labelledby="just-title">
        <header><h2 id="just-title">Stored justifications seen this session</h2><span className="meta">One every 8 blocks</span></header>
        {v3.justified.length === 0 ? (
          <p className="empty">{v3.status === 'error' ? 'No justifications loaded. The V3 node could not be reached.' : 'Reading the last 9 finalized blocks for a stored justification…'}</p>
        ) : (
          <table className="table">
            <thead><tr><th>Block</th><th>Hash</th><th className="r">Validator set</th><th className="r">Signatures</th><th>Imported</th></tr></thead>
            <tbody>
              {v3.justified.map((j) => (
                <tr key={j.number} style={{ cursor: 'default' }}>
                  <td className="id">{fmtBlock(j.number)}</td>
                  <td><code title={j.hash}>{j.hash.slice(0, 10)}…{j.hash.slice(-6)}</code></td>
                  <td className="r">{j.setId}</td>
                  <td className="r"><span className={`pill ${j.signers === 2 ? 'pill--ok' : 'pill--bad'}`}>{j.signers} of 2 keys</span></td>
                  <td className="muted">–</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="panel span-4" aria-labelledby="keys-title">
        <header><h2 id="keys-title">The keys each row is checked against</h2></header>
        <dl className="kv">
          <div><dt>BEEFY key 1</dt><dd><code title={AUTHORITIES[0]}>{AUTHORITIES[0].slice(0, 10)}…{AUTHORITIES[0].slice(-6)}</code></dd></div>
          <div><dt>BEEFY key 2</dt><dd><code title={AUTHORITIES[1]}>{AUTHORITIES[1].slice(0, 10)}…{AUTHORITIES[1].slice(-6)}</code></dd></div>
          <div><dt>Keyset commitment</dt><dd><code title={KEYSET_COMMITMENT}>{KEYSET_COMMITMENT.slice(0, 10)}…{KEYSET_COMMITMENT.slice(-6)}</code></dd></div>
          <div><dt>Threshold</dt><dd>both signatures</dd></div>
        </dl>
        <p className="help" style={{ marginTop: 12 }}>Read from <code>Beefy.Authorities</code> on V3. Probably development keys; V3’s sudo key is trusted too. <a className="link-btn" href="/verify/#keys">Check them</a></p>
      </section>
      </div>
    </>
  );
}
