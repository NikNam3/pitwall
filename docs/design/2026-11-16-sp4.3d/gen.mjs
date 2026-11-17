// Generates the SP4.3d display mockups (round 1): node gen.mjs  (Node 22.18 or later: it imports the real theme)
// Same method as docs/design/2026-11-12-sp4.3b/gen.mjs (copied, not imported): the real theme, panel frame B, sizes in
// character cells; presentation in one place each: THEME (roles, font, density), FMT (formats, mirroring
// kit/values/format.ts), TEXT (wording, the widgets' text.ts), DIST (the distribution strip, kit/dist). The generator
// throws when a line is wider than its panel or a cell wider than its column, so a misfit cannot ship.
// Sample: Spa, 44 laps dry, 20 cars, L14/44; our cars KUH (Mercedes #12, P8, mediums since L1, sets left S H H I) and
// LIN (Mercedes #63, P11). Every E[pos], ΔPOS and P(gain) is computed here from the distribution drawn next to it.
// Spec: docs/specs/2026-11-16-sp4.3d-planning-design.md §5–§7.
import { writeFileSync } from 'node:fs';
import { DEFAULT_THEME, FONT_FAMILY } from '../../../apps/ui/src/theme/themes.ts';

// ---------------------------------------------------------------- theme (the real one)
const R = DEFAULT_THEME.roles;
const FONT_PX = DEFAULT_THEME.fontPx;
const LINE = DEFAULT_THEME.density.lineHeight;
const GAP = DEFAULT_THEME.density.columnGapCols;
const CELL_W = (800 / 100 / 14) * FONT_PX; // JetBrains Mono's advance, measured in headless Chromium
const CELL_H = FONT_PX * LINE;
const BOLD = DEFAULT_THEME.table.boldWeight;

// ---------------------------------------------------------------- formats (mirror kit/values/format.ts)
const MINUS = '−';
const fixed = (v, d) => {
  const t = v.toFixed(d);
  if (/^-0(\.0*)?$/.test(t)) return t.slice(1);
  return t.startsWith('-') ? MINUS + t.slice(1) : t;
};
const signed = (v, d) => { const t = fixed(Math.abs(v), d); return `${v < 0 && Number(t) !== 0 ? MINUS : '+'}${t}`; };
const FMT = {
  lap: (n) => `L${String(n).padStart(2, '0')}`,
  position: (n) => `P${n}`,
  pct: (p) => `${fixed(p * 100, 0)}%`,
  signedSeconds: (ms, d) => signed(ms / 1000, d),
  seconds: (ms, d) => fixed(ms / 1000, d),
  expectedPlace: (p) => fixed(p, 2),
  /** E[pos] with its MC standard error: `7.52±.06` (the SE without its leading zero) */
  expectedPlaceSe: (p, se) => `${fixed(p, 2)}±${fixed(se, 2).replace(/^0/, '')}`,
  placesGained: (g) => signed(g, 2),
  count: (n) => fixed(n, 0),
};

// ---------------------------------------------------------------- wording (kit/text.ts and each widget's text.ts)
const TEXT = {
  unknownReason: { notApplicable: 'not applicable', insufficientData: 'too few laps or samples yet', notReceived: 'not received yet' },
  unknownMark: { notApplicable: '–', insufficientData: '…', notReceived: '…' },
  noDataYet: 'no data yet',
  arrow: '→',
  badge: { calibration: 'ᶜ', default: 'ᵈ' },
  badgeHover: { calibration: 'from the calibration set', default: 'from the defaults (no calibration)' },
  board: {
    title: 'Plan board',
    headers: { slot: '', start: 'START', stops: 'STOPS', ePos: 'E[POS]', dPos: 'ΔPOS', dTime: 'ΔTIME', act: '' },
    dp: 'DP',
    noStop: 'no stop',
    toSlot: '→ slot', activate: 'activate', edit: 'edit', remove: '×', accept: 'accept',
    saveTo: (s) => `save to ${s}`, saveAs: (s) => `save as ${s}`, cancel: 'cancel', addStop: '+ stop',
    active: '●',
    infeasibleHover: { stopLapPassed: 'its stop lap has passed: followed as far as it can be (box this lap)', noSetLeft: 'no set of that compound left' },
    planningInputs: { grid: 'GRID', laps: 'LAPS', rain: 'RAIN', n: 'N' },
    prefillHover: 'prefilled from the DP: accept to keep it',
    nHover: 'scenarios run',
  },
  card: {
    title: 'Box call',
    headers: { opt: '', ePos: 'E[POS]', dPos: 'ΔPOS', pGain: 'P(GAIN)', rej: 'REJ' },
    cond: { sc: 'SC', vsc: 'VSC', green: 'GREEN' },
    stay: 'stay', box: (c) => `box ${c}`, noSet: 'no set',
    out: (c, laps) => `${c} out · ~${laps} laps`,
    ifNow: 'if now',
  },
  overview: { title: 'Field plans', headers: { car: '', pos: 'POS', gap: 'GAP', tyre: 'TYRE', stp: 'ST', owe: '', next: 'NEXT', win: 'WINDOW' }, oweMark: '²', oweHover: 'still owes its second dry compound', planB: 'B' },
  strategyTab: 'Strategy',
  circle: { title: 'Circle', ghost: { green: 'G', vsc: 'V', sc: 'S' } },
};

// ---------------------------------------------------------------- CSS from the theme
const CSS = `
@font-face { font-family:'JetBrains Mono'; src:url('../../../apps/ui/src/theme/font/JetBrainsMono%5Bwght%5D.woff2') format('woff2'); font-weight:100 800; font-display:block; }
:root { ${Object.entries(R).map(([k, v]) => `--pw-${k}:${v};`).join(' ')} --pw-font:${FONT_FAMILY}; --pw-font-px:${FONT_PX}px; --pw-line:${LINE}; }
* { box-sizing:border-box; margin:0; padding:0; }
body { background:var(--pw-bg); color:var(--pw-text); font-family:var(--pw-font); font-size:var(--pw-font-px); line-height:var(--pw-line); font-variant-ligatures:none; padding:24px 28px 56px; }
h1 { font-size:var(--pw-font-px); font-weight:600; margin-bottom:4px; }
h2 { font-size:var(--pw-font-px); font-weight:500; color:var(--pw-textDim); margin:26px 0 8px; }
.note { color:var(--pw-textDim); max-width:150ch; margin-bottom:10px; }
.note b { color:var(--pw-text); font-weight:500; }
.row { display:flex; gap:24px; align-items:flex-start; flex-wrap:wrap; } .row > div { width:min-content; }
.panel { background:var(--pw-bgPanel); display:inline-block; vertical-align:top; outline:1px dashed var(--pw-border); }
.ph { display:flex; gap:1ch; padding:0 1ch; background:var(--pw-bgBand); white-space:nowrap; color:var(--pw-textFaint); }
.ph .t { color:var(--pw-textDim); } .ph .sp { flex:1; } .ph .lk { color:var(--pw-text); } .ph .w { color:var(--pw-warning); }
pre { font-family:inherit; font-size:inherit; line-height:inherit; padding:0 1ch; white-space:pre; }
pre svg { display:inline-block; vertical-align:top; }
.cap { color:var(--pw-textFaint); margin:4px 0 0; min-width:44ch; }
.d { color:var(--pw-textDim); } .f { color:var(--pw-textFaint); } .w { color:var(--pw-warning); }
.hi { color:var(--pw-ownCar); font-weight:${BOLD}; }
.band { background:var(--pw-bgRowBand); display:inline-block; width:100%; }
.me { color:var(--pw-ownCar); font-weight:${BOLD}; box-shadow:inset ${DEFAULT_THEME.table.barPx}px 0 0 var(--pw-text); display:inline-block; width:100%; }
.sel { background:var(--pw-bgBand); display:inline-block; width:100%; }
.tip { text-decoration:underline dotted var(--pw-textFaint); }
.fld { box-shadow:inset 0 0 0 ${DEFAULT_THEME.table.borderPx}px var(--pw-border); color:var(--pw-text); }
.fld.on { box-shadow:inset 0 0 0 ${DEFAULT_THEME.table.borderPx}px var(--pw-focus); color:var(--pw-ownCar); }
.fld.bad { box-shadow:inset 0 0 0 ${DEFAULT_THEME.table.borderPx}px var(--pw-warning); color:var(--pw-warning); }
.btn { color:var(--pw-textDim); }
`;

