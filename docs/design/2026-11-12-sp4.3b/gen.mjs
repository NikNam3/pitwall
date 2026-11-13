// Generates the SP4.3b2 display mockups (round 1): node gen.mjs
// Same method as the 2026-11-06 and 2026-11-07 sets: the real theme (imported from apps/ui/src/theme), the SP3 panel
// frame B, sizes in character cells. Presentation lives in one place each: THEME (roles, font, density), FMT (formats,
// mirroring kit/values/format.ts), TEXT (wording, the widgets' text.ts), DIST (the distribution strip, a proposed kit piece).
// The generator throws when a line is wider than its panel or a cell wider than its column, so a misfit cannot ship.
// Sample: Spa, 44 laps dry, 20 cars, L14/44; our cars KUH (Mercedes #12, P8, mediums since L1) and LIN (Mercedes #63, P11).
// Every expectation, chance and points value is computed here from its drawn distribution, so the numbers agree.
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
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const signed = (v, d) => { const t = fixed(Math.abs(v), d); return `${v < 0 && Number(t) !== 0 ? MINUS : '+'}${t}`; };
const FMT = {
  lapNumber: (n) => `L${String(n).padStart(2, '0')}`,
  lapRange: (a, b) => `L${String(a).padStart(2, '0')}–${String(b).padStart(2, '0')}`,
  position: (n) => `P${n}`,
  pct: (p) => `${fixed(p * 100, 0)}%`,
  seconds: (ms, d) => fixed(ms / 1000, d),
  signedSeconds: (ms, d) => signed(ms / 1000, d),
  /** proposed kit format: an expected place to two decimals, `7.523` -> `7.52` (two cars a tie apart differ in the second) */
  expectedPlace: (p) => fixed(p, 2),
  /** proposed kit format: places gained, signed, one decimal, `1.43` -> `+1.4` (positive = good for us) */
  placesGained: (g) => signed(g, 1),
  points: (p) => fixed(p, 1),
  count: (n) => fixed(n, 0),
  day: (iso) => { const [, m, d] = iso.split('-'); return `${d} ${MONTHS[Number(m) - 1]}`; },
  raw: (v) => String(v),
};

// ---------------------------------------------------------------- wording (kit/text.ts and each widget's text.ts)
const TEXT = {
  unknownReason: { notApplicable: 'not applicable', insufficientData: 'too few laps or samples yet', notReceived: 'not received yet' },
  unknownMark: { notApplicable: '–', insufficientData: '…', notReceived: '…' },
  noDataYet: 'no data yet',
  arrow: '→',
  condition: { sc: 'SC', vsc: 'VSC' },
  strategy: {
    title: 'Strategy',
    headers: { tie: '', rank: '#', src: 'SRC', stops: 'STOPS', trg: 'TRG', ePos: 'E[POS]', ePts: 'E[PTS]', dLead: 'ΔTIME', dPlan: 'ΔPLAN', act: '' },
    source: { dp: 'dp', neighbour: 'nbr', rule: 'rule', committed: 'plan' },
    sourceHover: { dp: 'dp · the DP\'s plan', neighbour: 'nbr · a stop lap next to a DP plan', rule: (r) => `rule · ${r}`, committed: 'plan · the committed plan' },
    commit: 'commit', clear: 'clear',
    commitHover: 'plan.commit', clearHover: 'plan.clear',
    meta: { n: 'N', cand: 'CAND' },
    capHover: (cap) => `at the cap: ${cap} scenario-policies`,
    tieHover: 'tied with the row above: within the tie test',
    openTieHover: (cap) => `near-tie unresolved at the cap (${cap} scenario-policies)`,
  },
  undercut: { title: 'Undercut', headers: { car: '', pos: 'POS', gap: 'GAP', n: 'N', dGap: 'ΔGAP', pAhead: 'P(AH)', dist: '', rej: 'REJ' }, noneHover: 'no car within 3.0 s' },
  sweep: { title: 'Pit sweep', headers: { lap: 'LAP', rej: 'REJ', trf: 'TRF', ePos: 'E[POS]', dist: '', pGain: 'P(GAIN)', life: 'LIFE' }, compoundHover: { auto: "auto · pit-window's next compound", set: 'set in the panel options' }, lifeHover: 'the stint passes its tyre life' , option: 'compound', auto: 'auto' },
  sc: { title: 'SC / VSC call', headers: { cond: '', dPos: 'ΔPOS', pGain: 'P(GAIN)', dist: '', rej: 'REJ', loss: 'LOSS', range: 'RANGE' } },
  drivers: {
    title: 'Drivers',
    seats: 'SEATS', lobby: 'LOBBY', config: 'CONFIG', sessions: 'SESSIONS',
    headers: { entry: 'ENTRY', value: 'VALUE', laps: 'LAPS', ses: 'SES', newest: 'NEWEST', ovr: 'OVR' },
    sessionHeaders: { on: '', date: 'DATE', track: 'TRACK', session: 'SES', laps: 'LAPS' },
    configHeaders: { unit: 'UNIT', key: 'KEY', value: 'VALUE' },
    entries: { sigmaMs: 'σ lap s', rho: 'ρ', mistakeRate: 'mistake/lap', mistakeMedianMs: 'mistake s', mistakeSigmaLog: 'mistake σlog', wearS: 'wear S %/lap', wearM: 'wear M %/lap', wearH: 'wear H %/lap' },
    lobbyKeys: { safetyCar: 'safety car', redFlags: 'red flags', carDamage: 'car damage', carDamageRate: 'damage rate', tyreTemperature: 'tyre temp', recoveryMode: 'recovery' },
    toggle: { kept: '[x]', excluded: '[ ]' },
    excludedHover: 'excluded by you', keptHover: 'drivers.exclude',
    jsonMark: 'ʲ', jsonHover: 'set in config.json',
    overrideHover: (v) => `your override ${v}`,
    rejected: (m) => `rejected: ${m}`,
    picker: { none: 'none', new: 'new' },
  },
  calibration: { title: 'Calibration', setLabel: 'set', activeInRace: 'active in this race', actions: ['new', 'copy', 'rename', 'delete'], preferred: '★', notPreferred: '☆', preferHover: 'calibration.prefer', preferredHover: 'preferred for this track: the preselection · calibration.prefer clears it' },
  topbar: { calibration: 'calibration', unlinked: 'unlinked', unlinkedHover: 'a human seat of our feeds without a person: opens the drivers panel' },
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
.ph .t { color:var(--pw-textDim); } .ph .sp { flex:1; } .ph .lk { color:var(--pw-text); }
pre { font-family:inherit; font-size:inherit; line-height:inherit; padding:0 1ch; white-space:pre; }
pre svg { display:inline-block; vertical-align:top; }
.cap { color:var(--pw-textFaint); margin:4px 0 0; min-width:44ch; }
.d { color:var(--pw-textDim); } .f { color:var(--pw-textFaint); } .w { color:var(--pw-warning); }
.m { font-weight:${BOLD}; } .hi { color:var(--pw-ownCar); font-weight:${BOLD}; }
.band { background:var(--pw-bgRowBand); display:inline-block; width:100%; }
.me { color:var(--pw-ownCar); font-weight:${BOLD}; box-shadow:inset ${DEFAULT_THEME.table.barPx}px 0 0 var(--pw-text); display:inline-block; width:100%; }
.tip { text-decoration:underline dotted var(--pw-textFaint); }
.fld { box-shadow:inset 0 0 0 ${DEFAULT_THEME.table.borderPx}px var(--pw-border); color:var(--pw-text); }
.fld.on { box-shadow:inset 0 0 0 ${DEFAULT_THEME.table.borderPx}px var(--pw-focus); }
.btn { color:var(--pw-textDim); }
.sel { background:var(--pw-bgBand); color:var(--pw-text); }
.cur { background:var(--pw-bgBand); color:var(--pw-text); display:inline-block; width:100%; }
.pop { display:inline-block; border:1px solid var(--pw-border); background:var(--pw-bgPanel); }
.pop .bandT { background:var(--pw-bgBand); color:var(--pw-textDim); padding:0 1ch; white-space:nowrap; }
.topbar { display:flex; justify-content:space-between; gap:2ch; padding:0 1ch; border:1px solid var(--pw-border); color:var(--pw-textDim); white-space:nowrap; }
.topbar .side { display:flex; gap:2ch; } .topbar .t { color:var(--pw-text); }
.window { outline:1px dashed var(--pw-border); background:var(--pw-bg); padding-bottom:${DEFAULT_THEME.density.panelGapPx}px; }
.groups { display:flex; gap:${DEFAULT_THEME.density.panelGapPx * 3}px; padding:${DEFAULT_THEME.density.panelGapPx}px; }
.group { display:flex; flex-direction:column; gap:${DEFAULT_THEME.density.panelGapPx}px; }
.group .line { display:flex; gap:${DEFAULT_THEME.density.panelGapPx}px; align-items:flex-start; }
`;

// ---------------------------------------------------------------- HTML helpers
// An inline chart in a line counts as the cells it declares (`data-cells`), so lines with charts are measured like text.
const strip = (s) => s.replace(/<svg data-cells="(\d+)"[\s\S]*?<\/svg>/g, (_, n) => 'x'.repeat(Number(n))).replace(/<[^>]+>/g, '');
const vis = (s) => [...strip(s)].length;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const span = (cls, t, tip) => (cls || tip ? `<span${cls ? ` class="${cls}"` : ''}${tip ? ` title="${esc(tip)}"` : ''}>${t}</span>` : t);
const sp = (n) => ' '.repeat(Math.max(0, n));
const padR = (s, n) => s + sp(n - vis(s));
const padL = (s, n) => sp(n - vis(s)) + s;
const C = (t, c, tip) => ({ t, c, tip });
/** An unknown value: the kit's one-character mark, faint, its reason on hover. */
const U = (reason) => ({ t: span('f tip', TEXT.unknownMark[reason], TEXT.unknownReason[reason]) });
const GEAR = '<svg width="14" height="14" viewBox="0 0 14 14" style="display:inline;vertical-align:-2px"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="1.1" stroke-dasharray="2 1.4"/><circle cx="7" cy="7" r="2.1" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>';

/** Character-cell table (the 4.1a helper): spec = [{ h, w, a }], rows = [{ cls?, band?, cells } | { raw }]; GAP cells apart. */
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

/** Panel frame B: header band (title, link marker, state, gear), then the body in character cells. */
const SIZES = [];
function panel(title, { cols, rows, link = '', state = '', lines = [], size }) {
  for (const l of lines) if (vis(l) > cols) throw new Error(`${title}: line wider than ${cols}: "${strip(l)}" (${vis(l)})`);
  if (rows !== undefined && lines.length > rows) throw new Error(`${title}: ${lines.length} rows, more than ${rows}`);
  if (size) SIZES.push(`${title} ${size}: ${cols}×${rows ?? lines.length}`);
  const fill = rows !== undefined ? rows - lines.length : 0;
  return `<div class="panel" style="width:${cols + 2}ch"><div class="ph"><span class="t">${title}</span><span class="lk">${link}</span><span class="sp"></span><span>${state}</span><span>${GEAR}</span></div><pre>${lines.join('\n')}</pre>${fill > 0 ? `<div style="height:${fill * CELL_H}px"></div>` : ''}</div>`;
}
const cap = (t) => `<div class="cap">${t}</div>`;
const fig = (p, c) => `<div>${p}${cap(c)}</div>`;
const page = (file, title, body) => {
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>${CSS}</style></head><body><h1>${title}</h1>${body}</body></html>\n`;
  writeFileSync(new URL(file, import.meta.url), html);
};

