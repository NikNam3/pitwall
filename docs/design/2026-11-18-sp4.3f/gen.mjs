// Generates the SP4.3f mockups: node gen.mjs  (Node 22.18 or later: it imports the real theme)
// The helpers (theme, formats, wording, character-cell table, panel frame, the plan board's lines) are copied from
// docs/design/2026-11-16-sp4.3d/gen.mjs (approved), not imported, as every round's generator does. New here: the
// plan board's race conditions (the forecast rows), the picker between sessions, the top bar between sessions.
// Sample: Texas (track 15), our team Mercedes #64 (player) and #2; practice and qualifying 17 Nov; 56 laps; the
// qualifying's race samples as the game sent them (rain 1 % → 12 % at +30 min, light cloud). The board's plan rows are
// SP4.3d's illustrative ones. Spec: docs/superpowers/specs/2026-11-18-sp4.3f-planning-out-of-session-design.md §4.4.
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


// ================================================================ SP4.3f
const TOPBAR_CSS = `.topbar { display:flex; justify-content:space-between; background:var(--pw-bgBand); padding:0 1ch; white-space:nowrap; width:150ch; color:var(--pw-textDim); }
.topbar .side { display:flex; gap:2ch; } .topbar .t { color:var(--pw-text); }
pre .t { color:var(--pw-text); } .d .fld { color:var(--pw-textDim); } .t .fld.on { color:var(--pw-ownCar); }
.overlay { background:var(--pw-bgPanel); outline:1px solid var(--pw-border); display:inline-block; vertical-align:top; }
.overlay .oh { background:var(--pw-bgBand); padding:0 1ch; color:var(--pw-text); }`;
const page2 = (file, title, body) => writeFileSync(new URL(file, import.meta.url), `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>${CSS}${TOPBAR_CSS}</style></head><body><h1>${title}</h1>${body}</body></html>\n`);

const WEATHER = { clear: 'clear', lightCloud: 'light cloud', overcast: 'overcast', lightRain: 'light rain', heavyRain: 'heavy rain', storm: 'storm' };
const CT = { // the plan board's new wording (its text.ts)
  rainMore: '▸', imported: (d) => `imported · Q ${d}`, edited: 'edited',
  title: 'CONDITIONS', head: { at: '+MIN', weather: 'WEATHER', rain: 'RAIN' },
  reset: 'reset', done: 'done', missing: '…', add: '+ row',
};
// the qualifying's race samples (offset min, weather, rain %), as the 17 Nov Texas qualifying sent them (rain rounded)
const SAMPLES = [[0, 'clear', 1], [5, 'clear', 1], [10, 'clear', 1], [15, 'clear', 1], [30, 'lightCloud', 12], [45, 'lightCloud', 12], [60, 'lightCloud', 12], [90, 'clear', 4], [120, 'clear', 4]];
const PSP = { ...PI, sets: 'SETS' };
const rainMax = (s) => Math.max(...s.map((x) => x[2]));
/** The board's first line in the planning round, with the RAIN button and the conditions' source label. */
const inputsLine = ({ rain, label, open = false }) =>
  ` ${span('f', PSP.grid)} P3   ${span('f', PSP.laps)} ${f('56')}   ${span('f', PSP.sets)} ${f('fresh ▾')}   ${span('f', PSP.rain)} ${span(open ? 'fld on' : 'btn', `${rain} ${CT.rainMore}`)} ${span('d', label)}   ${span('f', PSP.n)} 1200`;
const pct = (n) => `${n}%`;
/** The conditions editor (window-local, C73): one line per sample, the overridden ones bright, reset and done. */
function conditionLines(samples, { edited = new Map(), bad } = {}) {
  const lines = [`${span('f', ` ${padL(CT.head.at, 4)}  ${padR(CT.head.weather, 14)}  ${padR(CT.head.rain, 16)}`)}${span('btn', CT.reset)}  ${span('btn', CT.done)}`];
  samples.forEach(([m, w, r], i) => {
    const e = edited.get(i);
    const ww = e?.w ?? w, rr = e?.r ?? r;
    const wf = f(padR(WEATHER[ww], 11) + ' ▾', e?.w ? 'fld on' : 'fld');
    const rf = bad === i ? span('fld bad tip', padL('101', 3), 'rejected: rain is 0 to 100 %') : f(padL(String(rr), 3), e?.r !== undefined ? 'fld on' : 'fld');
    const mark = e ? span('', '  ' + CT.edited) : '';
    const row = ` ${padL('+' + m, 4)}  ${wf}  ${rf} %${mark}`;
    lines.push(e ? span('t', row) : span('d', row));
  });
  return lines;
}
const BOARD = { cols: Math.max(PLAN_FULL.cols, 84), rows: 13 };
const boardWith = (first, rest, state = 'TEXAS', gap = true) => { const lines = gap ? [first, '', ...rest] : [first, ...rest]; if (lines.length > BOARD.rows) throw new Error(`board: ${lines.length} rows`); return panel(B.title + ' · race', { ...BOARD, link: '1 · #64', state, lines }); };
const planRows = pl.lines.slice(0, 10);