// ---------------------------------------------------------------- HTML helpers
const strip = (s) => s.replace(/<svg data-cells="(\d+)"[\s\S]*?<\/svg>/g, (_, n) => 'x'.repeat(Number(n))).replace(/<[^>]+>/g, '');
const vis = (s) => [...strip(s)].length;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const span = (cls, t, tip) => (cls || tip ? `<span${cls ? ` class="${cls}"` : ''}${tip ? ` title="${esc(tip)}"` : ''}>${t}</span>` : t);
const sp = (n) => ' '.repeat(Math.max(0, n));
const padR = (s, n) => s + sp(n - vis(s));
const padL = (s, n) => sp(n - vis(s)) + s;
const C = (t, c, tip) => ({ t, c, tip });
const U = (reason) => ({ t: span('f tip', TEXT.unknownMark[reason], TEXT.unknownReason[reason]) });
const GEAR = '<svg width="14" height="14" viewBox="0 0 14 14" style="display:inline;vertical-align:-2px"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="1.1" stroke-dasharray="2 1.4"/><circle cx="7" cy="7" r="2.1" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>';
const widthOf = (spec, lead = 1) => lead + spec.reduce((a, c) => a + c.w, 0) + GAP * (spec.length - 1);

/** Character-cell table: spec = [{ h, w, a }], rows = [{ cls?, band?, cells } | { raw }]; GAP cells apart. */
function table(spec, rows, { head = true, band = true, lead = 1, headCells } = {}) {
  const fit = (text, i) => {
    const w = spec[i].w;
    if (vis(text) > w) throw new Error(`cell "${strip(text)}" is wider than its column ${spec[i].h || i} (${w})`);
    return spec[i].a === 'r' ? padL(text, w) : padR(text, w);
  };
  const cell = (x, i) => {
    const o = typeof x === 'string' ? { t: x } : x;
    const v = fit(o.t ?? '', i);
    return o.c || o.tip ? span(o.c, v, o.tip) : v;
  };
  const out = [];
  if (head) out.push(span('f', sp(lead) + (headCells ?? spec.map((c) => c.h)).map((h, i) => fit(h, i)).join(sp(GAP))));
  let k = 0;
  for (const r of rows) {
    if (r.raw !== undefined) { out.push(r.raw); continue; }
    const line = sp(lead) + r.cells.map(cell).join(sp(GAP));
    const banded = r.band ?? (band && k % 2 === 1);
    const cls = [r.cls ?? '', banded && !r.cls ? 'band' : ''].filter(Boolean).join(' ');
    out.push(cls ? span(cls, line) : line);
    k++;
  }
  return out;
}