// ================================================================ DIST: the distribution strip (a proposed kit piece, kit/dist)
// One cell per bin, a bar per bin from a common baseline, the height its chance against the panel's largest bin (so rows
// compare). Two forms:
//  - places: P1 … P20, one cell each, bars in textDim (ownCar on the committed or own row); our place now a white
//    underline; the header row labels P1, P10, P20 above their cells;
//  - gain: signed bins around zero (seconds or places); a textDim zero line; bins below zero textFaint, at or above textDim;
//    an optional dotted threshold (the gap the rival has to be passed by).
const DIST = { top: 2, base: CELL_H - 3, barInset: 1 };
const svgOpen = (cells) => `<svg data-cells="${cells}" width="${cells * CELL_W}" height="${CELL_H}" viewBox="0 0 ${cells * CELL_W} ${CELL_H}">`;
function placesStrip(p, { max, now, own = false }) {
  const n = p.length;
  let s = svgOpen(n);
  s += `<line x1="0" x2="${n * CELL_W}" y1="${DIST.base + 0.5}" y2="${DIST.base + 0.5}" stroke="${R.border}"/>`;
  if (now !== undefined) s += `<rect x="${(now - 1) * CELL_W}" y="${DIST.base}" width="${CELL_W}" height="2" fill="${R.text}"/>`;
  p.forEach((v, i) => {
    const h = Math.max(0, ((DIST.base - DIST.top) * v) / max);
    if (h < 0.4) return;
    s += `<rect x="${i * CELL_W + DIST.barInset}" y="${DIST.base - h}" width="${CELL_W - 2 * DIST.barInset}" height="${h}" fill="${own ? R.ownCar : R.text}"/>`;
  });
  return s + '</svg>';
}
const placesHeader = (n = 20) => padR('P1', 9) + padR('P10', 8) + 'P20'.padStart(n - 17);
function gainStrip(p, { max, zeroAt, threshold, own = false, integer = false }) {
  const n = p.length;
  let s = svgOpen(n);
  s += `<line x1="0" x2="${n * CELL_W}" y1="${DIST.base + 0.5}" y2="${DIST.base + 0.5}" stroke="${R.border}"/>`;
  p.forEach((v, i) => {
    const h = Math.max(0, ((DIST.base - DIST.top) * v) / max);
    if (h < 0.4) return;
    const below = integer ? i < zeroAt : i < zeroAt;
    const fill = own ? R.ownCar : below ? R.textFaint : R.text;
    s += `<rect x="${i * CELL_W + DIST.barInset}" y="${DIST.base - h}" width="${CELL_W - 2 * DIST.barInset}" height="${h}" fill="${fill}"/>`;
  });
  // zero: between bins for continuous bins, under the zero bin's centre for whole places
  const zx = integer ? (zeroAt + 0.5) * CELL_W : zeroAt * CELL_W;
  s += integer
    ? `<line x1="${zx}" x2="${zx}" y1="${DIST.base}" y2="${CELL_H}" stroke="${R.text}"/>`
    : `<line x1="${zx}" x2="${zx}" y1="1" y2="${CELL_H - 1}" stroke="${R.text}"/>`;
  if (threshold !== undefined) s += `<line x1="${threshold * CELL_W}" x2="${threshold * CELL_W}" y1="1" y2="${CELL_H - 1}" stroke="${R.textDim}" stroke-dasharray="1.5 2"/>`;
  return s + '</svg>';
}

