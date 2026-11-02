import '../styles/site.css';
import { observeReveals } from './reveal';
import { COMMITMENT, groupOf, isAuthority, readU32LE, readU64LE, recoverSigners, short } from '../shared/beefy';

observeReveals();

/* ---------- the byte forger: recover both BEEFY signers in the browser ---------- */
function mountForger(root: HTMLElement) {
  const grid = root.querySelector<HTMLElement>('[data-bytes]')!;
  const pill = root.querySelector<HTMLElement>('[data-pill]')!;
  const verdict = root.querySelector<HTMLElement>('[data-verdict]')!;
  const undo = root.querySelector<HTMLButtonElement>('[data-undo]')!;
  const blockEl = root.querySelector<HTMLElement>('[data-block]')!;
  const setEl = root.querySelector<HTMLElement>('[data-set]')!;
  const signers = [...root.querySelectorAll<HTMLElement>('[data-signer]')];

  const bytes = COMMITMENT.slice();
  let focusIndex = 0;
  let run = 0;

  grid.replaceChildren(
    ...[...bytes].map((b, i) => {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = `byte byte--${groupOf(i).id}`;
      cell.tabIndex = i === 0 ? 0 : -1;
      cell.dataset.i = String(i);
      cell.append(document.createElement('code'));
      cell.firstElementChild!.textContent = hex(b);
      return cell;
    }),
  );
  const cells = [...grid.querySelectorAll<HTMLButtonElement>('button')];

  function hex(b: number) {
    return b.toString(16).padStart(2, '0');
  }
  function label(i: number) {
    return `Byte ${i + 1} of 48, ${groupOf(i).label}, value ${hex(bytes[i])}${bytes[i] !== COMMITMENT[i] ? ', changed' : ''}`;
  }
  cells.forEach((c, i) => c.setAttribute('aria-label', label(i)));

  function columns() {
    return getComputedStyle(grid).gridTemplateColumns.split(' ').length;
  }
  function moveFocus(to: number) {
    to = Math.max(0, Math.min(47, to));
    cells[focusIndex].tabIndex = -1;
    focusIndex = to;
    cells[to].tabIndex = 0;
    cells[to].focus();
  }
  function bump(i: number) {
    bytes[i] = (bytes[i] + 1) & 0xff;
    cells[i].firstElementChild!.textContent = hex(bytes[i]);
    cells[i].classList.toggle('is-changed', bytes[i] !== COMMITMENT[i]);
    cells[i].setAttribute('aria-label', label(i));
    check();
  }

  grid.addEventListener('click', (e) => {
    const cell = (e.target as HTMLElement).closest<HTMLButtonElement>('button.byte');
    if (!cell) return;
    const i = Number(cell.dataset.i);
    cells[focusIndex].tabIndex = -1;
    focusIndex = i;
    cell.tabIndex = 0;
    bump(i);
  });
  grid.addEventListener('keydown', (e) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns(), ArrowDown: columns() };
    if (e.key in step) { e.preventDefault(); moveFocus(focusIndex + step[e.key]); }
    else if (e.key === 'Home') { e.preventDefault(); moveFocus(0); }
    else if (e.key === 'End') { e.preventDefault(); moveFocus(47); }
  });
  undo.addEventListener('click', () => {
    bytes.set(COMMITMENT);
    cells.forEach((c, i) => { c.firstElementChild!.textContent = hex(bytes[i]); c.classList.remove('is-changed'); c.setAttribute('aria-label', label(i)); });
    check();
    cells[focusIndex].focus();
  });

  async function check() {
    const mine = ++run;
    const changed = [...bytes].flatMap((b, i) => (b !== COMMITMENT[i] ? [i] : []));
    blockEl.textContent = readU32LE(bytes, 36).toLocaleString('en-US');
    setEl.textContent = readU64LE(bytes, 40).toLocaleString('en-US');
    undo.disabled = changed.length === 0;

    const recovered = await recoverSigners(bytes);
    if (mine !== run) return; // a newer change already started
    const matches = recovered.map((a, i) => isAuthority(a) === i);

    recovered.forEach((addr, i) => {
      signers[i].querySelector('[data-addr] code')!.textContent = short(addr);
      const state = signers[i].querySelector<HTMLElement>('[data-state]')!;
      state.replaceChildren();
      if (matches[i]) state.textContent = `BEEFY key ${i + 1}`;
      else {
        const p = document.createElement('span');
        p.className = 'pill pill--bad';
        p.textContent = 'Not a BEEFY key';
        state.append(p);
      }
    });

    const ok = matches.filter(Boolean).length;
    pill.className = `pill ${ok === 2 ? 'pill--ok' : 'pill--bad'}`;
    pill.textContent = `${ok} of 2 match`;
    verdict.classList.toggle('is-bad', ok < 2);
    if (ok === 2) {
      verdict.textContent = 'Both BEEFY keys signed these bytes. The halves fit.';
      return;
    }
    const payloadTouched = changed.some((i) => groupOf(i).id === 'payload');
    const error = payloadTouched ? 'BadPayload' : 'BadSigner';
    const what = changed.length === 1 ? `Byte ${changed[0] + 1} (${groupOf(changed[0]).label}) changed.` : `${changed.length} bytes changed.`;
    const who = `Signature 1 now recovers ${short(recovered[0])}, which is not a BEEFY key.`;
    verdict.textContent = `${what} ${who} The escrow reverts with ${error}.`;
  }

  root.classList.add('is-live');
}

const forger = document.querySelector<HTMLElement>('[data-forger]');
if (forger) mountForger(forger);

/* ---------- the name: tabs switch the text, the picture and its caption ---------- */
const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-tab]')];
const caption = document.querySelector<HTMLElement>('[data-caption]');
function select(tab: HTMLButtonElement, focus = false) {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    const panel = document.querySelector<HTMLElement>(`[data-panel="${t.dataset.tab}"]`)!;
    panel.hidden = !on;
    document.querySelector(`[data-panel-img="${t.dataset.tab}"]`)?.classList.toggle('is-shown', on);
    if (on && caption) caption.textContent = panel.dataset.captionText ?? '';
  }
  if (focus) tab.focus();
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => select(t));
  t.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (d) { e.preventDefault(); select(tabs[(i + d + tabs.length) % tabs.length], true); }
  });
});

/* ---------- the CTA dialog carries its values into the demo ---------- */
const form = document.querySelector<HTMLFormElement>('[data-cta-form]');
if (form) {
  const price = form.querySelector<HTMLElement>('[data-cta-price]')!;
  form.addEventListener('change', () => {
    const amount = new FormData(form).get('amount');
    price.textContent = amount === '1' ? '0.0002 ETH' : '0.0001 ETH';
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const q = new URLSearchParams({ to: String(data.get('to')), amount: String(data.get('amount')) });
    location.href = `/app/?${q}#/orders/new`;
  });
}