const SIZES = [];
function panel(title, { cols, rows, link = '', state = '', lines = [], size, body }) {
  for (const l of lines) if (vis(l) > cols) throw new Error(`${title}: line wider than ${cols}: "${strip(l)}" (${vis(l)})`);
  if (rows !== undefined && lines.length > rows) throw new Error(`${title}: ${lines.length} rows, more than ${rows}`);
  if (size) SIZES.push(`${title} ${size}: ${cols}×${rows ?? lines.length}`);
  const fill = rows !== undefined && body === undefined ? rows - lines.length : 0;
  const inner = body ?? `<pre>${lines.join('\n')}</pre>`;
  return `<div class="panel" style="width:${cols + 2}ch"><div class="ph"><span class="t">${title}</span><span class="lk">${link}</span><span class="sp"></span><span>${state}</span><span>${GEAR}</span></div>${inner}${fill > 0 ? `<div style="height:${fill * CELL_H}px"></div>` : ''}</div>`;
}
const cap = (t) => `<div class="cap">${t}</div>`;
const fig = (p, c) => `<div>${p}${cap(c)}</div>`;
const page = (file, title, body) => {
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>${CSS}</style></head><body><h1>${title}</h1>${body}</body></html>\n`;
  writeFileSync(new URL(file, import.meta.url), html);
};

// ================================================================ DIST: the places strip (kit/dist, as approved in 4.3b)
const DIST = { top: 2, base: CELL_H - 3, barInset: 1 };
const svgOpen = (cells) => `<svg data-cells="${cells}" width="${cells * CELL_W}" height="${CELL_H}" viewBox="0 0 ${cells * CELL_W} ${CELL_H}">`;
function placesStrip(p, { max, now, own = false, faint = false }) {
  const n = p.length;
  let s = svgOpen(n);
  s += `<line x1="0" x2="${n * CELL_W}" y1="${DIST.base + 0.5}" y2="${DIST.base + 0.5}" stroke="${R.border}"/>`;
  if (now !== undefined) s += `<rect x="${(now - 1) * CELL_W}" y="${DIST.base}" width="${CELL_W}" height="2" fill="${R.text}"/>`;
  p.forEach((v, i) => {
    const h = Math.max(0, ((DIST.base - DIST.top) * v) / max);
    if (h < 0.4) return;
    s += `<rect x="${i * CELL_W + DIST.barInset}" y="${DIST.base - h}" width="${CELL_W - 2 * DIST.barInset}" height="${h}" fill="${own ? R.ownCar : faint ? R.textFaint : R.text}"/>`;
  });
  return s + '</svg>';
}
const placesHeader = (n = 20) => padR('P1', 9) + padR('P10', 8) + 'P20'.padStart(n - 17);

// ================================================================ the model numbers (illustrative, computed from their distributions)
const PLACES = 20;
const sum = (a) => a.reduce((x, y) => x + y, 0);
function placeDist(mu, sdL, sdR, dnf = 0.015) {
  const w = Array.from({ length: PLACES }, (_, i) => { const d = i + 1 - mu; const s = d < 0 ? sdL : sdR; return Math.exp(-(d * d) / (2 * s * s)); });
  const t = sum(w);
  const p = w.map((x) => (x / t) * (1 - dnf));
  p[PLACES - 1] += dnf;
  return p;
}
const ePos = (p) => sum(p.map((x, i) => x * (i + 1)));
/** P(the option finishes ahead of staying out), the two independent (illustrative). */
const pAhead = (p, q) => { let s = 0; for (let i = 0; i < PLACES; i++) for (let j = i + 1; j < PLACES; j++) s += p[i] * q[j]; return s; };
const NOW = 14, FLAG = 44, OUR_PLACE = 8;
const LAP_MS = 106_000;

// ================================================================ 1. plan-board (V17)
const B = TEXT.board;
const stopsText = (stops) => (stops.length === 0 ? B.noStop : stops.map(([l, c]) => `${FMT.lap(l)} ${c}`).join(' · '));
// Race, L14: the slots and the DP's best per stop count. timeMs is the mean race time against the active plan.
const SLOTS = [
  { slot: 'A', active: true, stops: [[22, 'H']], mu: 7.52, sd: [1.6, 1.9], se: 0.06, timeMs: 0 },
  { slot: 'B', stops: [[18, 'H'], [33, 'S']], mu: 7.21, sd: [1.7, 1.9], se: 0.07, timeMs: -2400 },
  { slot: 'C', stops: [[13, 'H'], [30, 'H']], mu: 8.40, sd: [1.6, 2.1], se: 0.08, timeMs: 4200, infeasible: 'stopLapPassed' },
  { slot: 'G1', stops: [[20, 'H']], mu: 7.47, sd: [1.6, 1.9], se: 0.06, timeMs: -500 },
  { slot: 'G2', stops: [[17, 'S'], [31, 'H']], mu: 7.74, sd: [1.7, 2.0], se: 0.07, timeMs: 1600 },
];
const DP_PICKS = [
  { stops: [], mu: 8.94, sd: [1.5, 2.4], se: 0.08, timeMs: 12_200 },
  { stops: [[21, 'H']], mu: 7.44, sd: [1.6, 1.9], se: 0.06, timeMs: -600 },
  { stops: [[20, 'H'], [34, 'S']], mu: 7.30, sd: [1.7, 1.9], se: 0.07, timeMs: -1900 },
  { stops: [[16, 'H'], [27, 'H'], [37, 'S']], mu: 7.95, sd: [1.8, 2.0], se: 0.08, timeMs: 3300 },
];
const withP = (r) => { const p = placeDist(r.mu, r.sd[0], r.sd[1]); return { ...r, p, ePos: ePos(p) }; };
const boardSpec = ({ full, planning }) => {
  const s = [{ h: '', w: 3 }];
  if (planning) s.push({ h: B.headers.start, w: 5 });
  s.push({ h: B.headers.stops, w: full ? 23 : 15 }, { h: B.headers.ePos, w: 9, a: 'r' }, { h: B.headers.dPos, w: 6, a: 'r' });
  if (full) s.push({ h: B.headers.dTime, w: 6, a: 'r' }, { h: '', w: 20 }, { h: '', w: 8 });
  return s;
};
function boardLines({ full = true, planning = false, cold = false, selected, slots = SLOTS, dp = DP_PICKS, starts = {} } = {}) {
  const spec = boardSpec({ full, planning });
  const s = slots.map(withP), d = dp.map(withP);
  const ref = s.find((r) => r.active) ?? s[0];
  const max = Math.max(...[...s, ...d].flatMap((r) => r.p));
  const head = spec.map((c) => c.h);
  if (full) head[head.length - 2] = placesHeader();
  const badge = (kind) => (cold ? span('d tip', TEXT.badge[kind], TEXT.badgeHover[kind]) : '');
  const row = (r, isSlot) => {
    const isRef = r === ref;
    const faint = r.infeasible !== undefined;
    const slotCell = isSlot ? C(`${r.slot}${r.active ? B.active : ''}`) : C('');
    const stops = faint ? C(stopsText(r.stops), 'f tip', B.infeasibleHover[r.infeasible]) : C(stopsText(r.stops), r.prefill ? 'd tip' : '', r.prefill ? B.prefillHover : undefined);
    const eCell = C(FMT.expectedPlaceSe(r.ePos, cold ? r.se * 3 : r.se) + badge(isSlot ? 'calibration' : 'default'));
    const dPos = isRef ? '' : C(FMT.placesGained(ref.ePos - r.ePos), ref.ePos - r.ePos < -1 ? 'w' : '');
    const cells = [slotCell];
    if (planning) cells.push(starts[r.slot ?? stopsText(r.stops)] ?? '');
    cells.push(stops, eCell, dPos);
    if (full) {
      const same = !isSlot ? s.find((x) => stopsText(x.stops) === stopsText(r.stops) && (!planning || starts[x.slot] === starts[stopsText(r.stops)])) : undefined;
      const act = !isSlot ? (same ? C(`= ${same.slot}`, 'd', 'the same plan as this slot') : C(B.toSlot, 'btn', 'plan.save')) : r.prefill ? C(B.accept, 'btn', 'plans.prepare.accept') : '';
      cells.push(isRef ? '' : FMT.signedSeconds(r.timeMs - ref.timeMs, 1), { t: placesStrip(r.p, { max, now: planning ? undefined : OUR_PLACE, own: r.active, faint }) }, act);
    }
    const cls = r.active ? 'me' : faint ? 'f' : selected !== undefined && selected === r.slot ? 'sel' : '';
    return { cls, band: false, cells };
  };
  const width = widthOf(spec);
  const lines = table(spec, s.map((r) => row(r, true)), { headCells: head });
  lines.push(span('f', ` ─ ${B.dp} ${'─'.repeat(width - 6)}`));
  lines.push(...table(spec, d.map((r) => row(r, false)), { head: false }));
  return { lines, width };
}
const L1 = '1 · KUH';
const raceState = (n = 1200) => `${FMT.position(OUR_PLACE)} · ${FMT.lap(NOW)}/${FLAG} · ${span('tip', `N ${n}`, B.nHover)}`;
const bFull = boardLines({ full: true, selected: 'B' });
const gain = (slot) => { const a = withP(SLOTS[0]), x = withP(SLOTS.find((r) => r.slot === slot)); return a.ePos - x.ePos; };
const selLine = ` ${span('d', 'B')}  ${span('btn', B.activate)}  ${span('btn', B.edit)}  ${span('btn', B.remove)}`;
const BOARD_FULL = { cols: bFull.width, rows: bFull.lines.length + 2 };
const bCompact = boardLines({ full: false, slots: SLOTS.filter((r) => ['A', 'B', 'G1'].includes(r.slot)), dp: DP_PICKS.filter((r) => r.stops.length >= 1 && r.stops.length <= 2) });
const BOARD_COMPACT = { cols: bCompact.width, rows: bCompact.lines.length };

// editing B
const f = (t, cls = 'fld') => span(cls, t);
const editLines = [
  ` B   ${span('d', 'L')}${f('18', 'fld on')} ${TEXT.arrow} ${f('H')} ${span('btn', '×')}   ${span('d', 'L')}${f('33')} ${TEXT.arrow} ${f('S')} ${span('btn', '×')}   ${span('btn', B.addStop)}`,
  '',
  `     ${span('btn', B.saveTo('B'))}  ${span('btn', B.saveAs('C'))}  ${span('btn', B.cancel)}`,
];
const editBad = [
  ` B   ${span('d', 'L')}${f('18')} ${TEXT.arrow} ${f('H')} ${span('btn', '×')}   ${span('d', 'L')}${span('fld bad tip', '48', 'rejected: beyond the flag (L44)')} ${TEXT.arrow} ${f('S')} ${span('btn', '×')}   ${span('btn', B.addStop)}`,
  '',
  `     ${span('btn', B.saveTo('B'))}  ${span('btn', B.saveAs('C'))}  ${span('btn', B.cancel)}`,
];

// planning round (after qualifying): start compound free; A and B prefilled; G1 entered, G2 being entered
const PLAN_SLOTS = [
  { slot: 'A', active: true, prefill: true, stops: [[22, 'H']], mu: 7.62, sd: [1.6, 1.9], se: 0.06, timeMs: 0 },
  { slot: 'B', prefill: true, stops: [[12, 'H'], [30, 'M']], mu: 7.40, sd: [1.7, 1.9], se: 0.07, timeMs: -1800 },
  { slot: 'G1', stops: [[19, 'H']], mu: 7.71, sd: [1.6, 1.9], se: 0.06, timeMs: 700 },
];
const PLAN_DP = [
  { stops: [], mu: 9.10, sd: [1.5, 2.4], se: 0.08, timeMs: 13_000 },
  { stops: [[22, 'H']], mu: 7.62, sd: [1.6, 1.9], se: 0.06, timeMs: 0 },
  { stops: [[12, 'H'], [30, 'M']], mu: 7.40, sd: [1.7, 1.9], se: 0.07, timeMs: -1800 },
  { stops: [[11, 'H'], [23, 'H'], [35, 'S']], mu: 8.02, sd: [1.8, 2.0], se: 0.08, timeMs: 3400 },
];
const START = { A: 'M', B: 'S', G1: 'M', [B.noStop]: 'H', [stopsText([[22, 'H']])]: 'M', [stopsText([[12, 'H'], [30, 'M']])]: 'S', [stopsText([[11, 'H'], [23, 'H'], [35, 'S']])]: 'S' };
const pl = boardLines({ full: true, planning: true, slots: PLAN_SLOTS, dp: PLAN_DP, starts: START });
const PI = B.planningInputs;
const planInputs = ` ${span('f', PI.grid)} ${FMT.position(OUR_PLACE)}   ${span('f', PI.laps)} ${f('44', 'fld on')}   ${span('f', PI.rain)} 10%   ${span('f', PI.n)} 1200`;
const g2Entry = ` G2  ${f('M')}    ${span('d', 'L')}${f('  ')} ${TEXT.arrow} ${f(' ')}  ${span('btn', B.addStop)}  ${span('btn', B.saveTo('G2'))}`;
const PLAN_FULL = { cols: pl.width, rows: pl.lines.length + 3 };

// cold start (L03 after a restart): fewer runs, wider SE, every number with its source badge
const COLD = boardLines({ full: true, cold: true, slots: SLOTS.slice(0, 2), dp: DP_PICKS.slice(1, 3) });

page('plan-board.html', 'SP4.3d · plan-board (V17), round 1', `
<div class="note">Sample: Spa L14/44, KUH P8 on mediums since L1, sets left S H H I. A plan is only its stops (spec §5.1). <b>Slots</b> A, B, C (ours) and G1, G2 (the game's two plans, entered by hand); the active one has the dot and the white bar. ΔPOS and ΔTIME against the active plan, positive = good; the ± is the Monte Carlo's SE. Below <b>DP</b> the DP's best plan per stop count (no stop, 1, 2, 3), each with <code>→ slot</code>. A slot that can no longer be followed (its stop lap passed) is greyed, the reason on hover. The strip is the finishing-place distribution P1…P20 (our place now underlined). A click on a slot selects it and shows its actions (activate, edit, remove).</div>
<h2>Race · full ${BOARD_FULL.cols}×${BOARD_FULL.rows}</h2>
<div class="row">${fig(panel(B.title, { ...BOARD_FULL, link: L1, state: raceState(), lines: [...bFull.lines, '', selLine], size: 'full' }), `B selected: its actions on the last line. C's first stop (L13) has passed: greyed. G1 (the game's plan) is ${FMT.placesGained(gain('G1'))} against A, inside the noise; B ${FMT.placesGained(gain('B'))}.`)}</div>
<h2>Race · compact ${BOARD_COMPACT.cols}×${BOARD_COMPACT.rows}</h2>
<div class="row">${fig(panel(B.title, { ...BOARD_COMPACT, link: L1, state: FMT.lap(NOW), lines: bCompact.lines, size: 'compact' }), 'compact: no ΔTIME, no strip; the slots and the DP\'s 1- and 2-stop')}</div>
<h2>Editing a slot</h2>
<div class="row">${fig(panel(B.title, { cols: 56, rows: 3, link: L1, state: 'B', lines: editLines }), 'laps and compounds only; nothing changes until saved; "save as C" keeps B and adds the edit as a new slot (improvising)')}${fig(panel(B.title, { cols: 56, rows: 3, link: L1, state: 'B', lines: editBad }), 'a rejected value (the bridge validates, C73): amber, the reason on hover; never stored')}</div>
<h2>Planning round (after qualifying, panel option source: planning)</h2>
<div class="row">${fig(panel(B.title + ' · race', { ...PLAN_FULL, link: L1, state: 'SPA', lines: [planInputs, '', ...pl.lines.slice(0, 4), g2Entry, ...pl.lines.slice(4)] }), 'the race inputs on the first line (grid place, the race laps you enter, the race\'s rain chance from qualifying\'s forecast, runs); START is part of each plan; A and B prefilled from the DP (dim) with <code>accept</code>; G1 entered; G2 being entered')}</div>
<h2>Cold start and states</h2>
<div class="row">${fig(panel(B.title, { cols: COLD.width, rows: COLD.lines.length, link: L1, state: `${FMT.lap(3)}/${FLAG} · N 400`, lines: COLD.lines }), 'L03 after a restart: wider ±, every number with its source badge (ᶜ calibration, ᵈ default)')}${fig(panel(B.title, { cols: 40, rows: 2, link: L1, state: span('f', TEXT.noDataYet), lines: [] }), 'computing, no result yet')}${fig(panel(B.title, { cols: 40, rows: 2, link: L1, lines: [span('f tip', ' ' + TEXT.unknownMark.notApplicable, TEXT.unknownReason.notApplicable)] }), 'notApplicable (not a race, no session)')}</div>
`);

// ================================================================ 2. sc-card reworked: the box call (V18)
const K = TEXT.card;
const COMPOUNDS = ['S', 'M', 'H', 'I', 'W'];
const SETS = new Set(['S', 'H', 'I']);
// per condition: stay and the box options (mu, rejoin); a missing compound has no set
const CALL = {
  sc: { stay: { mu: 7.61, rej: 8 }, S: { mu: 8.10, rej: 11 }, H: { mu: 6.88, rej: 10 }, I: { mu: 12.4, rej: 11 } },
  vsc: { stay: { mu: 7.55, rej: 8 }, S: { mu: 8.42, rej: 12 }, H: { mu: 7.20, rej: 11 }, I: { mu: 12.9, rej: 12 } },
  green: { stay: { mu: 7.52, rej: 8 }, S: { mu: 9.40, rej: 15 }, H: { mu: 8.31, rej: 15 }, I: { mu: 14.2, rej: 15 } },
};
const cardSpec = [{ h: '', w: 6 }, { h: K.headers.ePos, w: 9, a: 'r' }, { h: K.headers.dPos, w: 6, a: 'r' }, { h: K.headers.pGain, w: 7, a: 'r' }, { h: K.headers.rej, w: 4, a: 'r' }, { h: '', w: 20 }];
const CARD_W = widthOf(cardSpec);
function block(cond) {
  const c = CALL[cond];
  const stay = { ...c.stay, p: placeDist(c.stay.mu, 1.6, 1.9) };
  const opts = COMPOUNDS.map((x) => (SETS.has(x) ? { x, ...c[x], p: placeDist(c[x].mu, 1.7, 2.0) } : { x, none: true }));
  const all = [stay, ...opts.filter((o) => !o.none)];
  all.forEach((o) => { o.ePos = ePos(o.p); });
  const best = all.reduce((a, b) => (b.ePos < a.ePos ? b : a));
  const max = Math.max(...all.flatMap((o) => o.p));
  const head = [K.cond[cond], ...cardSpec.slice(1, 5).map((s) => s.h), placesHeader()];
  const row = (o, label) => {
    if (o.none) return { band: false, cells: [C(label, 'f'), C(K.noSet, 'f'), '', '', '', ''] };
    const isStay = o === stay;
    const g = stay.ePos - o.ePos;
    return {
      cls: o === best ? 'hi' : '', band: false,
      cells: [label, FMT.expectedPlaceSe(o.ePos, 0.07), isStay ? '' : C(FMT.placesGained(g), g < -1 ? 'w' : ''), isStay ? '' : FMT.pct(pAhead(o.p, stay.p)), FMT.position(o.rej), { t: placesStrip(o.p, { max, now: OUR_PLACE, own: o === best }) }],
    };
  };
  return table(cardSpec, [row(stay, K.stay), ...opts.map((o) => row(o, K.box(o.x)))], { headCells: head });
}
function compactBlock(cond) {
  const c = CALL[cond];
  const stay = ePos(placeDist(c.stay.mu, 1.6, 1.9));
  const opts = COMPOUNDS.filter((x) => SETS.has(x)).map((x) => ({ x, e: ePos(placeDist(c[x].mu, 1.7, 2.0)), rej: c[x].rej }));
  const b = opts.reduce((a, o) => (o.e < a.e ? o : a));
  const g = stay - b.e;
  return ` ${padR(K.cond[cond], 6)}${padR(K.box(b.x), 6)} ${padL(FMT.placesGained(g), 6)} ${padL(FMT.position(b.rej), 4)}`;
}
const ALL = [...block('sc'), '', ...block('vsc'), '', ...block('green')];
const CARD_FULL = { cols: CARD_W, rows: ALL.length };
const CARD_COMPACT = { cols: 26, rows: 3 };
const outState = (c, laps) => span('w', K.out(c, laps));
page('sc-card.html', 'SP4.3d · sc-card reworked: the box call (V18), round 1', `
<div class="note">Sample: Spa L14/44, KUH P8 on mediums, sets left S H H I. Computed every lap before anything happens (spec §6.3): per condition the six answers, stay out and box onto each compound; "box X" is "box now onto X, then the DP's best continuation". ΔPOS against staying out, positive = good; P(GAIN) the chance to finish ahead of staying out; REJ the rejoin place (from <code>rejoin</code>); the strip the finishing places. The best row of each block is white. A compound without a set left: "no set". <b>Title:</b> "Box call" replaces "SC / VSC call" now that GREEN is in it (the widget id stays <code>sc-card</code>).</div>
<h2>Green running · full ${CARD_FULL.cols}×${CARD_FULL.rows}</h2>
<div class="row">${fig(panel(K.title, { ...CARD_FULL, link: L1, state: `${FMT.lap(NOW)} · ${K.ifNow}`, lines: ALL, size: 'full' }), `all three blocks ready: under an SC box for hards (${compactBlock('sc').trim().split(/\s+/)[3]}), under a VSC hards too (${compactBlock('vsc').trim().split(/\s+/)[3]}), under green stay out`)}</div>
<h2>SC out · VSC out</h2>
<div class="row">${fig(panel(K.title, { cols: CARD_W, rows: 7, link: L1, state: outState('SC', 4), lines: block('sc') }), 'an SC is out: only its block, the header amber with its expected laps left; GREEN hidden (no green stop possible)')}${fig(panel(K.title, { cols: CARD_W, rows: 7, link: L1, state: outState('VSC', 2), lines: block('vsc') }), 'a VSC is out')}</div>
<h2>Compact ${CARD_COMPACT.cols}×${CARD_COMPACT.rows}</h2>
<div class="row">${fig(panel(K.title, { ...CARD_COMPACT, link: L1, lines: ['sc', 'vsc', 'green'].map(compactBlock).map((l, i) => (i < 2 ? span('hi', l) : l)), size: 'compact' }), 'compact: per condition the best box option, its ΔPOS and rejoin (white where it beats staying out)')}${fig(panel(K.title, { cols: 26, rows: 1, link: L1, state: span('w', 'SC ~4'), lines: [span('hi', compactBlock('sc'))] }), 'compact, SC out: the header shortened to the condition and its laps')}</div>
`);

// ================================================================ 3. strategy-overview (V06): the field within one pit loss
const O = TEXT.overview;
// per car: code, pos, gap (ms, + = behind KUH), stints done [[from, to, compound]], current [from, compound], window, next odds, owes
const FIELD = [
  { code: 'ALO', pos: 5, gap: -15_200, stints: [[1, 12, 'S']], cur: [13, 'H'], win: null, owes: false },
  { code: 'NOR', pos: 6, gap: -9_800, stints: [], cur: [1, 'M'], win: [16, 18, 20], next: { H: 0.8, S: 0.2 }, owes: true },
  { code: 'PIA', pos: 7, gap: -3_100, stints: [], cur: [1, 'M'], win: [18, 20, 23], next: { H: 0.7, S: 0.3 }, owes: true },
  { code: 'KUH', pos: 8, gap: 0, own: true, stints: [], cur: [1, 'M'], planA: [[22, 'H']], planB: [[18, 'H'], [33, 'S']] },
  { code: 'RUS', pos: 9, gap: 1_400, stints: [], cur: [1, 'M'], win: [19, 21, 24], next: { H: 0.9, S: 0.1 }, owes: true },
  { code: 'SAI', pos: 10, gap: 6_000, stints: [], cur: [1, 'H'], win: [24, 27, 30], next: { M: 0.6, S: 0.4 }, owes: true },
  { code: 'LIN', pos: 11, gap: 9_500, own: true, mate: true, stints: [], cur: [1, 'M'], planA: [[21, 'H']], planB: [[17, 'H'], [32, 'S']] },
  { code: 'GAS', pos: 12, gap: 14_200, stints: [], cur: [1, 'S'], win: [13, 15, 17], next: { H: 0.85, M: 0.15 }, owes: true },
  { code: 'OCO', pos: 13, gap: 20_900, stints: [], cur: [1, 'M'], win: [20, 23, 26], next: { H: 0.75, S: 0.25 }, owes: true },
];
const LAPS_CELLS = FLAG; // one cell a lap
const oSpec = [{ h: '', w: 3 }, { h: O.headers.pos, w: 3, a: 'r' }, { h: O.headers.gap, w: 5, a: 'r' }, { h: O.headers.tyre, w: 4 }, { h: O.headers.owe, w: 1 }, { h: O.headers.next, w: 4 }, { h: '', w: LAPS_CELLS }];
const OV_W = widthOf(oSpec);
function laneSvg(car) {
  const n = LAPS_CELLS, h = CELL_H;
  const x = (lap) => (lap - 1) * CELL_W;
  const y0 = 3, y1 = h - 3;
  let s = svgOpen(n);
  const block = (from, to, comp, fill, stroke, label = true, op = 1) => {
    s += `<rect x="${x(from) + 0.5}" y="${y0}" width="${(to - from + 1) * CELL_W - 1}" height="${y1 - y0}" fill="${fill}" stroke="${stroke}" opacity="${op}"/>`;
    if (label) s += `<text x="${x(from) + 3}" y="${y1 - 2}" font-size="${FONT_PX - 3}" fill="${R.bg}" font-family="${FONT_FAMILY.replace(/'/g, '')}" font-weight="700">${comp}</text>`;
  };
  // past and current stint to now: solid
  for (const [a, b, c] of car.stints) block(a, b, c, car.own ? R.ownCar : R.textDim, 'none');
  block(car.cur[0], NOW, car.cur[1], car.own ? R.ownCar : R.textDim, 'none');
  if (car.own) {
    // plan A: outlined blocks in white; plan B: a faint line under them with ticks at its stops
    const stops = car.planA; let from = NOW + 1, comp = car.cur[1];
    for (const [l, c] of stops) { block(from, l, comp, 'none', R.ownCar, false); s += `<text x="${x(from) + 3}" y="${y1 - 2}" font-size="${FONT_PX - 3}" fill="${R.ownCar}" font-family="monospace">${from === NOW + 1 ? '' : comp}</text>`; from = l + 1; comp = c; }
    block(from, FLAG, comp, 'none', R.ownCar, false);
    s += `<text x="${x(from) + 3}" y="${y1 - 2}" font-size="${FONT_PX - 3}" fill="${R.ownCar}" font-family="monospace">${comp}</text>`;
    s += `<line x1="${x(NOW + 1)}" x2="${x(FLAG + 1)}" y1="${h - 1}" y2="${h - 1}" stroke="${R.textDim}"/>`;
    for (const [l] of car.planB) s += `<path d="M${x(l + 1) - 3} ${h} L${x(l + 1)} ${h - 5} L${x(l + 1) + 3} ${h} Z" fill="${R.textDim}"/>`;
  } else if (car.win) {
    const [lo, mid, hi] = car.win;
    // the current stint goes on faint up to the window; the window shaded, darkest at mid; after it the next stint faint
    if (lo > NOW + 1) block(NOW + 1, lo - 1, '', R.textFaint, 'none', false, 0.35);
    for (let l = Math.max(lo, NOW + 1); l <= hi; l++) {
      const w = 1 - Math.abs(l - mid) / (Math.max(mid - lo, hi - mid) + 1);
      s += `<rect x="${x(l) + 0.5}" y="${y0}" width="${CELL_W - 1}" height="${y1 - y0}" fill="${R.text}" opacity="${(0.15 + 0.55 * w).toFixed(2)}"/>`;
    }
    const top = Object.entries(car.next).sort((a, b) => b[1] - a[1])[0][0];
    block(hi + 1, FLAG, top, R.textFaint, 'none', true, 0.35);
  } else {
    block(NOW + 1, FLAG, '', R.textFaint, 'none', false, 0.35);
  }
  s += `<line x1="${x(NOW + 1)}" x2="${x(NOW + 1)}" y1="0" y2="${h}" stroke="${R.text}"/>`;
  return s + '</svg>';
}
const axis = () => {
  let a = '';
  for (let l = 1; l <= FLAG; l++) a += l === 1 || l % 10 === 0 ? String(l).padEnd(l === 1 ? 9 : 10, ' ').slice(0, 1) : '';
  // simple: labels at L1, L10, L20, L30, L40 placed at their cells
  const cells = Array(LAPS_CELLS).fill(' ');
  for (const l of [1, 10, 20, 30, 40]) { const t = String(l); for (let i = 0; i < t.length; i++) cells[l - 1 + i] = t[i]; }
  return cells.join('');
};
const nextText = (car) => (car.own ? '' : car.win ? (() => { const [c, p] = Object.entries(car.next).sort((a, b) => b[1] - a[1])[0]; return `${c}${fixed(p * 100, 0)}`; })() : '');
function overviewLines(center = 'KUH', mate = 'LIN') {
  const head = [...oSpec.slice(0, 6).map((c) => c.h), axis()];
  const off = FIELD.find((c) => c.code === center).gap;
  const field = FIELD.map((c) => ({ ...c, gap: c.gap - off })).filter((c) => c.code === mate || Math.abs(c.gap) <= 21_800);
  const rows = field.map((car) => ({
    cls: car.code === center ? 'me' : car.code === mate ? 'hi' : '', band: false,
    cells: [car.code, FMT.position(car.pos), car.gap === 0 ? '' : FMT.signedSeconds(car.gap, 1), `${car.cur[1]} ${NOW - car.cur[0] + 1}`, car.owes ? C(O.oweMark, 'd', O.oweHover) : '', C(nextText(car), 'd', car.win ? Object.entries(car.next).map(([c, p]) => `${c} ${FMT.pct(p)}`).join(' · ') + ` · window ${FMT.lap(car.win[0])}–${FMT.lap(car.win[2])}, likeliest ${FMT.lap(car.win[1])}` : undefined), { t: laneSvg(car) }],
  }));
  return table(oSpec, rows, { headCells: head });
}
const OV = overviewLines();
const ocSpec = [{ h: '', w: 3 }, { h: O.headers.gap, w: 5, a: 'r' }, { h: O.headers.tyre, w: 4 }, { h: O.headers.win, w: 7 }, { h: O.headers.next, w: 4 }];
const OVC = table(ocSpec, FIELD.map((car) => ({
  cls: car.code === 'KUH' ? 'me' : car.mate ? 'hi' : '', band: false,
  cells: [car.code, car.gap === 0 ? '' : FMT.signedSeconds(car.gap, 1), `${car.cur[1]} ${NOW - car.cur[0] + 1}`, car.own ? `A ${FMT.lap(car.planA[0][0])}` : car.win ? `${FMT.lap(car.win[0])}–${car.win[2]}` : '', C(nextText(car), 'd')],
})));
page('strategy-overview.html', 'SP4.3d · strategy-overview (V06), round 1', `
<div class="note">Sample: Spa L14/44 for KUH (P8). Rows: the cars within one green pit loss (21.8 s) ahead or behind, and our teammate LIN always (spec §6.4). GAP against KUH (+ = behind). TYRE compound and laps on it; ² = still owes its second dry compound. NEXT the likeliest next compound and its chance (all odds and the window on hover). The lane is the race, one cell a lap, the white line now: past stints solid with their letter; a rival's predicted stop window shaded, darkest at its likeliest lap, then its next stint faint; ALO has stopped and runs to the flag. Our rows: plan A's stints outlined white, plan B's stops as small triangles on the line underneath. Rows in race order; KUH has the bar, LIN is white.</div>
<h2>Full ${OV_W}×${OV.length}</h2>
<div class="row">${fig(panel(O.title, { cols: OV_W, rows: OV.length, link: L1, state: FMT.lap(NOW), lines: OV, size: 'full' }), 'NOR and PIA ahead stop L16–23, RUS behind L19–24: plan A (L22) stops after all three; GAS behind is due now')}</div>
<h2>Compact ${widthOf(ocSpec)}×${OVC.length}</h2>
<div class="row">${fig(panel(O.title, { cols: widthOf(ocSpec), rows: OVC.length, link: L1, lines: OVC, size: 'compact' }), 'compact: no lane; the window as laps, our rows plan A\'s next stop')}</div>
`);

// ================================================================ 4. circle-of-doom (V01)
// t = how long ago our car was where the car is now (ms), modulo one lap; our car at the top, clockwise = behind us.
const CARS = [
  ['RUS', 1_400], ['SAI', 6_000], ['LIN', 9_500, 'mate'], ['GAS', 14_200], ['OCO', 20_900], ['TSU', 23_500], ['ALB', 27_000], ['HUL', 31_000], ['STR', 36_000], ['BOT', 41_000], ['ZHO', 47_000], ['MAG', 55_000],
  ['PER', 66_000], ['VER', 70_500], ['HAM', 78_000], ['LEC', 84_000], ['ALO', 90_800], ['NOR', 96_200], ['PIA', 102_900],
];
const LOSS = { green: 22_300, vsc: 13_500, sc: 9_800 };
/** The rejoin place and the time to the car ahead and behind of a ghost at `t`, from the cars' times (lapped ignored). */
function rejoinAt(t, cars, place = OUR_PLACE) {
  const behind = cars.filter(([, x]) => x < LAP_MS / 2).sort((a, b) => a[1] - b[1]);
  const passed = behind.filter(([, x]) => x < t);
  const ahead = passed.at(-1), next = behind.find(([, x]) => x > t);
  return { place: place + passed.length, aheadMs: ahead ? t - ahead[1] : null, behindMs: next ? next[1] - t : null };
}
/**
 * The circle's label rule (user, round 2): per car the radius its code is drawn at, or null (dot only). Cars whose
 * labels would overlap (closer on the label ring than a label's width) form a group. A group of two fans out along the
 * radius (inner and outer ring). A group too tight to fan (three or more within two label widths) keeps one code: the
 * teammate's, else the car closest to our car; the others show their dot only.
 */
function labelPlaces(cars, r, fs) {
  const R1 = r + 22, R2 = r + 40;
  const labelW = 3 * fs * 0.62 + 4; // three monospace characters and a little air
  const arc = (a, b) => (Math.abs(a - b) / LAP_MS) * 2 * Math.PI * R1;
  const sorted = [...cars].sort((a, b) => a[1] - b[1]);
  const groups = [];
  for (const c of sorted) {
    const g = groups.at(-1);
    if (g && arc(g.at(-1)[1], c[1]) < labelW) g.push(c); else groups.push([c]);
  }
  const out = new Map();
  const near = (t) => Math.min(t, LAP_MS - t);
  for (const g of groups) {
    if (g.length === 1) { out.set(g[0][0], R1); continue; }
    const tight = g.length >= 3 && arc(g[0][1], g.at(-1)[1]) < 2 * labelW;
    if (!tight && g.length === 2) { out.set(g[0][0], R1); out.set(g[1][0], R2); continue; }
    if (!tight) { g.forEach((c, i) => out.set(c[0], i % 2 === 0 ? R1 : R2)); continue; }
    const keep = g.find((c) => c[2] === 'mate') ?? [...g].sort((a, b) => near(a[1]) - near(b[1]))[0];
    for (const c of g) out.set(c[0], c === keep ? R1 : null);
  }
  return out;
}
function circleSvg({ size, cars = CARS, current = 'green', labels = true, moved = null, own = 'KUH', place = OUR_PLACE }) {
  const cx = size / 2, cy = size / 2, r = size * 0.36;
  const ang = (t) => (t / LAP_MS) * 2 * Math.PI - Math.PI / 2;
  const pt = (t, rr = r) => [cx + rr * Math.cos(ang(t)), cy + rr * Math.sin(ang(t))];
  const fs = labels ? FONT_PX - 2 : FONT_PX - 4;
  let s = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="display:block">`;
  s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${R.border}"/>`;
  // our car at the top
  const [ox, oy] = pt(0);
  s += `<circle cx="${ox}" cy="${oy}" r="6" fill="${R.ownCar}"/><text x="${ox}" y="${oy + 22}" text-anchor="middle" font-size="${fs + 1}" font-weight="700" fill="${R.ownCar}" font-family="monospace">${own}</text>`;
  const lab = labelPlaces(cars, r, fs);
  for (const [code, t, kind] of cars) {
    const [x, y] = pt(t);
    const col = kind === 'mate' ? R.ownCar : R.textDim;
    s += kind === 'mate' ? `<circle cx="${x}" cy="${y}" r="5" fill="none" stroke="${R.ownCar}" stroke-width="2"/>` : `<circle cx="${x}" cy="${y}" r="4" fill="${col}"/>`;
    const lr = lab.get(code);
    if (labels && lr !== null) { const [lx, ly] = pt(t, lr); s += `<text x="${lx}" y="${ly + 4}" text-anchor="middle" font-size="${fs}" fill="${col}" font-family="monospace">${code}</text>`; }
    if (moved && code === moved.code) {
      const [px, py] = pt(moved.from);
      s += `<circle cx="${px}" cy="${py}" r="4" fill="none" stroke="${R.textFaint}" stroke-dasharray="2 2"/>`;
    }
  }
  for (const cond of ['sc', 'vsc', 'green']) {
    const t = LOSS[cond];
    const on = cond === current;
    const [gx, gy] = pt(t, r);
    const col = on ? R.ownCar : R.textFaint;
    s += `<rect x="${gx - 6}" y="${gy - 6}" width="12" height="12" fill="${R.bg}" stroke="${col}" stroke-width="${on ? 2 : 1}" transform="rotate(45 ${gx} ${gy})"/>`;
    s += `<text x="${gx}" y="${gy + 4}" text-anchor="middle" font-size="${FONT_PX - 5}" fill="${col}" font-family="monospace">${TEXT.circle.ghost[cond]}</text>`;
    if (on) {
      const j = rejoinAt(t, cars, place);
      const [lx, ly] = pt(t, r - (labels ? 46 : 30));
      s += `<text x="${lx}" y="${ly}" text-anchor="middle" font-size="${fs + 1}" font-weight="700" fill="${R.ownCar}" font-family="monospace">${FMT.position(j.place)}</text>`;
      if (labels) s += `<text x="${lx}" y="${ly + 16}" text-anchor="middle" font-size="${fs}" fill="${R.text}" font-family="monospace">↑${FMT.seconds(j.aheadMs, 1)} ↓${FMT.seconds(j.behindMs, 1)}</text>`;
    }
  }
  return s + '</svg>';
}
const circlePanel = (o, state = FMT.lap(NOW), link = L1) => {
  const size = o.size;
  const cols = Math.ceil(size / CELL_W);
  return panel(TEXT.circle.title, { cols, link, state, body: circleSvg(o) });
};
const SPUN = CARS.map(([c, t, k]) => (c === 'OCO' ? [c, 25_500, k] : [c, t, k]));
const g0 = rejoinAt(LOSS.green, CARS), g1 = rejoinAt(LOSS.green, SPUN), s0 = rejoinAt(LOSS.sc, CARS);
page('circle-of-doom.html', 'SP4.3d · circle-of-doom (V01), round 1 + label rule', `
<div class="note">Sample: Spa L14/44 for KUH (P8), one lap ≈ 106 s. Every car sits where "how long ago our car was where it is now" puts it (spec §6.5): one lap is one turn, our car at the top, clockwise = behind us, so a car just behind is just clockwise of us and the car just ahead is just anticlockwise. Every frame. Ghosts (diamonds): where we rejoin if we box now, G green, V VSC, S SC; the current condition's ghost white with its rejoin place and the time to the car ahead (↑) and behind (↓), the others faint. Our teammate LIN is the white ring. <b>Label rule (round 2):</b> codes closer than a label's width fan out to an outer ring; a group too tight to fan keeps one code (the teammate, else the car closest to us), the others a dot only.</div>
<h2>Green running</h2>
<div class="row">${fig(circlePanel({ size: 420 }), `green: G rejoins ${FMT.position(g0.place)}, ${FMT.seconds(g0.aheadMs, 1)} s behind OCO, ${FMT.seconds(g0.behindMs, 1)} s ahead of TSU`)}${fig(circlePanel({ size: 420, cars: SPUN, moved: { code: 'OCO', from: 20_900 } }, `${FMT.lap(NOW)} +6 s`), `6 s later OCO has spun and sits 4.6 s further back (its old place dotted): G now rejoins ${FMT.position(g1.place)}, ${FMT.seconds(g1.aheadMs, 1)} s behind GAS`)}</div>
<h2>SC deployed</h2>
<div class="row">${fig(circlePanel({ size: 420, current: 'sc' }, span('w', 'SC')), `SC out: the S ghost white, ${FMT.position(s0.place)}, ${FMT.seconds(s0.aheadMs, 1)} s behind LIN; G and V faint`)}</div>
<h2>Compact</h2>
<div class="row">${fig(circlePanel({ size: 220, labels: false }), 'compact: no codes, the current ghost with its rejoin place only')}</div>
`);


// ================================================================ 5. the workbooks (round 2)
// A window of 1920 × 1000 px at the default theme (8 px a cell, 14 px font, line 1.4); two link groups, one per driver.
// The undercut card and the pit sweep are the approved 4.3b panels, taken as they are from the 4.3b workbook page.
import { readFileSync } from 'node:fs';
const WIN_W = 1920, WIN_H = 1000, PGAP = DEFAULT_THEME.density.panelGapPx;
const OLD = readFileSync(new URL('../2026-11-12-sp4.3b/strategy-workbook.html', import.meta.url), 'utf8');
/** The 4.3b workbook's `.panel` divs in page order (balanced by div depth). */
function oldPanels(open = '<div class="panel"') {
  const out = [];
  let from = 0;
  for (;;) {
    const i = OLD.indexOf(open, from);
    if (i < 0) return out;
    let depth = 0, j = i;
    const re = /<\/?div\b[^>]*>/g; re.lastIndex = i;
    for (let m; (m = re.exec(OLD)); ) { depth += m[0].startsWith('</') ? -1 : 1; if (depth === 0) { j = re.lastIndex; break; } }
    out.push(OLD.slice(i, j)); from = j;
  }
}
const OP = oldPanels(); // [sweep KUH, undercut KUH, sc KUH, sweep LIN, undercut LIN, sc LIN]
const SB = oldPanels('<div class="panel sb"'); // the approved strategy table (variant B), [KUH, LIN]
const OLD_JS = OLD.slice(OLD.indexOf('<script>'), OLD.indexOf('</script>') + 9); // its click-to-highlight
const SB_ROWS = 13; // full 88×13 (4.3b README)
const OLD_CSS = OLD.match(/<style>([\s\S]*?)<\/style>/)[1];
const W_CSS = `.window { width:${WIN_W}px; height:${WIN_H}px; outline:1px dashed var(--pw-border); background:var(--pw-bg); overflow:hidden; position:relative; }
.groups { display:flex; gap:${PGAP * 3}px; padding:${PGAP}px; }
.group { display:flex; flex-direction:column; gap:${PGAP}px; }
.line { display:flex; gap:${PGAP}px; align-items:flex-start; }
.tabs { display:inline-flex; gap:1ch; } .tabs .on { color:var(--pw-text); } .tabs .off { color:var(--pw-textFaint); }
.edge { position:absolute; right:0; bottom:0; color:var(--pw-textFaint); padding:0 1ch; }`;
const pageW = (file, title, body) => writeFileSync(new URL(file, import.meta.url), `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>${OLD_CSS}</style><style>${CSS}${W_CSS}</style></head><body><h1>${title}</h1>${body}${OLD_JS}</body></html>\n`);
const topbarW = (wb, state = 'green') => `<div class="topbar"><div class="side"><span class="t">${wb}</span><span>Spa race</span><span class="t">RACE</span><span class="t">${FMT.lap(NOW)}/${FLAG}</span><span>0:31:12</span><span${state === 'green' ? '' : ' class="w"'}>${state}</span><span>calibration <span class="t">league</span></span></div><div class="side"><span>feed ok · 0.1 % loss</span><span>realism on</span></div></div>`;
const topbarPlan = `<div class="topbar"><div class="side"><span class="t">plan</span><span>Spa race</span><span class="t">PLANNING</span><span>after Q · grid P8, P11</span><span>between sessions</span><span>calibration <span class="t">league</span></span></div><div class="side"><span>feed between sessions</span><span>realism on</span></div></div>`;
/** Width (px) of a row of panels given their cell widths (each panel cols + 2 ch). */
const rowPx = (cols) => cols.reduce((a, c) => a + (c + 2) * CELL_W, 0) + PGAP * (cols.length - 1);
const fitCheck = (name, groupsPx, heightPx) => {
  const w = groupsPx.reduce((a, b) => a + b, 0) + PGAP * 3 * (groupsPx.length - 1) + 2 * PGAP;
  if (w > WIN_W) throw new Error(`${name}: ${Math.round(w)} px wide, more than ${WIN_W}`);
  if (heightPx > WIN_H) throw new Error(`${name}: ${Math.round(heightPx)} px high, more than ${WIN_H}`);
  return `${name}: ${Math.round(w)} × ${Math.round(heightPx)} px of ${WIN_W} × ${WIN_H}`;
};
const ph = (rows) => (rows + 1) * CELL_H; // a panel: header plus rows
const tabsTitle = (on, off) => `<span class="tabs"><span class="on">${on}</span><span class="off">${off}</span></span>`;
const relabel = (html, from, to) => html.split(from).join(to);
const DRIVERS = [
  { link: '1 · KUH', code: 'KUH', mate: 'LIN', place: OUR_PLACE, grid: 8 },
  { link: '2 · LIN', code: 'LIN', mate: 'KUH', place: 11, grid: 11 },
];
// LIN's circle: the same field seen from LIN (9.5 s behind KUH), KUH as the teammate ring
const fromLin = (cars) => [['KUH', LAP_MS - 9_500, 'mate'], ...cars.filter(([c]) => c !== 'LIN').map(([c, t, k]) => [c, (t - 9_500 + LAP_MS) % LAP_MS, k])];

// ---------------------------------------------------------------- 5a. the plan workbook
const boardPanel = (d) => panel(B.title, { ...BOARD_FULL, link: d.link, state: `${FMT.position(d.place)} · ${FMT.lap(NOW)}/${FLAG} · N 1200`, lines: [...bFull.lines.map((l) => relabel(l, 'KUH', d.code)), '', ''] });
const planBoardPanel = (d) => panel(B.title + ' · race', { ...PLAN_FULL, link: d.link, state: 'SPA', lines: [planInputs.replace(FMT.position(OUR_PLACE), FMT.position(d.grid)), '', ...pl.lines.slice(0, 4), g2Entry, ...pl.lines.slice(4)] });
const ovPanel = (d) => { const l = overviewLines(d.code, d.mate); return panel(O.title, { cols: OV_W, rows: l.length, link: d.link, state: FMT.lap(NOW), lines: l }); };
const ovNA = (d) => panel(O.title, { cols: OV_W, rows: 2, link: d.link, lines: [span('f tip', ' ' + TEXT.unknownMark.notApplicable, 'no race yet: the field plans start at the race')] });
const sbOf = (d, planning) => { const h = SB[d.code === 'KUH' ? 0 : 1]; return planning ? h.replace('<span>L14</span>', '<span>SPA · race</span>') : h; };
const planGroup = (d, planning) => `<div class="group">${planning ? planBoardPanel(d) : boardPanel(d)}${sbOf(d, planning)}${planning ? ovNA(d) : ovPanel(d)}</div>`;
const planH = (planning) => CELL_H * 1.4 + PGAP + ph(planning ? PLAN_FULL.rows : BOARD_FULL.rows) + PGAP + ph(SB_ROWS) + PGAP + ph(planning ? 2 : overviewLines().length) + PGAP;
const groupPx = (board) => Math.max(rowPx([board]), rowPx([OLD_W(SB[0])]), rowPx([OV_W]));
const OLD_W = (html) => Number(html.match(/width:(\d+)ch/)[1]) - 2;
const PLAN_FIT = [fitCheck('plan · race', [groupPx(BOARD_FULL.cols), groupPx(BOARD_FULL.cols)], planH(false)), fitCheck('plan · planning', [groupPx(PLAN_FULL.cols), groupPx(PLAN_FULL.cols)], planH(true))];
pageW('plan-workbook.html', 'SP4.3d · the plan workbook (new), round 2 (revised)', `
<div class="note">The new <code>plan</code> workbook (spec §6.6), a 1920 × 1000 window: two link groups, <b>1 · KUH</b> and <b>2 · LIN</b>, each from its own feed. Per driver, stacked: the <b>plan board</b> (full), the <b>strategy table</b> below it (variant B, as approved in 4.3b; visible, no longer a tab: user, round 2 revision; a click on a line or row highlights it as in 4.3b), and below them that driver's <b>Field plans</b>. Side by side does not fit: board and table are 84 + 90 cells, about 1,390 px per driver. <b>One overview per driver, not one shared:</b> the overview is centred on its car (the cars within one pit loss of <i>that</i> car), and KUH (P8) and LIN (P11) see different neighbourhoods; in the race below the two overviews already differ (ALO is outside LIN's range). Group 2's numbers are the sample's, relabelled.</div>
<h2>Race · L14</h2>
<div class="window">${topbarW('plan')}<div class="groups">${DRIVERS.map((d) => planGroup(d, false)).join('')}</div><div class="edge">1920 × 1000</div></div>
${cap(PLAN_FIT[0])}
<h2>Planning round · after qualifying</h2>
<div class="note">Between qualifying and the race (spec §7): the boards read the planning job (<code>source: planning</code>), the race inputs on their first line, A and B prefilled with <code>accept</code>. <b>The strategy table</b> below each board shows the planning job's full ranking (the same rows the board's DP part is drawn from, the same <code>plans.preview</code> topic), so it is useful in the planning round too. <b>Field plans</b> shows notApplicable: no race runs, and the planning job publishes no field forecast (a follow-up if wanted: the rivals' predicted start compounds and first stops from the planning job). The top bar reads PLANNING and the feed "between sessions" (spec §7.0 rule 2).</div>
<div class="window">${topbarPlan}<div class="groups">${DRIVERS.map((d) => planGroup(d, true)).join('')}</div><div class="edge">1920 × 1000</div></div>
${cap(PLAN_FIT[1])}`);

// ---------------------------------------------------------------- 5b. the strategy workbook
const cardGreen = (d) => panel(K.title, { ...CARD_FULL, link: d.link, state: `${FMT.lap(NOW)} · ${K.ifNow}`, lines: ALL.map((l) => relabel(l, 'KUH', d.code)) });
const cardSc = (d) => panel(K.title, { cols: CARD_W, rows: CARD_FULL.rows, link: d.link, state: outState('SC', 4), lines: block('sc') });
const circleOf = (d, current) => circlePanel(d.code === 'KUH' ? { size: 420, current } : { size: 420, current, cars: fromLin(CARS), own: 'LIN', place: 11 }, current === 'sc' ? span('w', 'SC') : FMT.lap(NOW), d.link);
const oldOf = (d, k) => OP[(d.code === 'KUH' ? 0 : 3) + k]; // k: 0 sweep, 1 undercut
const stratGroup = (d, sc) => `<div class="group"><div class="line">${sc ? cardSc(d) : cardGreen(d)}${circleOf(d, sc ? 'sc' : 'green')}</div><div class="line">${oldOf(d, 0)}${oldOf(d, 1)}</div></div>`;
const OLD_ROWS = (html) => (html.match(/<pre>([\s\S]*?)<\/pre>/)?.[1].split('\n').length ?? 0);
const CIRCLE_COLS = Math.ceil(420 / CELL_W);
const sRow1 = rowPx([CARD_W, CIRCLE_COLS]), sRow2 = rowPx([OLD_W(OP[0]), OLD_W(OP[1])]);
const sH = CELL_H * 1.4 + PGAP + Math.max(ph(CARD_FULL.rows), 420 + CELL_H) + PGAP + Math.max(ph(OLD_ROWS(OP[0])), ph(OLD_ROWS(OP[1]))) + PGAP;
const STRAT_FIT = fitCheck('strategy', [Math.max(sRow1, sRow2), Math.max(sRow1, sRow2)], sH);
pageW('strategy-workbook.html', 'SP4.3d · the strategy workbook (changed), round 2', `
<div class="note">The changed <code>strategy</code> workbook (spec §6.6), a 1920 × 1000 window, for the quick calls in the race: per driver the <b>Box call</b> (the SC card reworked, full: SC, VSC, GREEN), the <b>circle of doom</b> beside it, and below them the <b>pit sweep</b> and the <b>undercut card</b> as approved in 4.3b, unchanged. The strategy table moved to the <code>plan</code> workbook. Group 2's card and circle: the sample relabelled; LIN's circle is the same field seen from LIN (KUH 9.5 s ahead, the white ring).</div>
<h2>Green running · L14</h2>
<div class="window">${topbarW('strategy')}<div class="groups">${DRIVERS.map((d) => stratGroup(d, false)).join('')}</div><div class="edge">1920 × 1000</div></div>
${cap(STRAT_FIT)}
<h2>SC out</h2>
<div class="note">An SC is deployed: each Box call shows only its SC block under an amber header with its expected laps left, GREEN and VSC hidden; each circle's S ghost is white with its rejoin place and gaps; the top bar's state amber.</div>
<div class="window">${topbarW('strategy', 'SC')}<div class="groups">${DRIVERS.map((d) => stratGroup(d, true)).join('')}</div><div class="edge">1920 × 1000</div></div>`);
console.log([...PLAN_FIT, STRAT_FIT].join('\n'));

console.log(SIZES.join('\n'));
