import { useEffect, useState } from 'react';
import { syncWithV3, useOrders, stageOf } from './orders';
import { nextJustified, useV3 } from './v3';
import { chainName, connect, useWallet } from './wallet';
import { Icon, Mark, fmtBlock, shortAddr, useNow, useRoute } from './ui';
import { Orders } from './screens/Orders';
import { OrderDetail } from './screens/OrderDetail';
import { FillQueue } from './screens/FillQueue';
import { Blocks } from './screens/Blocks';

export function App() {
  const route = useRoute();
  const v3 = useV3();
  const orders = useOrders();
  const now = useNow();
  const [menu, setMenu] = useState(false);

  // preview fills follow the live chain: they take the V3 head and wait for a real stored justification
  useEffect(() => { syncWithV3(v3.best, v3.justified); }, [v3.best, v3.justified]);
  useEffect(() => { setMenu(false); }, [route.join('/')]);

  const openToFill = orders.filter((o) => stageOf(o, now) === 'open').length;
  const screen = route[0];

  let page;
  let title = 'Orders';
  if (screen === 'orders' && route[1] && route[1] !== 'new') {
    page = <OrderDetail id={Number(route[1])} />;
    title = `Order ${route[1]}`;
  } else if (screen === 'fill') { page = <FillQueue />; title = 'Fill'; }
  else if (screen === 'blocks') { page = <Blocks />; title = 'Blocks'; }
  else page = <Orders creating={route[1] === 'new'} />;

  useEffect(() => { document.title = `${title} · Talyx demo`; }, [title]);

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="/"><Mark />Talyx</a>
        <button className="btn btn--ghost btn--sm" aria-expanded={menu} aria-controls="side" onClick={() => setMenu(!menu)}>
          <Icon name={menu ? 'close' : 'menu'} />{menu ? 'Close' : 'Menu'}
        </button>
      </header>
      <aside className={`side${menu ? ' is-open' : ''}`} id="side">
        <a className="brand" href="/"><Mark />Talyx</a>
        <p className="scope">Sepolia to V3 testnet</p>
        <nav className="nav" aria-label="Screens">
          <a className="nav-item" href="#/orders" aria-current={screen === 'orders' ? 'page' : undefined}><Icon name="orders" />Orders</a>
          <a className="nav-item" href="#/fill" aria-current={screen === 'fill' ? 'page' : undefined}>
            <Icon name="fill" />Fill<span className="count" aria-label={`${openToFill} open orders`}>{openToFill}</span>
          </a>
          <a className="nav-item" href="#/blocks" aria-current={screen === 'blocks' ? 'page' : undefined}><Icon name="blocks" />Blocks</a>
        </nav>
        <p className="side__label">Read more</p>
        <nav className="nav" style={{ marginTop: 0 }} aria-label="Pages">
          <a className="nav-item" href="/verify/">Verify it yourself</a>
          <a className="nav-item" href="/">About Talyx</a>
        </nav>
        <div className="side__bottom">
          {liveV3()}
          <div className="wallet">
            <WalletRow />
          </div>
        </div>
      </aside>
      <main className="canvas" id="main">{page}</main>
    </div>
  );

  function liveV3() {
    const next = nextJustified(v3);
    return (
      <div className="live" aria-live="off">
        <div className="live__row">
          <span><i className={`dot ${v3.status === 'live' ? 'dot--v3' : 'dot--off'}`} /> V3 block</span>
          <span className="num">{v3.status === 'error' ? 'offline' : fmtBlock(v3.best)}</span>
        </div>
        <div className="live__row"><span>Last signed</span><span className="num">{fmtBlock(v3.lastJustified?.number)}</span></div>
        <div className="live__row"><span>Next signed</span><span className="num">{next ? `~${next.seconds} s` : '–'}</span></div>
      </div>
    );
  }

}

function WalletRow() {
  const w = useWallet();
  if (w.address) {
    return (
      <span>
        <code>{shortAddr(w.address)}</code>
        <small>{chainName(w.chainId)}</small>
      </span>
    );
  }
  return (
    <>
      <span><small>{w.available ? 'Wallet not connected' : 'No browser wallet'}</small></span>
      <button className="btn btn--ghost btn--sm" onClick={connect} disabled={w.busy || !w.available}>Connect</button>
    </>
  );
}
