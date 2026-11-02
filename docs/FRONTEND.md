# Talyx frontend spec

Source: `prd.md` (§5 users, §6.3 demo page, §7 trust model, §8 verified facts, §12 forged-proof catalogue, §13 demo).
Art direction: the `design-taste-frontend` skill. Direction dealt: **One motif** (seed 964307899) for the public pages,
**Achromatic ledger** with the Open plane shell (seed 711922466) for the demo app. Both share one palette and one typeface.

Stack: Vite multi-page build in `web/` (static, hostable anywhere). Landing and Verify are static HTML with small
TypeScript modules; the demo app is React. `viem` does the in-browser cryptography (keccak256, ECDSA recovery) and the
wallet calls.

---

## 1. Who it is for, and what each page drives

| Reader | What they know | What they need from us |
| --- | --- | --- |
| **Judge / skeptic** (primary, Nov 6–11) | Knows Substrate and EVM, has 30 seconds per project, distrusts claims | To see the proof check working on real V3 data, and to be able to check it again themselves |
| **Requester** | Has MetaMask and Sepolia ETH, no tPOT | To post an order and know where it is |
| **Filler** | Holds tPOT on V3, wants ETH | To see open orders and fill one |
| **Integrator** (another Track 2 builder) | Wants finalized V3 state on an EVM chain | The `stateRootOf` interface, addresses, encoding |

| Page | Path | The one main action |
| --- | --- | --- |
| Landing | `/` | **Open the demo** (the same label everywhere on the page) |
| Demo app | `/app/` | **New order** (requester) / **Fill** (filler); one primary per screen |
| Verify | `/verify/` | **Run the check** (recompute a real value in the browser, then copy the CLI commands) |

---

## 2. The idea

Inventory of what belongs to Talyx and no competitor:
the tally stick (notched with the amount, split lengthwise, settled only when the halves fit); the two halves = the
order on Sepolia and the fill on V3; the V-notch; block #279,494 and its real 186-byte justification; 2 BEEFY keys;
a justification every 8 blocks (~48 s); validator set 471 → 480; 14 vs 18 decimals (÷10⁴); chain ids 11155111 and
420420777; named revert errors (`SlotMismatch`, `BadSigner`, …); refund after deadline + 30 min.

> **On this page, the tally stick's two halves that must fit become the split, notched stage that every proof is
> checked on.**

Competitor test: "BridgeZero's committee becomes a notched stick" does not work. The idea is Talyx's.

**The one live thing (landing hero):** the real BEEFY commitment for V3 block #279,494 laid out as 48 byte cells.
The page recovers both signers in the browser and shows they are V3's two BEEFY keys. Change any byte and the
recovery is redone: signer 1 becomes a stranger's address and the verdict reads `BadSigner`, the error the escrow
reverts with. Verified against `prd.md` Appendix A before writing this spec:

- `keccak256(commitment)` + signature recovery → `0x4D13…B421`, `0x4A69…7413` (both authorities)
- byte 11 flipped → signer 1 recovers `0x5Eba…7C98`, not an authority
- bagging the 8 peaks at #279,493 right-to-left (`acc = keccak256(acc ++ peak)`) → `0x073b…93a1` (the published root)
- keyset commitment `keccak256(keccak256(a0) ++ keccak256(a1))` → `0xc745…a7d5` (used on Verify)

Fallback without script: the bytes and the verified result render as static HTML; the cells are disabled.

---

## 3. Visual direction

### Thesis
One shape from the subject, at four scales: the **V-notch** cut into a tally stick. It is the cut corner of the hero
stage (enormous), the mask of every photograph (large), the notched seam that joins the two halves of an order in the
app (medium), and the bullet and button corner (text size). Mint is the Sepolia half, pink is the V3 half, everywhere.
Nothing else on the page has character; the shape and the real data carry it.

### Palette (exact values)

