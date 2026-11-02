import '../styles/site.css';
import '../styles/verify.css';
import { observeReveals } from './reveal';
import {
  AUTHORITIES, COMMITMENT, KEYSET_COMMITMENT, MMR_ROOT_279493, PEAKS_279493, bagPeaks, isAuthority, keysetCommitment, recoverSigners, short,
} from '../shared/beefy';

// each reference section enters heading first, then its text, then its table or picture
document.querySelectorAll<HTMLElement>('.dsec').forEach((sec) => {
  [...sec.children].forEach((el, i) => {
    if (el.hasAttribute('data-reveal')) return;
    el.setAttribute('data-reveal', '');
    (el as HTMLElement).style.setProperty('--i', String(Math.min(i, 3)));
  });
});
observeReveals();

/* ---------- three checks on real V3 data, computed in this browser ---------- */
const root = document.querySelector<HTMLElement>('[data-checks]');
if (root) {
  const run = root.querySelector<HTMLButtonElement>('[data-run]')!;
  const summary = root.querySelector<HTMLElement>('[data-summary]')!;
  const item = (id: string) => root.querySelector<HTMLElement>(`[data-check="${id}"]`)!;

  function show(id: string, ok: boolean, text: string) {
    const li = item(id);
    li.classList.remove('is-ok', 'is-bad');
    li.classList.add(ok ? 'is-ok' : 'is-bad');
    li.querySelector('[data-out]')!.textContent = text;
  }

  run.addEventListener('click', async () => {
    run.disabled = true;
    run.textContent = 'Checking…';
    root.querySelectorAll('li').forEach((li) => li.classList.remove('is-ok', 'is-bad'));
    const t0 = performance.now();

    const keyset = keysetCommitment(AUTHORITIES);
    show('keys', keyset === KEYSET_COMMITMENT, `Computed ${short(keyset, 10, 6)}: ${keyset === KEYSET_COMMITMENT ? 'matches' : 'does not match'}.`);

    const signers = await recoverSigners(COMMITMENT);
    const sigsOk = signers.every((a, i) => isAuthority(a) === i);
    show('sigs', sigsOk, `Recovered ${signers.map((a) => short(a)).join(' and ')}: ${sigsOk ? 'both are BEEFY keys' : 'not the BEEFY keys'}.`);

    const bagged = bagPeaks(PEAKS_279493);
    show('mmr', bagged === MMR_ROOT_279493, `Computed ${short(bagged, 10, 6)}: ${bagged === MMR_ROOT_279493 ? 'matches' : 'does not match'}.`);

    const passed = root.querySelectorAll('li.is-ok').length;
    summary.textContent = `${passed} of 3 checks pass, in ${Math.max(1, Math.round(performance.now() - t0))} ms, in this browser.`;
    run.disabled = false;
    run.textContent = 'Run it again';
  });
}

/* ---------- copy the CLI ---------- */
document.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const text = document.getElementById(btn.dataset.copy!)?.textContent ?? '';
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = 'Copied';
    } catch {
      btn.textContent = 'Select and copy';
    }
    setTimeout(() => (btn.textContent = 'Copy'), 1800);
  });
});