page2('plan-board-conditions.html', 'SP4.3f · plan board: the race conditions', `
<div class="note">The planning round's first line gains the race's <b>conditions</b> (spec §4.3–4.4, C62d). <code>RAIN 12% ▸</code> is the highest rain chance of the forecast rows; a click opens the rows <b>in place of the plan rows</b> (window-local, C73), one line per forecast moment the game sent for the race (minutes after the race start, its weather and rain chance). Changing a field commits one <code>plans.race.set</code> with the whole list; the round replans. The label after RAIN says where the rows come from: <code>imported · Q 17 Nov</code> while none is changed, <code>edited</code> after. Colour only to highlight (memory): imported rows dim, a changed row bright with its changed field outlined. Only the full size edits; compact shows the line's rain only. Plan rows: SP4.3d's sample, illustrative.</div>
<h2>Planning round · imported, rows closed · full ${BOARD.cols}×${BOARD.rows}</h2>
<div class="row">${fig(boardWith(inputsLine({ rain: pct(rainMax(SAMPLES)), label: CT.imported('17 Nov') }), planRows), 'the qualifying’s race forecast as the default (the best source when the race runs in the same lobby)')}</div>
<h2>Rows open · imported</h2>
<div class="row">${fig(boardWith(inputsLine({ rain: pct(12), label: CT.imported('17 Nov'), open: true }), conditionLines(SAMPLES), 'TEXAS', false), 'nine moments, +0 to +120 min; the temperatures stay the game’s (no planning input, spec §3)')}</div>
<h2>Rows open · two changed (a new lobby with rain later)</h2>
<div class="row">${fig(boardWith(inputsLine({ rain: pct(70), label: CT.edited, open: true }), conditionLines(SAMPLES, { edited: new Map([[5, { w: 'lightRain', r: 55 }], [6, { w: 'heavyRain', r: 70 }]]) }), 'TEXAS', false), '+45 and +60 changed: bright, the changed fields outlined, <code>edited</code> on the row and in the label; <b>reset</b> returns to the imported rows')}${fig(boardWith(inputsLine({ rain: pct(12), label: CT.edited, open: true }), conditionLines(SAMPLES, { bad: 4 }), 'TEXAS', false), 'a rejected value (the bridge validates, C73): amber, the reason on hover, never stored')}</div>
<h2>No race samples in the qualifying (C3)</h2>
<div class="row">${fig(boardWith(inputsLine({ rain: span('f tip', CT.missing, 'not received yet'), label: '' }), [span('f tip', ' ' + TEXT.unknownMark.insufficientData, 'no forecast: enter the race’s conditions')]), 'rain unknown, never 0 %; the round plans once rows are entered')}${fig(boardWith(inputsLine({ rain: span('f', CT.missing), label: '', open: true }), [`${span('f', ` ${padL(CT.head.at, 4)}  ${padR(CT.head.weather, 14)}  ${padR(CT.head.rain, 16)}`)}${span('btn', CT.done)}`, ` ${padL('+0', 4)}  ${f(padR('', 11) + ' ▾')}  ${f('   ')} %`, `       ${span('btn', CT.add)}`], 'TEXAS', false), 'entering: one row at +0, more with <b>+ row</b>')}</div>
<h2>Compact</h2>
<div class="row">${fig(panel(B.title, { cols: BOARD_COMPACT.cols, rows: 2, link: '1 · #64', lines: [` ${span('f', PSP.rain)} 12%  ${span('d', 'imported')}`] }), 'compact: the rain and its source only; edit in the full size')}</div>
`);