| Token | Value | Role |
| --- | --- | --- |
| `--bg` | `#f8f8f8` | Page ground |
| `--surface` | `#eeeeee` | Tiles and fields one step off the ground |
| `--white` | `#ffffff` | Cards, app panels, a third field colour |
| `--ink` | `#0a0a0a` | Text and the ink field |
| `--display` | `#161616` | Display type (charcoal, not pure black) |
| `--muted` | `#5f5f5f` | Secondary text, on `--bg`, `--white`, `--surface` only (≥ 5.6:1). Never on mint or pink |
| `--accent` | `#1f6b3a` | The primary button only. Label `#ffffff` |
| `--mint` | `#c3edce` | The Sepolia half: order, escrow, the CTA field |
| `--pink` | `#f8c7c9` | The V3 half: fill, BEEFY, the hero stage |
| `--mint-deep` | `#1f6b3a` | Mint as a mark on white (the Sepolia dot, the "fits" state) |
| `--pink-deep` | `#a3324a` | Pink as a mark on white (the V3 dot) |
| `--negative` | `#c4242a` | Revert / forged. Pill: `#ffedea` with `#831c1e` |
| `--positive` | `#247b50` | Verified. Pill: `#dcfae5` with `#04250e` |
| App `--border` / `--rule` / `--control` | `#e8e8e8` / `#f2f2f2` / `#d1d5db` | App screens only |

Proportions: ground and ink everywhere; mint and pink as whole fields on the landing page, as small marks (under 1% of
pixels) in the app; green only on the one button.

### Typefaces (two)
- **Switzer** (Fontshare, 400/500/600) does every job: display 600, tracking −0.04em, leading 0.95; body 400, leading
  1.5, tracking −0.005em.
- **JetBrains Mono** (Google Fonts, 400) has one job: hex bytes, addresses, hashes and CLI commands, inside `data-ui`
  interface fragments and `<pre>/<code>` only.

Type steps (public pages, five sizes):

| Step | Size | Use |
| --- | --- | --- |
| small | `clamp(13px, 0.79rem + 0.1vw, 14px)` | Captions, credits, fragment labels |
| body | `clamp(17px, 1rem + 0.25vw, 19px)` | Running text, always full ink |
| lead | `clamp(20px, 1.1rem + 0.7vw, 26px)` | Supporting lines, tile names, questions |
| head | `clamp(32px, 1.3rem + 3.2vw, 64px)` | Section headings |
| display | `clamp(44px, 5.2vw, 80px)` (10vw on phones) | The hero headline and the CTA closing line |

App sizes (Achromatic ledger): 12 / 14 / 16 / 24 (title), KPI-style figures 24–30, nothing over 32.

### Spacing scale
4px base: `4 8 12 16 24 32 48 64 96 128 176`.
- Page margins: `clamp(16px, 2.5vw, 40px)`, the same on both sides at every width.
- Gap between sections: 176px desktop, 128px tablet, 96px phone. Inside a section never more than 64px.
- Tile gaps 8px (6px on phones). App: one gutter of 16px, card padding 20px, controls 32–36px, rows 48px.

### Shape and corners
- One radius: **0** on the public pages (square tiles, square photos); the motif supplies the only angles.
- The notch: a 90° V, its depth = half its width. Sizes: 120px (hero stage), 48px (photo masks), 16px (app seam),
  8px (bullets, button corner).
- App: tight radii 8 (panels) / 6 (controls) / 4 (pills).

### Motion rules
- Transform and opacity only. Every move has a `prefers-reduced-motion` fallback that keeps the content.
- **Signature move:** the showcase photograph opens from its notched edge with a clip-path shutter over 1.1s while the
  picture settles from 1.12 scale to 1. Used once.
- **Entrances:** each section's heading, then text, then picture, rising 24px with opacity over 600ms, staggered 70ms,
  once. Content is visible if the script never runs.
- **Feedback:** buttons and links 160ms (press scales to 0.98); byte cells lift 2px on hover; the forged verdict swaps
  in 200ms.
- **One moving picture:** the photograph in the open tab of "The name" drifts slowly (scale 1 → 1.04 over 20s,
  alternating). No moving decoration anywhere else.
- App screens: feedback only, no entrances.

---

## 4. Pages, in build order

### Page 1. Landing (`/`)

Navigation: `Talyx` wordmark · How it works · The name · Builders · Questions · **Open the demo**

**1. Hero — fragment on a notched stage**
- h1: **Paid only when the halves fit**
- Supporting line: Talyx is an escrow on Sepolia that pays a filler only after Portaldot V3's own BEEFY proof shows
  your tPOT reached your address.
- Primary: **Open the demo** · text link: Check it yourself
- Stage (pink, notched corner, bleeds right and bottom) holding the live fragment:
  - Title: Commitment V3 signed for block 279,494
  - Byte groups labelled: `mh` payload id · MMR root · Block number · Validator set
  - Signer rows: Signature 1 → `0x4d13…b421` · BEEFY key 1 · matches / Signature 2 → `0x4a69…7413` · BEEFY key 2 · matches
  - Verdict (valid): Both BEEFY keys signed these bytes. The halves fit.
  - Verdict (forged): Byte 11 changed. Signature 1 now recovers `0x5eba…7c98`, which is not a BEEFY key. The escrow
    reverts with `BadSigner`.
  - Button: Undo the change