// ================================================================ the model numbers (illustrative; computed from their distributions)
const PLACES = 20;
const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]; // the league points table (config)
const sum = (a) => a.reduce((x, y) => x + y, 0);
/** A finishing-place distribution: a skewed bell around mu (sdL ahead, sdR behind) plus a retirement share at P20. */
function placeDist(mu, sdL, sdR, dnf = 0.015) {
  const w = Array.from({ length: PLACES }, (_, i) => { const d = i + 1 - mu; const s = d < 0 ? sdL : sdR; return Math.exp(-(d * d) / (2 * s * s)); });
  const t = sum(w);
  const p = w.map((x) => (x / t) * (1 - dnf));
  p[PLACES - 1] += dnf;
  return p;
}
const ePos = (p) => sum(p.map((x, i) => x * (i + 1)));
const ePts = (p) => sum(p.map((x, i) => x * (POINTS[i] ?? 0)));
const pBetter = (p, now) => sum(p.slice(0, now - 1));
const erf = (x) => { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
const cdf = (x, mu, sd) => 0.5 * (1 + erf((x - mu) / (sd * Math.SQRT2)));
/** Binned normal: bins [lo + k·w, lo + (k+1)·w), k = 0 … n−1. */
const binned = (mu, sd, lo, w, n) => Array.from({ length: n }, (_, k) => cdf(lo + (k + 1) * w, mu, sd) - cdf(lo + k * w, mu, sd));
/** Whole-number bins −h … +h. */
const wholeBins = (mu, sd, h) => Array.from({ length: 2 * h + 1 }, (_, k) => cdf(k - h + 0.5, mu, sd) - cdf(k - h - 0.5, mu, sd));

const NOW = 14, FLAG = 44, OUR_PLACE = 8;

// ================================================================ 1. strategy-table (V16)
// strategy.plans for KUH: ranked rows (§7.4): source, stops, triggers, the place distribution, E[pos], E[points], mean time.
const TRIGGERS = (sc) => `SC/VSC ${sc} · damage +1.2 s/lap · deg +30%`;
const CANDIDATES = [
  { src: 'dp', stops: [[20, 'H']], mu: 7.42, sdL: 1.6, sdR: 1.9, timeMs: 0, trg: 3, sc: 'L12–24' },
  { src: 'neighbour', stops: [[19, 'H']], mu: 7.44, sdL: 1.6, sdR: 1.9, timeMs: 600, trg: 3, sc: 'L12–23' },
  { src: 'neighbour', stops: [[21, 'H']], mu: 7.45, sdL: 1.6, sdR: 1.9, timeMs: 900, trg: 3, sc: 'L12–25' },
  { src: 'rule', rule: 'mirror ahead: NOR boxes L18', stops: [[18, 'H']], mu: 7.64, sdL: 1.6, sdR: 1.9, timeMs: 1700, trg: 3, sc: 'L12–22' },
  { src: 'neighbour', stops: [[22, 'H']], mu: 7.78, sdL: 1.5, sdR: 2.1, timeMs: 1400, trg: 3, sc: 'L12–26' },
  { src: 'dp', stops: [[16, 'H'], [31, 'M']], mu: 7.93, sdL: 1.8, sdR: 2.0, timeMs: 3200, trg: 4, sc: 'L12–20, L25–35' },
  { src: 'dp', stops: [[14, 'H']], mu: 8.35, sdL: 1.7, sdR: 2.0, timeMs: 2600, trg: 3, sc: 'L12–20' },
  { src: 'dp', stops: [[26, 'H']], mu: 8.81, sdL: 1.6, sdR: 2.3, timeMs: 4100, trg: 3, sc: 'L12–28' },
].map((c) => { const p = placeDist(c.mu, c.sdL, c.sdR); return { ...c, p, ePos: ePos(p), ePts: ePts(p) }; });
const TIE = 0.08; // the tie test's band for this sample (max(tieBand, zTie × SE))
/** Rank by E[pos]; rows within the tie test of the leader form a group, ordered by E[points]; ranks 1, 1, 1, 4, … */
function ranked(rows) {
  const s = [...rows].sort((a, b) => a.ePos - b.ePos);
  const lead = s[0].ePos;
  const tied = s.filter((r) => r.ePos - lead < TIE).sort((a, b) => b.ePts - a.ePts);
  const rest = s.filter((r) => r.ePos - lead >= TIE);
  return [...tied.map((r) => ({ ...r, rank: 1, tie: tied.length > 1 })), ...rest.map((r, i) => ({ ...r, rank: tied.length + i + 1, tie: false }))];
}
const stopsText = (stops) => stops.map(([l, c]) => `${FMT.lapNumber(l)} ${c}`).join(' ');
const ST = TEXT.strategy;
const stSpec = (full) => full
  ? [{ h: '', w: 1 }, { h: ST.headers.rank, w: 2, a: 'r' }, { h: ST.headers.src, w: 4 }, { h: ST.headers.stops, w: 17 }, { h: ST.headers.trg, w: 3, a: 'r' }, { h: ST.headers.ePos, w: 6, a: 'r' }, { h: ST.headers.ePts, w: 6, a: 'r' }, { h: ST.headers.dLead, w: 6, a: 'r' }, { h: '', w: 20 }, { h: '', w: 6 }]
  : [{ h: '', w: 1 }, { h: ST.headers.rank, w: 2, a: 'r' }, { h: ST.headers.stops, w: 11 }, { h: ST.headers.ePos, w: 6, a: 'r' }, { h: '', w: 20 }];
/** The tie bracket: a line joining a tied group's rows in its own cell, a tick at its ends; amber when unresolved at the cap. */
const bracketSvg = (first, last, colour) => {
  const x = CELL_W / 2, y0 = first ? CELL_H / 2 : 0, y1 = last ? CELL_H / 2 : CELL_H;
  let s = `<svg data-cells="1" width="${CELL_W}" height="${CELL_H}"><line x1="${x}" x2="${x}" y1="${y0}" y2="${y1}" stroke="${colour}"/>`;
  if (first) s += `<line x1="${x}" x2="${CELL_W}" y1="${y0}" y2="${y0}" stroke="${colour}"/>`;
  if (last) s += `<line x1="${x}" x2="${CELL_W}" y1="${y1}" y2="${y1}" stroke="${colour}"/>`;
  return s + '</svg>';
};
const bracketOf = (rows, i, openTie) => {
  const r = rows[i];
  if (!r.tie) return C('');
  const first = i === 0 || !rows[i - 1].tie, last = i === rows.length - 1 || !rows[i + 1].tie;
  return C(bracketSvg(first, last, openTie ? R.warning : R.textDim), '', openTie ? ST.openTieHover(5000) : ST.tieHover);
};
function strategyLines({ full, rows: n = full ? 8 : 5, committed, openTie = false, scenarios = 2840, candidates = 14, cap = 5000 } = {}) {
  let rows = ranked(openTie ? CANDIDATES.map((c, i) => (i === 1 ? { ...c, mu: 7.43 } : i === 2 ? { ...c, mu: 7.56 } : c)).map((c) => { const p = placeDist(c.mu, c.sdL, c.sdR); return { ...c, p, ePos: ePos(p), ePts: ePts(p) }; }) : CANDIDATES);
  if (openTie) rows = rows.map((r, i) => ({ ...r, tie: i < 2, rank: i < 2 ? 1 : i + 1 }));
  if (committed !== undefined) {
    const k = rows.findIndex((r) => stopsText(r.stops) === committed);
    rows = rows.map((r, i) => (i === k ? { ...r, committed: true } : r));
  }
  rows = rows.slice(0, n);
  const max = Math.max(...rows.flatMap((r) => r.p));
  const refMs = committed !== undefined ? rows.find((r) => r.committed).timeMs : rows[0].timeMs;
  const spec = stSpec(full);
  const head = full
    ? [...spec.slice(0, 7).map((c) => c.h), committed !== undefined ? ST.headers.dPlan : ST.headers.dLead, placesHeader(), '']
    : [...spec.slice(0, 4).map((c) => c.h), placesHeader()];
  const body = rows.map((r, i) => {
    const src = r.committed ? 'committed' : r.src;
    const srcCell = C(ST.source[src], r.committed ? '' : 'd', src === 'rule' ? ST.sourceHover.rule(r.rule) : ST.sourceHover[src]);
    const isRef = r.committed || (committed === undefined && i === 0);
    const dCell = isRef ? '' : FMT.signedSeconds(r.timeMs - refMs, 1);
    const strip = { t: placesStrip(r.p, { max, now: OUR_PLACE, own: r.committed }) };
    const act = r.committed ? C(ST.clear, 'btn', ST.clearHover) : C(ST.commit, 'btn', ST.commitHover);
    const cells = full
      ? [bracketOf(rows, i, openTie), String(r.rank), srcCell, stopsText(r.stops), C(FMT.count(r.trg), '', TRIGGERS(r.sc)), FMT.expectedPlace(r.ePos), FMT.points(r.ePts), dCell, strip, act]
      : [bracketOf(rows, i, openTie), String(r.rank), stopsText(r.stops), FMT.expectedPlace(r.ePos), strip];
    return { cls: r.committed ? 'me' : '', band: i % 2 === 1, cells };
  });
  const lines = table(spec, body, { headCells: head });
  if (full) {
    const nCell = scenarios >= cap ? span('w', FMT.count(scenarios), ST.capHover(cap)) : FMT.count(scenarios);
    lines.push(` ${span('f', ST.meta.n)} ${nCell}  ${span('f', ST.meta.cand)} ${FMT.count(candidates)}`);
  }
  return lines;
}
const FULL_ST = { cols: 88, rows: 10 }, COMPACT_ST = { cols: 46, rows: 6 };
const stratPanel = (o, link = '1 · KUH') => panel(ST.title, { ...(o.full ? FULL_ST : COMPACT_ST), link, state: o.state ?? FMT.lapNumber(NOW), lines: o.lines ?? strategyLines(o), size: o.size });

page('strategy-table.html', 'SP4.3b2 · strategy-table (V16), round 1', `
<div class="note">Sample: Spa L14/44, KUH P8 on mediums since L1. One row per policy, ranked by E[pos]; the strip is the finishing-place distribution P1…P20 (one cell a place, heights against the panel's largest bar, our place now underlined white). A bracket groups rows within the tie test, ordered by E[points]; amber when the tie is unresolved at the cap. SRC: <b>dp</b>, <b>nbr</b> (a stop lap next to a DP plan), <b>rule</b> (hover names the rule), <b>plan</b> (committed). TRG hover lists the triggers and their thresholds. ΔTIME is the mean race time against the leader; with a commit the column becomes <b>ΔPLAN</b>, against the committed row. Footer: scenarios run and candidates (amber at the cap). <code>commit</code> and <code>clear</code> are quiet buttons (<code>plan.commit</code>, <code>plan.clear</code>, declared, C74).</div>
<h2>Full ${FULL_ST.cols}×${FULL_ST.rows}</h2>
<div class="row">${fig(stratPanel({ full: true, size: 'full' }), 'no commit · three stop laps tie at the top (L20, L19, L21 onto H)')}</div>
<div class="row" style="margin-top:12px">${fig(stratPanel({ full: true, committed: 'L19 H' }), 'L19 H committed: the row white with the bar, SRC plan, its button clear; ΔPLAN against it; the other rows keep their rank')}</div>
<div class="row" style="margin-top:12px">${fig(stratPanel({ full: true, openTie: true, scenarios: 5000 }), 'near-tie unresolved at the cap: the bracket and N amber; hover on the bracket says it')}</div>
<div class="row" style="margin-top:12px">${fig(panel(ST.title, { ...FULL_ST, link: '1 · KUH', lines: [span('f tip', ' ' + TEXT.unknownMark.notApplicable, TEXT.unknownReason.notApplicable)] }), 'notApplicable (outside the race phase): the en dash, the reason on hover')}${fig(panel(ST.title, { ...COMPACT_ST, link: '1 · KUH', state: span('f', TEXT.noDataYet), lines: [] }), 'computing, no result yet (Computed&lt;T&gt; not arrived): the frame\'s header state; a newer run on its way keeps the old rows and their lap')}</div>
<h2>Compact ${COMPACT_ST.cols}×${COMPACT_ST.rows}</h2>
<div class="row">${fig(stratPanel({ full: false, size: 'compact' }), 'compact · rank, stops, E[pos], the strip; no buttons (the commands stay in the palette)')}${fig(stratPanel({ full: false, committed: 'L19 H' }), 'compact · committed')}</div>`);

// ================================================================ 2. undercut-card (V13)
// undercut.car for KUH: per rival within 3.0 s and N = 1–3: ΔGAP (positive = good for us), P(ahead), the gain distribution,
// our rejoin place. Gain bins −4 … +4 s by 0.5 s (16 cells); the dotted line is the gap a car ahead has to be passed by.
const GAIN_LO = -4, GAIN_W = 0.5, GAIN_N = 16, GAIN_SD = 0.9;
const RIVALS = [
  { code: 'ALB', place: 6, gapS: 2.6, ahead: true, n: [0.7, 1.4, 2.0], rej: [13, 13, 13] },
  { code: 'NOR', place: 7, gapS: 1.2, ahead: true, n: [0.9, 1.6, 2.2], rej: [13, 13, 13] },
  { code: 'HUL', place: 9, gapS: 0.9, ahead: false, n: [-0.6, -1.2, -1.9], rej: [12, 12, 11] },
];
const UC = TEXT.undercut;
const ucSpec = [{ h: UC.headers.car, w: 3 }, { h: UC.headers.pos, w: 3, a: 'r' }, { h: UC.headers.gap, w: 3, a: 'r' }, { h: UC.headers.n, w: 1, a: 'r' }, { h: UC.headers.dGap, w: 4, a: 'r' }, { h: UC.headers.pAhead, w: 5, a: 'r' }, { h: '', w: GAIN_N }, { h: UC.headers.rej, w: 3, a: 'r' }];
const gainHeader = padR(`${MINUS}4`, 8) + padR('0', 6) + '+4';
function undercutLines(rivals, { full }) {
  const all = rivals.flatMap((r) => r.n.map((mu) => binned(mu, GAIN_SD, GAIN_LO, GAIN_W, GAIN_N)));
  const max = Math.max(...all.flat(), 0.01);
  const ours = { code: 'KUH', place: OUR_PLACE };
  const ahead = rivals.filter((r) => r.ahead), behind = rivals.filter((r) => !r.ahead);
  if (!full) {
    const spec = [{ h: '', w: 3 }, { h: '', w: 3, a: 'r' }, { h: 'N1', w: 4, a: 'r' }, { h: 'N2', w: 4, a: 'r' }, { h: 'N3', w: 4, a: 'r' }];
    const rowsOf = (r) => ({ cells: [r.code, FMT.position(r.place), ...r.n.map((g) => FMT.signedSeconds(g * 1000, 1))] });
    return table(spec, [...ahead.map(rowsOf), { cls: 'hi', cells: [ours.code, FMT.position(ours.place), '', '', ''] }, ...behind.map(rowsOf)], { band: false });
  }
  const body = [];
  const rivalRows = (r, k) => r.n.forEach((mu, i) => {
    const p = binned(mu, GAIN_SD, GAIN_LO, GAIN_W, GAIN_N);
    // ahead: we pass when the gain exceeds its gap; behind: we stay ahead while its gap plus our gain stays above zero
    const pAhead = r.ahead ? 1 - cdf(r.gapS, mu, GAIN_SD) : 1 - cdf(-r.gapS, mu, GAIN_SD);
    const threshold = ((r.ahead ? r.gapS : -r.gapS) - GAIN_LO) / GAIN_W;
    body.push({ band: k % 2 === 1, cells: [i === 0 ? r.code : '', i === 0 ? FMT.position(r.place) : '', i === 0 ? FMT.seconds(r.gapS * 1000, 1) : '', String(i + 1), FMT.signedSeconds(mu * 1000, 1), FMT.pct(pAhead), { t: gainStrip(p, { max, zeroAt: -GAIN_LO / GAIN_W, threshold }) }, FMT.position(r.rej[i])] });
  });
  ahead.forEach((r, k) => rivalRows(r, k));
  body.push({ cls: 'hi', cells: [ours.code, FMT.position(ours.place), '', '', '', '', '', ''] });
  behind.forEach((r, k) => rivalRows(r, ahead.length + k));
  return table(ucSpec, body, { band: false, headCells: [...ucSpec.slice(0, 6).map((c) => c.h), gainHeader, ucSpec[7].h] });
}
const FULL_UC = { cols: 47, rows: 11 }, COMPACT_UC = { cols: 26, rows: 5 };
const ucPanel = (rivals, full, o = {}) => panel(UC.title, { ...(full ? FULL_UC : COMPACT_UC), link: o.link ?? '1 · KUH', state: FMT.lapNumber(NOW), lines: o.lines ?? undercutLines(rivals, { full }), size: o.size });
const ucNone = (full) => full
  ? [span('f', ' ' + [...ucSpec.slice(0, 6).map((c, i) => (c.a === 'r' ? padL(c.h, c.w) : padR(c.h, c.w))), padR(gainHeader, GAIN_N), padL(UC.headers.rej, 3)].join(sp(GAP))), span('hi tip', ` KUH ${FMT.position(OUR_PLACE)}`, UC.noneHover)]
  : [span('hi tip', ` KUH ${FMT.position(OUR_PLACE)}`, UC.noneHover)];

page('undercut-card.html', 'SP4.3b2 · undercut-card (V13), round 1', `
<div class="note">Sample: Spa L14/44, KUH P8. Rivals within 3.0 s in place order, our own line between those ahead and behind. Per rival and N = 1–3 (the rival boxes N laps after us; for a car behind, it boxes now and we N laps later): ΔGAP once both have stopped (positive = good for us), P(AH) we are ahead then, the gain distribution (bins of 0.5 s from −4 to +4 s; the white line is zero, bars below zero fainter; the dotted line is the gap: bars right of it end ahead), our rejoin place.</div>
<h2>Full ${FULL_UC.cols}×${FULL_UC.rows}</h2>
<div class="row">${fig(ucPanel(RIVALS, true, { size: 'full' }), 'NOR 1.2 s and ALB 2.6 s ahead, HUL 0.9 s behind; GAS 3.4 s behind is out of range: no row')}${fig(ucPanel([], true, { lines: ucNone(true) }), 'no car within 3.0 s: our line alone, the range on hover')}</div>
<h2>Compact ${COMPACT_UC.cols}×${COMPACT_UC.rows}</h2>
<div class="row">${fig(ucPanel(RIVALS, false, { size: 'compact' }), 'compact · ΔGAP per N, one line per rival')}${fig(ucPanel([], false, { lines: ucNone(false) }), 'compact · no car in range')}</div>`);

// ================================================================ 3. pit-sweep-table (V15)
// pitSweep.car for KUH, compound auto → H: per stop lap L14 … L26 the policy "box at L onto H, then the DP's best".
// The window: rows within the tie test of the best. LIFE: the mediums pass their life (L22) when the stop is later.
const SWEEP = Array.from({ length: 13 }, (_, i) => {
  const lap = NOW + i;
  const traffic = { 14: 1, 15: 2, 16: 3, 17: 3, 18: 1, 19: 0, 20: 0, 21: 1, 22: 1, 23: 0, 24: 0, 25: 1, 26: 0 }[lap];
  const rej = { 14: 13, 15: 13, 16: 14, 17: 14, 18: 13, 19: 12, 20: 12, 21: 12, 22: 11, 23: 11, 24: 11, 25: 10, 26: 10 }[lap];
  const mu = 7.42 + 0.018 * (lap - 20) ** 2 + 0.05 * traffic + (lap > 22 ? 0.12 * (lap - 22) : 0);
  const p = placeDist(mu, 1.6, 1.95);
  return { lap, traffic, rej, p, ePos: ePos(p), pGain: pBetter(p, OUR_PLACE), lifeOver: lap > 22 };
});
const SW = TEXT.sweep;
const swSpec = (full) => full
  ? [{ h: SW.headers.lap, w: 3 }, { h: SW.headers.rej, w: 3, a: 'r' }, { h: SW.headers.trf, w: 3, a: 'r' }, { h: SW.headers.ePos, w: 6, a: 'r' }, { h: '', w: 20 }, { h: SW.headers.pGain, w: 7, a: 'r' }, { h: SW.headers.life, w: 4, a: 'r' }]
  : [{ h: SW.headers.lap, w: 3 }, { h: SW.headers.rej, w: 3, a: 'r' }, { h: SW.headers.ePos, w: 6, a: 'r' }, { h: SW.headers.pGain, w: 7, a: 'r' }, { h: '', w: 1 }];
const LIFE_MARK = '■';
function sweepLines({ full, compound = 'H', auto = true, rows }) {
  const list = rows ?? SWEEP;
  const max = Math.max(...list.flatMap((r) => r.p));
  const best = Math.min(...(rows ?? SWEEP).map((r) => r.ePos));
  const inWindow = (r) => r.ePos - best < TIE;
  const life = (r) => (r.lifeOver ? C(LIFE_MARK, 'w', SW.lifeHover) : '');
  const body = list.map((r) => ({ cls: inWindow(r) ? 'm' : '', cells: full
    ? [FMT.lapNumber(r.lap), FMT.position(r.rej), FMT.count(r.traffic), FMT.expectedPlace(r.ePos), { t: placesStrip(r.p, { max, now: OUR_PLACE }) }, FMT.pct(r.pGain), life(r)]
    : [FMT.lapNumber(r.lap), FMT.position(r.rej), FMT.expectedPlace(r.ePos), FMT.pct(r.pGain), life(r)] }));
  const spec = swSpec(full);
  // the first header cell names the compound swept, in the text role; hover says whether auto resolved it
  const head = table(spec, [], { headCells: [compound, ...spec.slice(1).map((c, i) => (full && i === 3 ? placesHeader() : c.h))] })[0];
  const lead = span('tip', compound, auto ? SW.compoundHover.auto : SW.compoundHover.set);
  const headLine = head.replace(`<span class="f"> ${compound}`, ` ${lead}<span class="f">`);
  return [headLine, ...table(spec, body, { head: false })];
}
const FULL_SW = { cols: 53, rows: 14 }, COMPACT_SW = { cols: 26, rows: 6 };
const swPanel = (full, o = {}) => panel(SW.title, { ...(full ? FULL_SW : COMPACT_SW), link: '1 · KUH', state: FMT.lapNumber(NOW), lines: sweepLines({ full, ...o }), size: o.size });
const SW_S = SWEEP.map((r) => { const mu = 7.6 + 0.02 * (r.lap - 18) ** 2 + 0.05 * r.traffic + (r.lap > 22 ? 0.12 * (r.lap - 22) : 0); const p = placeDist(mu, 1.6, 2.0); return { ...r, p, ePos: ePos(p), pGain: pBetter(p, OUR_PLACE) }; });
const optionsPop = `<div class="pop"><div class="bandT">${SW.title} · 1 · KUH</div><pre> ${span('f', SW.option)}  ${span('fld on', padR(` ${SW.auto} ▾`, 8))}\n${sp(11)}${span('sel', padR(` ${SW.auto}`, 8))}\n${sp(11)} S\n${sp(11)} M\n${sp(11)} H</pre></div>`;

page('pit-sweep-table.html', 'SP4.3b2 · pit-sweep-table (V15), round 1', `
<div class="note">Sample: Spa L14/44, KUH P8 on mediums since L1 (their life ends L22). One row per stop lap from now: box onto the swept compound, then the DP's best continuation. The first header cell is the compound swept (hover: auto or set). REJ rejoin place, TRF cars within 1.0 s in the first 3 laps after the stop, E[POS], the finishing-place strip, P(GAIN) a better finish than P8, LIFE an amber square when the mediums pass their life before the stop. Bold rows: the window (within the tie test of the best).</div>
<h2>Full ${FULL_SW.cols}×${FULL_SW.rows}</h2>
<div class="row">${fig(swPanel(true, { size: 'full' }), 'auto → H: the window L19–21 bold; the L16–17 traffic shows in TRF and E[POS]; L23 on the mediums past their life')}${fig(swPanel(true, { compound: 'S', auto: false, rows: SW_S }), 'compound set to S in the panel options')}</div>
<h2>The panel option (the gear: a persistent change through the panel, C73, C74)</h2>
<div class="row">${fig(optionsPop, 'compound: auto (default), S, M, H; the list open')}</div>
<h2>Compact ${COMPACT_SW.cols}×${COMPACT_SW.rows}</h2>
<div class="row">${fig(swPanel(false, { size: 'compact', rows: SWEEP.filter((r) => r.lap >= 18 && r.lap <= 22) }), 'compact · no strip and no traffic; the rows around the window')}</div>`);

// ================================================================ 4. sc-card (V18, change)
// scCall.car for KUH, "if one came now": box under it now against staying out. ΔPOS = E[pos] stay − E[pos] box (positive =
// good for us), P(GAIN) = chance boxing finishes ahead of staying out, the distribution of the places gained per scenario
// (−4 … +4, a cell each; the white tick is zero), rejoin, the loss with its badge, the DP's trigger range for the next stop.
const BADGE = { session: '', calibration: 'ᶜ', default: 'ᵈ' };
const HOVER = { calibration: 'calibration · Spa league · 3 sources', default: 'default · Spa track file' };
const bv = (v, src) => (src === 'session' ? v + ' ' : span('', v, HOVER[src]) + span('d', BADGE[src]));
const SCC = TEXT.sc;
const SC_H = 4, SC_SD = 1.3;
const scRow = (cond, mu, rej, loss, src, range) => { const p = wholeBins(mu, SC_SD, SC_H); return { cond, p, dPos: sum(p.map((x, k) => x * (k - SC_H))), pGain: sum(p.slice(SC_H + 1)), rej, loss, src, range }; };
const SC_GREEN = [scRow('sc', 1.4, 9, 9800, 'default', [12, 24]), scRow('vsc', 0.6, 10, 13100, 'calibration', [15, 24])];
const SC_OUT = [scRow('sc', 1.9, 9, 9800, 'default', [12, 24]), scRow('vsc', 0.6, 10, 13100, 'calibration', [15, 24])];
const VSC_OUT = [scRow('sc', 1.4, 9, 9800, 'default', [12, 24]), scRow('vsc', 0.9, 10, 13100, 'calibration', [15, 24])];
const scSpecFull = [{ h: '', w: 3 }, { h: SCC.headers.dPos, w: 4, a: 'r' }, { h: SCC.headers.pGain, w: 7, a: 'r' }, { h: '', w: 2 * SC_H + 1 }, { h: SCC.headers.rej, w: 3, a: 'r' }, { h: SCC.headers.loss, w: 5, a: 'r' }, { h: SCC.headers.range, w: 6, a: 'r' }];
const scSpecCompact = [{ h: '', w: 3 }, { h: '', w: 4, a: 'r' }, { h: '', w: 4, a: 'r' }, { h: '', w: 3, a: 'r' }];
function scLines(rows, active, { full, unknown = false }) {
  const max = Math.max(...rows.flatMap((r) => r.p));
  const body = rows.map((r, i) => {
    const lit = active === r.cond;
    const u = (reason = 'insufficientData') => U(reason);
    // Q5 B: while one condition is out, the other cannot start (race-hazard): its row is notApplicable in every cell
    const na = active !== null && active !== undefined && !lit;
    const cells = na
      ? [TEXT.condition[r.cond], ...(full ? [u('notApplicable'), u('notApplicable'), u('notApplicable'), u('notApplicable'), u('notApplicable'), u('notApplicable')] : [u('notApplicable'), u('notApplicable'), u('notApplicable')])]
      : full
      ? unknown
        ? [TEXT.condition[r.cond], u(), u(), '', u(), u(), u()]
        : [TEXT.condition[r.cond], FMT.placesGained(r.dPos), FMT.pct(r.pGain), { t: gainStrip(r.p, { max, zeroAt: SC_H, integer: true, own: lit }) }, FMT.position(r.rej), bv(FMT.seconds(r.loss, 1), r.src), FMT.lapRange(...r.range)]
      : [TEXT.condition[r.cond], FMT.placesGained(r.dPos), FMT.pct(r.pGain), FMT.position(r.rej)];
    return { cls: lit ? 'hi' : '', band: full && i % 2 === 1 && !lit, cells };
  });
  if (!full) return table(scSpecCompact, body, { head: false, band: false });
  const condHead = active ? span('w', TEXT.condition[active]) : '';
  return table(scSpecFull, body, { band: false, headCells: [condHead, ...scSpecFull.slice(1).map((c, i) => (i === 2 ? padR(`${MINUS}4`, SC_H) + '0' + padL('+4', SC_H) : c.h))] });
}
const FULL_SC = { cols: 45, rows: 3 }, COMPACT_SC = { cols: 26, rows: 2 };
const scState = (active) => (active ? span('w', TEXT.condition[active]) : '');
const scPanel = (rows, active, full, o = {}) => panel(SCC.title, { ...(full ? FULL_SC : COMPACT_SC), link: o.link ?? '1 · KUH', state: scState(active), lines: scLines(rows, active, { full, ...o }), size: o.size });

page('sc-card.html', 'SP4.3b2 · SC / VSC call (V18, change), round 2', `
<div class="note">The approved 4.2 card, its GAIN in seconds replaced by the Monte Carlo's answer (KUH, Spa L14/44, P8): per condition, if one came now, boxing under it against staying out. ΔPOS the places gained in expectation (positive = good for us), P(GAIN) the chance boxing finishes ahead, the distribution of places gained per scenario (−4 … +4, one cell each; the white tick under the middle cell is zero), REJ the rejoin place, LOSS the stop's loss with its badge (ᶜ calibration, ᵈ default, hover names it), RANGE the DP's trigger range for the next stop under that condition. Under SC or VSC the header names it in amber and its row is white bold, as now; the other row shows – in every cell (not applicable on hover: no second neutralisation starts while one is out, Q5 B).</div>
<h2>Full ${FULL_SC.cols}×${FULL_SC.rows} (was 30×3)</h2>
<div class="row">${fig(scPanel(SC_GREEN, null, true, { size: 'full' }), 'green running: L14 is inside both ranges for an SC, the VSC range opens L15')}${fig(scPanel(SC_OUT, 'sc', true), 'SC out: its row the real SC with its remaining laps; VSC –')}</div>
<div class="row" style="margin-top:12px">${fig(scPanel(VSC_OUT, 'vsc', true), 'VSC out: SC –')}${fig(scPanel(SC_GREEN, null, true, { unknown: true }), 'unknown: the kit\'s … marks, the reason on hover')}</div>
<h2>Compact ${COMPACT_SC.cols}×${COMPACT_SC.rows} (unchanged size)</h2>
<div class="row">${fig(scPanel(SC_GREEN, null, false, { size: 'compact' }), 'compact · ΔPOS, P(GAIN), REJ')}${fig(scPanel(SC_OUT, 'sc', false), 'compact · SC out')}</div>`);

// ================================================================ 5. drivers-panel (new, garage)
// drivers.profiles, drivers.links (seats), the session's lobby settings (bindLive), the feed's effective config (§2.3).
const DR = TEXT.drivers;
const PERSONS = {
  kuh: {
    entries: [
      ['sigmaMs', '0.412', 214, 5, '08 Nov', { ovr: '0.380' }], ['rho', '0.31', 214, 5, '08 Nov'], ['mistakeRate', '0.024', 214, 5, '08 Nov'],
      ['mistakeMedianMs', '1.9', 214, 5, '08 Nov'], ['mistakeSigmaLog', '0.55', 214, 5, '08 Nov'], ['wearS', '3.1', 22, 2, '07 Nov'], ['wearM', '2.2', 118, 4, '08 Nov'], ['wearH', '1.6', 74, 3, '01 Nov'],
    ],
    sessions: [['2026-11-08', 'Spa', 'Q1', 18, true], ['2026-11-07', 'Spa', 'FP2', 31, true], ['2026-11-01', 'Monza', 'race', 51, true], ['2026-10-31', 'Monza', 'FP2', 28, true], ['2026-10-25', 'Zandvoort', 'race', 70, false], ['2026-10-18', 'Austin', 'race', 86, true]],
  },
  lin: {
    entries: [
      ['sigmaMs', '0.447', 166, 4, '08 Nov'], ['rho', '0.28', 166, 4, '08 Nov'], ['mistakeRate', '0.031', 166, 4, '08 Nov', { draft: '0.4', rejected: 'mistake/lap 0 to 0.2' }],
      ['mistakeMedianMs', '2.3', 166, 4, '08 Nov'], ['mistakeSigmaLog', '0.61', 166, 4, '08 Nov'], ['wearS', null, 0, 0, ''], ['wearM', '2.4', 96, 3, '08 Nov'], ['wearH', '1.7', 61, 3, '01 Nov'],
    ],
    sessions: [['2026-11-08', 'Spa', 'Q1', 18, true], ['2026-11-07', 'Spa', 'FP2', 26, true], ['2026-11-01', 'Monza', 'race', 51, true], ['2026-10-25', 'Zandvoort', 'race', 71, true]],
  },
};
const SEATS = [{ team: 'Mercedes', number: 12, person: 'kuh' }, { team: 'Mercedes', number: 63, person: 'lin' }];
const LOBBY = [['safetyCar', 'standard'], ['redFlags', 'standard'], ['carDamage', 'standard'], ['carDamageRate', 'standard'], ['tyreTemperature', 'surface + carcass'], ['recoveryMode', 'none']];
const CONFIG = [
  ['strategy', 'neighbourLaps', '3'], ['', 'maxStops', '3'], ['', 'ruleGapMs', '3000'],
  ['race-monte-carlo', 'n0', '40'], ['', 'zDrop', '2.8'], ['', 'tieBand', '0.05'], ['', 'maxScenarioPolicies', '5000'],
  ['undercut', 'undercutRangeMs', '2500', true], ['', 'maxScenarioPolicies', '2400'],
  ['pit-sweep', 'trafficGapMs', '1000'], ['', 'trafficLaps', '3'],
  ['race-hazard', 'reducedFactor', '0.5'], ['', 'increasedFactor', '1.5'],
  ['battle', 'drsRangeMs', '1000', true],
];
const PERSON_COLS = 44;
const entrySpec = [{ h: DR.headers.entry, w: 12 }, { h: DR.headers.value, w: 6, a: 'r' }, { h: DR.headers.laps, w: 4, a: 'r' }, { h: DR.headers.ses, w: 3, a: 'r' }, { h: DR.headers.newest, w: 6, a: 'r' }, { h: DR.headers.ovr, w: 7 }];
const sessSpec = [{ h: '', w: 3 }, { h: DR.sessionHeaders.date, w: 6 }, { h: DR.sessionHeaders.track, w: 9 }, { h: DR.sessionHeaders.session, w: 4 }, { h: DR.sessionHeaders.laps, w: 4, a: 'r' }];
function personLines(id, { linked = true } = {}) {
  const pr = PERSONS[id];
  const out = [];
  const seat = SEATS.find((s) => s.person === id);
  out.push(` ${span('f', `#${seat.number}`)} ${seat.team} ${TEXT.arrow} ${span('fld', padR(` ${linked ? id : DR.picker.none} ▾`, 9))}`);
  if (!linked) return out;
  out.push(...table(entrySpec, pr.entries.map(([k, v, laps, ses, newest, o = {}], i) => {
    const value = v === null ? U('insufficientData') : o.ovr ? C(v, 'f', DR.overrideHover(o.ovr)) : v;
    const ovr = o.ovr ? C(padL(o.ovr, 6) + ' ', 'fld') : o.draft ? C(padL(o.draft, 6) + ' ', 'fld on') : C('', 'fld');
    return { cells: [DR.entries[k], value, v === null ? '' : FMT.count(laps), v === null ? '' : FMT.count(ses), newest, ovr] };
  }), { band: false }));
  const rej = pr.entries.find((e) => e[5]?.rejected);
  if (rej) out.push(` ${span('w', DR.rejected(rej[5].rejected))}`);
  out.push('');
  out.push(` ${span('f', DR.sessions)}`);
  out.push(...table(sessSpec, pr.sessions.map(([date, track, ses, laps, kept]) => {
    const c = kept ? '' : 'f';
    return { cells: [C(kept ? DR.toggle.kept : DR.toggle.excluded, kept ? '' : 'd', kept ? DR.keptHover : DR.excludedHover), C(FMT.day(date), c), C(track, c), C(ses, c), C(FMT.count(laps), c)] };
  }), { head: false, band: false }));
  return out;
}
const sideBySide = (a, b, wa) => Array.from({ length: Math.max(a.length, b.length) }, (_, i) => padR(a[i] ?? '', wa) + (b[i] ?? '')).map((l) => l.replace(/\s+$/, ''));
const lobbySpec = [{ h: '', w: 12 }, { h: '', w: 18 }];
const cfgSpec = [{ h: DR.configHeaders.unit, w: 16 }, { h: DR.configHeaders.key, w: 19 }, { h: DR.configHeaders.value, w: 6, a: 'r' }];
const lobbyLines = () => [` ${span('f', DR.lobby)}`, ...table(lobbySpec, LOBBY.map(([k, v]) => ({ cells: [C(DR.lobbyKeys[k], 'd'), v] })), { head: false, band: false })];
const configLines = (n = CONFIG.length) => [` ${span('f', DR.config)}`, ...table(cfgSpec, CONFIG.slice(0, n).map(([u, k, v, json]) => ({ cells: [C(u, 'd'), C(k, 'd'), json ? C(v + span('d', DR.jsonMark), '', DR.jsonHover) : C(v + ' ', 'd')] })), { band: false })];
// cfgSpec's value column holds the badge cell: widen the numbers by one so `2500ʲ` and `3000 ` align
cfgSpec[2].w = 7;
function driversFull() {
  const left = [` ${span('f', DR.seats)}`, ...personLines('kuh')];
  const right = ['', ...personLines('lin')];
  return [...sideBySide(left, right, PERSON_COLS + 2), '', ...sideBySide(lobbyLines(), configLines(), 34)];
}
const compactSpec = [{ h: '', w: 3 }, { h: '', w: 8 }, { h: '', w: 6 }, { h: DR.headers.ses, w: 3, a: 'r' }, { h: DR.headers.laps, w: 4, a: 'r' }];
const driversCompact = (linLinked = true) => table(compactSpec, SEATS.map((s) => {
  const linked = s.person !== 'lin' || linLinked;
  const pr = PERSONS[s.person];
  return { cells: [C(`#${s.number}`, 'f'), s.team, linked ? s.person : U('notApplicable'), linked ? FMT.count(pr.sessions.filter((x) => x[4]).length) : '', linked ? FMT.count(pr.entries[0][2]) : ''] };
}), { band: false, headCells: ['', '', '', DR.headers.ses, DR.headers.laps] });
const FULL_DR = { cols: 92 }, COMPACT_DR = { cols: 30, rows: 3 };
const pickerPop = `<div class="pop"><pre> ${span('cur', padR(' kuh', 9))}\n  lin\n  ${span('d', DR.picker.new)}\n  ${span('d', DR.picker.none)}</pre></div>`;
const newPerson = panel(DR.title, { cols: 40, lines: [` ${span('f', '#63')} Mercedes ${TEXT.arrow} ${span('fld on', padR(' kai', 12))}`, ` ${span('f', ['Enter saves', 'Esc cancels'].join(' · '))}`] });

page('drivers-panel.html', 'SP4.3b2 · drivers-panel (new, garage), round 1', `
<div class="note">Sample: the garage before the Spa race (08 Nov). Two seats, Mercedes #12 and #63, each linked to a person by the picker (<code>drivers.link</code>; a person from the list, <b>new</b>, or <b>none</b> to remove the link). Per person: the profile entries with the laps and sessions they rest on and the newest session's day; an override field per entry (<code>drivers.override</code>; a filled one makes the value faint, a rejected one keeps the draft with the bridge's reason in amber); the linked sessions with an exclude toggle each (<code>drivers.exclude</code>; the Zandvoort race, a guest in #12, excluded). Below, read-only: the lobby settings the model uses and the feed's effective config, the values <code>config.json</code> set with <b>ʲ</b> and in the text role, the rest dim. An edit takes effect at the next session start (C62c).</div>
<h2>Full ${FULL_DR.cols}×${driversFull().length}</h2>
<div class="row">${fig(panel(DR.title, { ...FULL_DR, lines: driversFull(), size: 'full' }), 'kuh: σ lap overridden (0.380); lin: wear S unknown (no soft laps, … with the reason on hover), a rejected mistake/lap override · config: undercutRangeMs and drsRangeMs set in config.json')}</div>
<h2>The person picker, a new person</h2>
<div class="row">${fig(pickerPop, 'the picker open: the persons, then new and none')}${fig(newPerson, 'new: a name field in the picker\'s place, the calibration panel\'s keys')}</div>
<h2>Compact ${COMPACT_DR.cols}×${COMPACT_DR.rows}</h2>
<div class="row">${fig(panel(DR.title, { ...COMPACT_DR, lines: driversCompact(), size: 'compact' }), 'compact · the seats, their persons, kept sessions and laps')}${fig(panel(DR.title, { ...COMPACT_DR, lines: driversCompact(false) }), 'compact · #63 without a link')}</div>`);

// ================================================================ 6. calibration-panel (change): preferred per set
// The set line gains the prefer toggle after the picker: ★ (text role) on the track's preferred set, ☆ (dim, a button) on
// any other; the open picker marks the preferred set. The rest of the panel is unchanged (the approved 4.1a mockup).
const CB = TEXT.calibration;
const SETS = [{ name: 'league', preferred: true, dates: 'created 28 Sep · last used 15 Oct · 4 sources, 1 missing' }, { name: 'after-floor-upgrade', preferred: false, dates: 'created 06 Nov · 2 sources' }, { name: 'pre-season', preferred: false, dates: 'created 02 Sep · last used 02 Sep · 1 source' }];
const CB_COLS = 76;
function setLine(set, { active = true, full = true } = {}) {
  // the real set line (CalibrationPanel.svelte): picker, the state two cells on, the actions two cells on, one apart
  const star = set.preferred ? span('', CB.preferred, CB.preferredHover) : span('btn', CB.notPreferred, CB.preferHover);
  const cut = (t, w) => ([...t].length > w ? [...t].slice(0, w - 1).join('') + '…' : t);
  if (!full) return ` ${span('fld', padR(` ${cut(set.name, 17)} ▾`, 20))} ${star}  ${active ? 'active' : span('f', 'not used')}`;
  const actions = CB.actions.map((a) => span('btn', a)).join(' ');
  return ` ${span('f', CB.setLabel)} ${span('fld', padR(` ${set.name} ▾`, 22))} ${star}  ${active ? CB.activeInRace : span('f', 'not used in this race')}  ${actions}`;
}
const cbFull = (set, o) => panel(CB.title, { cols: CB_COLS, state: 'Spa', lines: [setLine(set, o), ` ${span('f', set.dates)}`, '', span('f', ' ⋮')] });
const cbCompact = (set, o) => panel(CB.title, { cols: 36, state: 'Spa', lines: [setLine(set, { ...o, full: false }), span('f', ' ⋮')] });
const cbList = `<div class="pop"><pre>${SETS.map((s, i) => (i === 1 ? span('cur', padR(` ${s.name}`, 22)) : padR(` ${s.name}`, 22)) + ' ' + (s.preferred ? CB.preferred : ' ')).join('\n')}</pre></div>`;

page('calibration-panel.html', 'SP4.3b2 · calibration-panel (change): the preferred set, round 1', `
<div class="note">The approved 4.1a panel with one change on its set line: after the picker, <b>★</b> marks the set preferred for this track (the preselection at session start, 4.1a's newest-used rule only when no set is preferred); on any other set <b>☆</b> is a quiet button that makes it the preferred one (<code>calibration.prefer { trackId, setId }</code>); a click on ★ clears it (<code>setId: null</code>). The open picker marks the preferred set. The rest of the panel is unchanged (⋮). The session-start prompt goes; <code>calibration.pick</code> opens this panel in the garage.</div>
<h2>Full ${CB_COLS} wide (the set line and its dates)</h2>
<div class="row">${fig(cbFull(SETS[0]), 'league: preferred and active in this race')}</div>
<div class="row" style="margin-top:12px">${fig(cbFull(SETS[1], { active: false }), 'after-floor-upgrade picked: not preferred, ☆ makes it so')}${fig(cbList, 'the picker open: ★ after the preferred set')}</div>
<h2>Compact 36 wide</h2>
<div class="row">${fig(cbCompact(SETS[0]), 'compact · ★ after the picker')}${fig(cbCompact(SETS[1], { active: false }), 'compact · another set: ☆')}</div>`);

// ================================================================ 1b. strategy-table, variant B (round 2): one shared chart
// Every policy's finishing-place distribution as one line on one chart (P1 … P20 on x, chance on y). No highlight: every
// line textDim. A click on a line or a list row highlights it: its line in the highlight role (ownCar, the own-car width,
// dots on its points, a tick at its E[pos]), the others textFaint, the rest of its tie group textDim; its info rows show
// below the chart. The committed line is always white at the normal width (Q10 B); highlighted, it is thick with dots like
// any other. Our place now: a faint vertical line.
const CH = DEFAULT_THEME.chart;
const TRG_PARTS = (sc) => [['SC/VSC', sc], ['DMG', '+1.2 s/lap'], ['DEG', '+30%']];
function prepRows({ committed, openTie = false, n = 8 }) {
  let rows = ranked(openTie ? CANDIDATES.map((c, i) => (i === 1 ? { ...c, mu: 7.43 } : i === 2 ? { ...c, mu: 7.56 } : c)).map((c) => { const p = placeDist(c.mu, c.sdL, c.sdR); return { ...c, p, ePos: ePos(p), ePts: ePts(p) }; }) : CANDIDATES);
  if (openTie) rows = rows.map((r, i) => ({ ...r, tie: i < 2, rank: i < 2 ? 1 : i + 1 }));
  if (committed !== undefined) rows = rows.map((r) => (stopsText(r.stops) === committed ? { ...r, committed: true } : r));
  return rows.slice(0, n);
}
function chartSvgB(rows, { cols, rowsH, hi, openTie }) {
  const W = cols * CELL_W, H = rowsH * CELL_H;
  const m = { l: 4 * CELL_W, r: 2 * CELL_W, t: CELL_H / 2, b: CELL_H };
  const yMax = Math.ceil(Math.max(...rows.flatMap((r) => r.p)) * 20) / 20; // to the next 5 %
  const X = (place) => m.l + ((W - m.l - m.r) * (place - 1)) / (PLACES - 1);
  const Y = (v) => H - m.b - ((H - m.t - m.b) * v) / yMax;
  let s = `<svg class="chart" width="${W}" height="${H}">`;
  for (let v = 0; v <= yMax + 1e-9; v += 0.1) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="${R.grid}"/><text x="${m.l - 6}" y="${Y(v) + 4}" fill="${R.textDim}" text-anchor="end">${FMT.pct(v)}</text>`;
  for (const pl of [1, 5, 10, 15, 20]) s += `<text x="${X(pl)}" y="${H - 4}" fill="${R.textDim}" text-anchor="middle">${FMT.position(pl)}</text>`;
  s += `<line x1="${X(OUR_PLACE)}" x2="${X(OUR_PLACE)}" y1="${m.t}" y2="${H - m.b}" stroke="${R.textFaint}"/>`;
  const hiRow = hi === undefined ? undefined : rows[hi];
  const cmt = rows.findIndex((r) => r.committed);
  const order = rows.map((_, i) => i).filter((i) => i !== hi && i !== cmt).concat(cmt >= 0 && cmt !== hi ? [cmt] : [], hi === undefined ? [] : [hi]); // the highlighted line last, on top
  for (const i of order) {
    const r = rows[i];
    const pts = r.p.map((v, k) => `${X(k + 1).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
    const cls = ['ln', r.tie ? 'tie' : '', r.committed ? 'cmt' : '', i === hi ? 'on' : ''].filter(Boolean).join(' ');
    s += `<g data-i="${i}" class="${cls}"><title>${esc(`${r.rank} · ${stopsText(r.stops)}`)}</title><polyline class="v" points="${pts}"/>`;
    s += r.p.map((v, k) => `<circle class="dot" cx="${X(k + 1).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="${CH.markRadius}"/>`).join('');
    s += `<line class="epos" x1="${X(r.ePos)}" x2="${X(r.ePos)}" y1="${H - m.b - 5}" y2="${H - m.b + 3}"/>`;
    s += `<polyline points="${pts}" style="fill:none;stroke:transparent;stroke-width:10;cursor:pointer" pointer-events="stroke"/></g>`;
  }
  return s + '</svg>';
}
/** The list beside the chart: bracket, rank, source, stops, E[pos]; each row a click target. */
const listSpecB = [{ h: '', w: 1 }, { h: ST.headers.rank, w: 2, a: 'r' }, { h: ST.headers.src, w: 4 }, { h: ST.headers.stops, w: 11 }, { h: ST.headers.ePos, w: 6, a: 'r' }];
function listLinesB(rows, { hi, openTie }) {
  const lines = table(listSpecB, rows.map((r, i) => ({ cells: [bracketOf(rows, i, openTie), String(r.rank), C(ST.source[r.committed ? 'committed' : r.src], r.committed ? '' : 'd'), stopsText(r.stops), FMT.expectedPlace(r.ePos)] })), { band: false });
  return [lines[0], ...lines.slice(1).map((l, i) => `<span data-i="${i}" class="lrow${rows[i].committed ? ' cmtrow' : ''}${i === hi ? ' on' : ''}">${l}</span>`)];
}
/** The info rows of one policy: rank, source, stops, triggers count, E[pos], E[points], Δ, the button; then its triggers. */
const infoSpecB = [{ h: ST.headers.rank, w: 2, a: 'r' }, { h: ST.headers.src, w: 4 }, { h: ST.headers.stops, w: 17 }, { h: ST.headers.trg, w: 3, a: 'r' }, { h: ST.headers.ePos, w: 6, a: 'r' }, { h: ST.headers.ePts, w: 6, a: 'r' }, { h: ST.headers.dLead, w: 6, a: 'r' }, { h: '', w: 6 }];
function infoLinesB(rows, i, committedRef) {
  const head = [...infoSpecB.slice(0, 6).map((c) => c.h), committedRef ? ST.headers.dPlan : ST.headers.dLead, ''];
  if (i === undefined) return [table(infoSpecB, [], { headCells: head })[0], ''];
  const r = rows[i];
  const refMs = committedRef ? rows.find((x) => x.committed).timeMs : rows[0].timeMs;
  const isRef = r.committed || (!committedRef && i === 0);
  const src = r.committed ? 'committed' : r.src;
  const cells = [String(r.rank), C(ST.source[src], '', src === 'rule' ? ST.sourceHover.rule(r.rule) : ST.sourceHover[src]), stopsText(r.stops), FMT.count(r.trg), FMT.expectedPlace(r.ePos), FMT.points(r.ePts), isRef ? '' : FMT.signedSeconds(r.timeMs - refMs, 1), r.committed ? C(ST.clear, 'btn', ST.clearHover) : C(ST.commit, 'btn', ST.commitHover)];
  const t = table(infoSpecB, [{ cls: r.committed ? 'me' : 'hi', cells }], { headCells: head });
  const trg = ' ' + TRG_PARTS(r.sc).map(([k, v]) => `${span('f', k)} ${v}`).join('  ');
  return [t[0], t[1], trg];
}
const FULL_B = { cols: 88, chartCols: 57, chartRows: 9 }, COMPACT_B = { cols: 46, chartRows: 5 };
const panelsB = [];
function stratB({ full = true, hi, committed, openTie = false, scenarios = 2840, size, link = '1 · KUH' }) {
  const rows = prepRows({ committed, openTie, n: full ? 8 : 5 });
  const id = `sb${panelsB.length}`;
  const cols = full ? FULL_B.cols : COMPACT_B.cols;
  const chart = chartSvgB(rows, { cols: full ? FULL_B.chartCols : cols + 2, rowsH: full ? FULL_B.chartRows : COMPACT_B.chartRows, hi, openTie });
  const committedRef = committed !== undefined;
  // every policy's info rows are in the page, one shown (the JS swaps them); the static state is drawn as rendered
  const infos = rows.map((_, i) => {
    const ls = full ? infoLinesB(rows, i, committedRef).slice(1) : [compactInfoB(rows[i])];
    for (const l of ls) if (vis(l) > cols) throw new Error(`strategy B: info wider than ${cols}: ${strip(l)}`);
    return `<pre class="info" data-for="${i}"${i === hi ? '' : ' hidden'}>${ls.join('\n')}</pre>`;
  }).join('');
  const none = `<pre class="info" data-for=""${hi === undefined ? '' : ' hidden'}>${full ? '\n' : ''}</pre>`;
  const tg = hi !== undefined && rows[hi].tie ? ' tg' : '';
  let body;
  if (full) {
    const list = listLinesB(rows, { hi, openTie });
    for (const l of list) if (vis(l) + FULL_B.chartCols > cols + 2) throw new Error('strategy B: list too wide');
    const head = infoLinesB(rows, undefined, committedRef)[0];
    const nCell = scenarios >= 5000 ? span('w', FMT.count(scenarios), ST.capHover(5000)) : FMT.count(scenarios);
    body = `<div style="display:flex">${chart}<pre class="list">${list.join('\n')}</pre></div><pre>${head}</pre>${none}${infos}<pre> ${span('f', ST.meta.n)} ${nCell}  ${span('f', ST.meta.cand)} ${FMT.count(14)}</pre>`;
  } else body = `${chart}${none}${infos}`;
  const rowsTotal = full ? FULL_B.chartRows + 4 : COMPACT_B.chartRows + 1;
  if (size) SIZES.push(`Strategy B ${size}: ${cols}×${rowsTotal}`);
  panelsB.push(id);
  return `<div class="panel sb${hi === undefined ? '' : ' has'}${tg}" data-h="${hi ?? ''}" style="width:${cols + 2}ch"><div class="ph"><span class="t">${ST.title}</span><span class="lk">${link}</span><span class="sp"></span><span>${FMT.lapNumber(NOW)}</span><span>${GEAR}</span></div>${body}</div>`;
}
const compactInfoB = (r) => ` ${r.rank} ${padR(stopsText(r.stops), 11)} ${span('hi', FMT.expectedPlace(r.ePos))} ${FMT.points(r.ePts)}`;
const CSS_B = `
.sb svg.chart text { font-family:var(--pw-font); font-size:${FONT_PX}px; }
.sb .ln .v { fill:none; stroke:var(--pw-textDim); stroke-width:${CH.lineWidth}; stroke-linejoin:round; }
.sb .ln.cmt .v, .sb.has .ln.cmt .v, .sb.has.tg .ln.tie.cmt .v { stroke:var(--pw-ownCar); }
.sb .ln .dot, .sb .ln .epos { display:none; }
.sb.has .ln .v { stroke:var(--pw-textFaint); }
.sb.has.tg .ln.tie .v { stroke:var(--pw-textDim); }
.sb.has .ln.on .v, .sb.has.tg .ln.tie.on .v { stroke:var(--pw-ownCar); stroke-width:${CH.ownCarLineWidth}; }
.sb .ln.on .dot { display:inline; fill:var(--pw-ownCar); }
.sb .ln.on .epos { display:inline; stroke:var(--pw-ownCar); stroke-width:2; }
.sb .lrow { cursor:pointer; }
.sb .lrow.on { color:var(--pw-ownCar); font-weight:${BOLD}; background:var(--pw-bgBand); }
.sb .lrow.cmtrow { box-shadow:inset ${DEFAULT_THEME.table.barPx}px 0 0 var(--pw-text); }
.sb pre.list { padding-left:0; }
`;
const JS_B = `<script>
for (const p of document.querySelectorAll('.sb')) p.addEventListener('click', (e) => {
  const t = e.target.closest('[data-i]'); if (!t) return;
  const i = p.dataset.h === t.dataset.i ? '' : t.dataset.i;
  p.dataset.h = i; p.classList.toggle('has', i !== '');
  for (const n of p.querySelectorAll('[data-i]')) n.classList.toggle('on', n.dataset.i === i);
  const on = p.querySelector('.ln.on'); p.classList.toggle('tg', !!on && on.classList.contains('tie'));
  for (const n of p.querySelectorAll('.info')) n.hidden = n.dataset.for !== i;
});
</script>`;
const pageB = (file, title, body) => writeFileSync(new URL(file, import.meta.url), `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>${CSS}${CSS_B}</style></head><body><h1>${title}</h1>${body}${JS_B}</body></html>\n`);
{
  const body = `
<div class="note">Variant B of the strategy table, chosen (Q9 B; variant A, <code>strategy-table.html</code>, rejected). Same sample, same rows. Every policy's finishing-place distribution is one line on one chart (P1 … P20, chance per place); the faint vertical line is our place now (P8). No highlight: every line grey. A click on a line or a list row highlights it: its line white and thick with its points, a white tick on the axis at its E[pos], the other lines faint (the rest of its tie group stays grey), and its info rows below the chart (rank, SRC, stops, TRG, E[POS], E[PTS], ΔTIME or ΔPLAN, commit or clear; then its triggers and thresholds). A second click clears it. The committed policy's line is always white at the normal width, its list row carries the bar; the highlighted line is white, thick and dotted, so the two stay apart (Q10 B). <b>The page is live: click the lines or rows of any panel.</b></div>
<h2>Full ${FULL_B.cols}×${FULL_B.chartRows + 4}</h2>
<div class="row">${fig(stratB({ size: 'full' }), 'no highlight · the three tied stop laps (bracket) lie on top of each other')}${fig(stratB({ hi: 0 }), 'L20 H highlighted (tied: L19 and L21 stay grey, the rest faint)')}</div>
<div class="row" style="margin-top:12px">${fig(stratB({ committed: 'L19 H' }), 'L19 H committed: its line white, its row with the bar; no highlight')}${fig(stratB({ committed: 'L19 H', hi: 6 }), 'committed, L14 H highlighted: the plan white and thin, L14 H white and thick; ΔPLAN against the plan, its commit button')}</div>
<div class="row" style="margin-top:12px">${fig(stratB({ openTie: true, scenarios: 5000, hi: 1 }), 'near-tie unresolved at the cap: the bracket and N amber; L19 H highlighted')}${fig(stratB({ committed: 'L19 H', hi: 1 }), 'the committed line highlighted: white, thick, dotted; its button clear')}</div>
<h2>Compact ${COMPACT_B.cols}×${COMPACT_B.chartRows + 1}</h2>
<div class="row">${fig(stratB({ full: false, size: 'compact' }), 'compact · the chart alone; a click on a line shows rank, stops, E[pos], E[points]')}${fig(stratB({ full: false, hi: 0 }), 'compact · L20 H highlighted')}${fig(stratB({ full: false, committed: 'L19 H', hi: 1 }), 'compact · committed and highlighted')}</div>`;
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>SP4.3b2 · strategy-table, variant B (one chart), round 3</title><style>${CSS}${CSS_B}</style></head><body><h1>SP4.3b2 · strategy-table, variant B (one chart), round 3</h1>${body}${JS_B}</body></html>\n`;
  writeFileSync(new URL('strategy-table-b.html', import.meta.url), html);
}

// ================================================================ 7. the strategy workbook
// Two link groups, one per driver, each with its feed and its car as primary; each holds strategy-table, undercut-card,
// pit-sweep-table and sc-card at their full sizes. The top bar gains the count of our feeds' human seats without a person.
const LIN = {
  rivals: [{ code: 'GAS', place: 10, gapS: 1.8, ahead: true, n: [0.6, 1.3, 1.9], rej: [15, 15, 15] }, { code: 'OCO', place: 12, gapS: 2.2, ahead: false, n: [-0.4, -0.9, -1.5], rej: [14, 14, 14] }],
};
const topbar = (unlinked) => `<div class="topbar"><div class="side"><span class="t">strategy</span><span>Spa race</span><span class="t">RACE</span><span class="t">${FMT.lapNumber(NOW)}/${FLAG}</span><span>0:31:12</span><span>green</span><span>moment —</span><span>${TEXT.topbar.calibration} <span class="t">league</span></span>${unlinked ? `<span title="${esc(TEXT.topbar.unlinkedHover)}">${TEXT.topbar.unlinked} <span class="t">${unlinked}</span></span>` : ''}</div><div class="side"><span>feed ok · 0.1 % loss</span><span>realism on</span></div></div>`;
const group = (link, o) => `<div class="group">${stratB({ full: true, link, ...o.strategy })}<div class="line">${panel(SW.title, { ...FULL_SW, link, state: FMT.lapNumber(NOW), lines: sweepLines({ full: true, ...(o.sweep ?? {}) }) })}<div class="group">${panel(UC.title, { ...FULL_UC, link, state: FMT.lapNumber(NOW), lines: o.uc })}${scPanel(o.sc ?? SC_GREEN, null, true, { link })}</div></div></div>`;
const linStrategy = { committed: 'L21 H' };
const workbook = `<div class="window">${topbar(1)}<div class="groups">${group('1 · KUH', { strategy: {}, uc: undercutLines(RIVALS, { full: true }) })}${group('2 · LIN', { strategy: linStrategy, uc: undercutLines(LIN.rivals, { full: true }).map((l) => l.replace('KUH', 'LIN').replace(FMT.position(OUR_PLACE), FMT.position(11))) })}</div></div>`;

pageB('strategy-workbook.html', 'SP4.3b2 · the strategy workbook, round 3', `
<div class="note">The <code>strategy</code> workbook: two link groups, <b>1 · KUH</b> (feed 20777, car #12) and <b>2 · LIN</b> (feed 20778, car #63), each the car's strategy-table (variant B, Q9 B; live: click a line or row), pit-sweep-table, undercut-card and sc-card at their full sizes, each from its own feed. LIN's chart shows its committed L21 H as a white line (a plan reaches both feeds). The panels' numbers in group 2 are the sample's, relabelled. Top bar: <b>unlinked 1</b> after the calibration segment, a human seat of our feeds without a person (here #63, not linked yet); a click opens the drivers panel in the garage; no segment at 0.</div>
${workbook}
${cap('each group about 105 cells wide: both fit a 1920 px window at the default font')}
<h2>The top bar, both forms</h2>
${topbar(1)}${cap('one seat unlinked')}<div style="height:10px"></div>${topbar(0)}${cap('every seat linked: no segment')}`);

console.log(SIZES.join('\n'));
console.log('written');