// ---------------------------------------------------------------- the picker between sessions
const P = { title: 'Plan a race', track: 'TRACK', qualifying: 'QUALIFYING', practice: 'PRACTICE', none: 'none', confirm: 'Confirm', stale: 'stale', last: 'last choice', noSessions: 'no stored qualifying', rejected: 'rejected: qualifying 17 Nov has no recording' };
const radio = (on) => (on ? '(•)' : '( )');
const box = (on) => (on ? '[x]' : '[ ]');
function picker({ tracks, quals, pract, error, empty = false }) {
  const L = [];
  if (empty) { L.push('', span('f', ' ' + P.noSessions), ''); }
  else {
    L.push(span('f', ' ' + P.track));
    for (const [on, name, day] of tracks) L.push(` ${radio(on)} ${padR(name, 12)}${span('d', day)}`);
    L.push('', span('f', ' ' + P.qualifying));
    for (const [on, day, team, cars, mark] of quals) L.push(` ${radio(on)} ${padR(day, 8)}${padR(team, 10)}${padR(cars, 9)}${mark ? span('d', mark) : ''}`);
    L.push('', span('f', ' ' + P.practice));
    L.push(` ${box(pract.length === 0)} ${P.none}`);
    for (const [on, day, mark] of pract) L.push(` ${box(on)} ${padR(day, 8)}${mark ? span('d', mark) : ''}`);
  }
  if (error) L.push('', span('w', ' ' + error));
  L.push('', padL(span(empty ? "f" : "btn", `[${P.confirm}]`), 46));
  for (const l of L) if (vis(l) > 48) throw new Error(`picker line too wide: ${strip(l)}`);
  return `<div class="overlay" style="width:50ch"><div class="oh">${P.title}</div><pre>${L.join('\n')}</pre></div>`;
}
const TRACKS = [[true, 'Texas', '17 Nov'], [false, 'Zandvoort', '10 Nov'], [false, 'Singapore', '13 Nov']];
const QUALS = [[true, '17 Nov', 'Mercedes', '#64 #2', P.last], [false, '04 Nov', 'Mercedes', '#64 #2', P.stale]];
page2('picker-between-sessions.html', 'SP4.3f · the picker between sessions', `
<div class="note">The SP4.3e picker (<code>basis.pick</code>) when no session runs (spec §4.4): it reads <code>plans.sessions</code> (every stored practice and qualifying, one entry per team). <b>Track</b>, then that track's <b>qualifying</b> per team (the team comes with it, never picked on its own; its cars shown), then <b>practice</b>: only sessions of the qualifying's team, several or none. No plan part (a round plans; a race chooses a plan). Preselected: the newest track, its newest qualifying, that team's practice of the same weekend. A stale session is marked; picking it rebuilds it first (the top bar shows the progress). Confirm opens the round; laps, sets and conditions are set on the plan board. In a session the picker stays SP4.3e's.</div>
<div class="row">${fig(picker({ tracks: TRACKS, quals: QUALS, pract: [[true, '17 Nov', P.last]] }), 'preselected: Texas, qualifying 17 Nov of Mercedes (#64, #2), practice 17 Nov')}${fig(picker({ tracks: [[true, 'Texas', '18 Nov'], [false, 'Zandvoort', '10 Nov']], quals: [[true, '18 Nov', 'Mercedes', '#63 #12', ''], [false, '18 Nov', 'Ferrari', '#2 #16', '']], pract: [[false, '17 Nov', '']] }), 'one session stored for two teams (our drivers in two teams): listed once per team; Mercedes #63 #12 is another seat than #64 #2, so no practice of it is offered checked')}${fig(picker({ tracks: TRACKS, quals: QUALS, pract: [[true, '17 Nov', '']], error: P.rejected }), 'a rejection from the bridge (C73): shown, the picker stays open')}${fig(picker({ empty: true }), 'nothing stored: Confirm disabled')}</div>
`);

// ---------------------------------------------------------------- the top bar between sessions
const bar = (left, right = '<span>feed between sessions</span><span>realism on</span>') => `<div class="topbar"><div class="side">${left}</div><div class="side">${right}</div></div>`;
const wb = '<span class="t">plan</span>';
page2('topbar-planning.html', 'SP4.3f · the top bar between sessions', `
<div class="note">With no session running, the top bar's basis segment becomes the <b>planning</b> segment (spec §4.4): the open round's practice and qualifying days, the race laps, the sets and the range of the rain chance over the forecast rows. A click runs <code>basis.pick</code>. Without a round: a quiet <code>Plan…</code> button. Formatting only (C65).</div>
<h2>A round open</h2>${bar(`${wb}<span class="btn">Planning · P 17 Nov · Q 17 Nov · 56 laps · fresh · rain 1–12 %</span><span>calibration <span class="t">league</span></span>`)}
<h2>Conditions edited</h2>${bar(`${wb}<span class="btn">Planning · P 17 Nov · Q 17 Nov · 56 laps · fresh · rain 1–70 % <span class="d">edited</span></span><span>calibration <span class="t">league</span></span>`)}
<h2>A pick being rebuilt (C61)</h2>${bar(`${wb}<span class="btn">Planning · P 04 Nov · Q 04 Nov · rebuilding 1/2</span><span>calibration <span class="t">league</span></span>`)}
<h2>No race samples, none entered (C3)</h2>${bar(`${wb}<span class="btn">Planning · P 17 Nov · Q 17 Nov · 56 laps · fresh · rain <span class="f">…</span></span><span>calibration <span class="t">league</span></span>`)}
<h2>No round (a fresh bridge)</h2>${bar(`${wb}<span class="btn">Plan…</span>`, '<span>no feed data</span><span>realism on</span>')}
`);