**2. Proof board — "Who holds the keys today"**
Tiles (heading tile in ink, double width, first):
- **Official bridge** — An operator. Its page calls transfers irreversible and gives the arrival time as "patience is key".
- **BridgeZero, way back** — A 2-of-3 committee. On the testnet, one operator holds all three keys.
- **PASTX** — A single trusted relayer.
- **iBridge** — No one yet. Listed for V3.0; custody, fees and launch are awaiting confirmation.
- **Harmony, 2022** — About $100M lost after an attacker controlled 2 of its 5 multisig keys.
- **Orbit, 2024** — About $81M lost after its signers were compromised.
Closing statement: Talyx holds nothing. A filler risks only their own tPOT, and the ETH moves only on V3's signed proof.

**3. How it works — "One order, two chains"** (four fields, the same order card further along in each)
- Mint — First the order lands on Sepolia. Card: Order 7 · Deliver 0.5 tPOT · To `0x3f2a…a91c` on V3 · Escrow 0.0001 ETH ·
  Deadline 14:30 UTC · Open
- Pink — Then any filler pays it on V3. Card adds: Filled by `0x8c41…02be` · V3 block 285,190 · FillBook record written
- White — V3's two BEEFY keys sign a later block. Card adds: Signed in block 285,197 · 2 of 2 signatures · set 480
- Ink — The proof pays the filler. Card: Claimed · 0.0001 ETH to `0x8c41…02be` · signatures, MMR root, header and
  storage proof checked

**4. The name — square plate, spare text** (three tabs switch the photograph and the text)
- Tab *The stick* · h2 **Notched, then split** — A medieval tally was notched with the amount owed, then split
  lengthwise. Each party kept one half, and the debt was settled only when the two halves fit. (Photo: two halves of a
  medieval tally, Winchester City Council Museums.)
- Tab *The halves* · **Two halves, two chains** — In Talyx the order on Sepolia is one half and the fill on V3 is the
  other. The FillBook contract records who filled, for whom and how much, in the same call that pays. (Photo: a notched
  tally, Swiss Alpine Museum.)
- Tab *The check* · **Checked, not held** — Nobody holds the halves together. The escrow checks V3's signed proof that
  the fill exists, byte for byte, and pays only if every byte matches. (Painting: *Portrait of an Elderly Man Holding a
  Tally Stick*, Master of the Legend of the Magdalen.)
- Action cells: **Open the demo** (ink) · Check it yourself (tone)

**5. Builders — "Parts you can build on"** (mosaic)
- **Proven V3 state roots** — `stateRootOf(blockHash)` returns `(stateRoot, number)`: the same interface as
  BridgeZero's `IFinalizedStateRoots`, proven by BEEFY instead of a watcher.
- **Forgeries fail by name** — Every tampered proof reverts with a named error, from `BadSigner` to `MmrRootMismatch`.
- **Both keys, every time** — V3 runs two BEEFY validators, and the escrow requires both signatures.
- **Claimable in about a minute** — V3 stores a signed justification every 8 blocks, about every 48 seconds.
- **Your ETH comes back** — No fill by the deadline? After a 30-minute claim window, you take a refund.
- **No 10,000× slips** — tPOT has 14 decimals and EVM units have 18, so every amount must divide by 10⁴.

**6. Questions — "Fair questions"** (accordion, one open at a time)
1. What do I still have to trust? — V3's two BEEFY keys, which are probably development keys, and V3's sudo key. Not a
   relayer, not a committee. Talyx is testnet-only and unaudited.
2. What if nobody fills my order? — After the deadline plus a 30-minute claim window, you call refund and your ETH
   comes back. Claim and refund can never both happen.
3. Can the relayer steal or redirect the payment? — No. The claim pays the payee recorded on V3. A relayer can delay a
   claim; it cannot change who is paid.
4. Who are the fillers? — Anyone holding tPOT on V3. The filler script watches for new orders and fills them; a
   filler earns the spread between the ETH escrowed and the tPOT sent.
5. What if the fill landed before the latest signed block? — State is cumulative. Any later signed block still holds
   the fill record, so the proof only needs the newest leaf of that block.
6. Why does my amount have to divide by 10⁴? — tPOT has 14 decimals and EVM contracts count in 18. Rounding the gap
   away would let 0.0001 tPOT turn into dust, so the escrow refuses it.
7. Why only onto V3, not back out? — Proofs flow out of V3, which is enough to protect you on the way in. Paying out
   of V3 needs a light client of the other chain on V3; that is planned as Bonded Fast Exit.
8. Why does this need Portaldot V3? — V3 runs EVM contracts (Revive) and signs its own BEEFY finality with plain
   secp256k1 keys. Mainnet (spec 1002) has neither yet.

**7. CTA — "Send the first half"** (mint field, the create dialog already open)
- Closing line: **Send the first half**
- Sentence: The demo opens with this order filled in. You sign it on Sepolia with MetaMask, and any filler can cut the
  other half on V3.
- Dialog (`data-ui`): title New order · field Deliver to on V3 = `0x3f2a9c4e1b7d8a06f5c2e9b13d4a7f60c81ea91c` ·
  segmented Amount 0.5 tPOT / 1 tPOT · line Escrow 0.0001 ETH, deadline in 1 hour · **Open the demo** (carries the
  address and amount into `/app/#/orders/new`).

**8. Footer — the mark, built large**
- TALYX built from five blocks of differing height in mint, pink, surface and white, each letter knocked out.
- Columns: Product (Demo, Verify, How it works) · Build (State roots, Prover CLI, Forged-proof tests) · Event (Portaldot
  Hacker House 2026, Multi-Chain & Cross-Chain Infra) · Pictures (credits).
- Lines: Testnet only. Unaudited. / Trusts V3's 2 BEEFY keys (probably development keys) and V3 sudo.
- Last row: © 2026 Talyx · **Open the demo**

### Page 2. Demo app (`/app/`)

Shell: Open plane. 240px sidebar on the page ground, no top bar. Sidebar top: the Talyx mark (a notched mint/pink
bar) and the scope *Sepolia → V3 testnet*. Nav: **Orders**, **Fill** (count of orders open to fill), **Blocks**.
Bottom: live V3 status (best block, BEEFY-finalized block, from `wss://test-node-v3.portaldot.dev`) and the wallet row
(Connect MetaMask / connected address and chain).

Face: the two halves as hue. Mint and pink only on the tally seam and the chain dots. **Signature element: the tally**,
each order drawn as two halves (Sepolia half, V3 half) joined by a notched seam whose state is the order's state.

Preview mode: until contract addresses are set in `VITE_ESCROW_ADDRESS`, `VITE_STATE_ROOTS_ADDRESS` and
`VITE_FILLBOOK_ADDRESS`, the app runs on sample orders and simulates transactions, and says so in one quiet notice:
"Preview: contracts aren't deployed yet. Orders here are samples and transactions are simulated. V3 block data is live."

**Screen A. Orders** (`#/orders`) — question: *Where is each of my orders, and what is it waiting for?*
- h1 Orders. Subline (the finding, computed): e.g. "Order 9 is waiting for V3's next signed block, about 30 s away."
- Primary: **New order**
- Tabs: All · Open · Filled · Claimed · Refunded (counts from rows)
- Table: Order · Deliver (tPOT) · To on V3 · Escrow (ETH) · Deadline · Status · Next step
- Phone: two-line rows (Order 7 · 0.5 tPOT / status · deadline)

**Screen B. Order detail** (`#/orders/:id`) — question: *Can this filler be paid yet, and if not, what is missing?*
- h1 Order 7 · subline e.g. "Filled on V3 in block 285,190. Signed block expected in about 20 s."
- The tally: Sepolia half (requester, deliver, to, escrow, deadline, createOrder tx) | seam | V3 half (filler, payee,
  fill block, fill time). Seam states: waiting · fits · forged.
- Progress list: Order posted → Filled on V3 → Signed by BEEFY → State root imported → Claimed (each with block, time).
- The next job, one primary: **Fill on V3** / **Import and claim** / **Refund** (disabled with the reason while
  waiting: "Refund opens 15:00 UTC").
- **Try a forged proof**: choose what to change (Recipient byte · Amount · Payee · Fill time) → Send as eth_call →
  result "Reverted: SlotMismatch" with the reason in words.

**Screen C. Fill** (`#/fill`) — question: *Which orders can I fill right now, and what do I earn?*
- h1 Fill. Subline: "3 orders are open. You need 2.0 tPOT on V3 to fill them all."
- Payee field (the Sepolia address that receives the ETH), then rows with **Fill** on each.

**Screen D. Blocks** (`#/blocks`) — question: *Which V3 blocks has Sepolia accepted, and how far behind is it?*
- h1 Blocks. Live V3 head and BEEFY-finalized head; table of imported state roots (block, hash, state root, set id,
  import tx, gas).

States for every block: loading (grey bars at real size), empty (frame + one sentence), error (inline, with Retry).

### Page 3. Verify (`/verify/`)

- h1: **Check every claim yourself**
- Supporting line: Every number Talyx shows can be rebuilt from public RPCs. These are the addresses, keys, encodings
  and commands to do it.
- Live check: **Run the check** recomputes the keyset commitment from the two BEEFY addresses in the browser and
  compares it with `MmrLeaf.BeefyAuthorities` (`0xc745…a7d5`).
- Sections: The claim (statement + three steps from PRD §7.1) · Proven or trusted (§7.2 table) · Contracts (FillBook
  on V3, BeefyStateRoots and TalyxEscrow on Sepolia, each "Not deployed yet" until addresses exist) · Network (§2.8) ·
  BEEFY keys and a real justification (A.1, A.2 decoded field by field) · MMR peaks (A.3) · Encoding (§8.3–8.5) ·
  Prover CLI (§9.5 commands) · Forged-proof tests (T-1 to T-21) · Third-party code (§9.8).

---

## 5. Components

| Component | Desktop | Phone |
| --- | --- | --- |
| Nav bar | Wordmark left, five 15px links and the button right, plain row | Wordmark + button; links in a menu sheet |
| Notched stage | Cols 5–12 from 42% down, bleeds right/bottom, 120px notch | Full width after the text, 72px notch, fragment 16px inside |
| Byte forger (live) | 16 cells per row, roving tabindex, arrows move, Enter flips | 8 cells per row, 40×44 targets |
| Proof board | 4 across, 8px gaps, heading tile 2 wide | 2 across, heading full width |
| Order fields | 4 fields side by side, 84svh | Stacked, 64svh each |
| Tabbed plate | 50/50 split, square notched photo | Photo first, tabs, text, stacked action cells |
| Mosaic | 12 cols, 104px rows | 2 cols, 28vw rows |
| Accordion | Sticky heading left, `<details name>` tiles right | Heading above, full-width tiles |
| Create dialog | 440px, right half of the mint field | Full width, 52px button |
| Block wordmark | Full width, 34svh | 22svh |
| App sidebar | 240px, labelled | 48px top bar + full-screen sheet |
| App table | Rows 48px, numbers right-aligned, tabular | Two-line rows |
| Tally (order) | Two halves side by side, notched seam | Halves stacked, seam horizontal |
| Code block | `<pre>` with copy button | Scrolls inside its frame |

---

## 6. As built (changes from the plan above)

- **New order** is an inline panel above the order list, not a modal: nothing covers the page title, and the list stays
  in view while the form is filled in. The landing CTA opens it with `?to=&amount=#/orders/new`.
- **Live V3 data is real in preview mode.** The app reads best and BEEFY-finalized blocks from
  `wss://test-node-v3.portaldot.dev`, finds every stored `BEEF` justification and recovers both signers in the browser.
  A simulated fill takes the current V3 block and only turns "Signed" when a real justification for a *later* block
  arrives (the proof reads the state root of B−1). Orders and transactions stay simulated until the three
  `VITE_*_ADDRESS` variables are set.
- **Verify** carries two museum photographs (the claim, the justification) and sets reference tables on one tone step.
  Its live check recomputes the keyset commitment, both signatures on #279,494 and the MMR bag.
- **No video.** The only honest clip found (wood being cleaved) was a modern backyard scene and did not fit.

## 7. Avoid

- A centred hero over three icon cards; any row of identical icon-topped feature cards.
- Small uppercase labels or pill badges above headings ("NEW", "CROSS-CHAIN"); index numbers (01/02/03, "Step 2").
- Gradients, glows, glass panels, blurred blobs, neon-on-navy "web3" styling, violet or indigo.
- Hairline dividers and 1px outlined boxes on the public pages (the app keeps its quiet borders).
- Shadows on anything at rest.
- Monospace outside hashes, addresses and code.
- Fake proof: no invented users, volumes, TVL, partner logos, quotes or gas numbers. Gas stays "to be measured" until it is.
- Fake dashboards of grey bars; device frames around interface fragments.
- Hype words (seamless, trustless revolution, unlock, next-generation); stock tricolons.
- A styled accent word in a headline.
