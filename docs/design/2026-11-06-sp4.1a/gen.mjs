// Generates the SP4.1a mockups (plan Task 0): node gen.mjs
// Same method as the 2026-10-30 set: every display is laid out in character cells, with the real theme (imported from
// apps/ui/src/theme) and the SP3 panel frame B. Presentation lives in one place each: THEME (roles, font, density),
// FMT (formats, mirroring kit/values/format.ts), TEXT (wording), SOURCE (the source badge).
// The generator throws when a line is wider than its panel or a cell wider than its column, so a misfit cannot ship.
import { writeFileSync } from 'node:fs';
import { DEFAULT_THEME, FONT_FAMILY } from '../../../apps/ui/src/theme/themes.ts';

// ---------------------------------------------------------------- theme (the real one)
const R = DEFAULT_THEME.roles;
const FONT_PX = DEFAULT_THEME.fontPx;
const LINE = DEFAULT_THEME.density.lineHeight;
const GAP = DEFAULT_THEME.density.columnGapCols;
const CELL_W = (800 / 100 / 14) * FONT_PX; // JetBrains Mono's advance, measured in headless Chromium
const CELL_H = FONT_PX * LINE;
const CHART = DEFAULT_THEME.chart;

// ---------------------------------------------------------------- formats (mirror kit/values/format.ts)
const MINUS = '−';
const fixed = (v, d) => {
  const t = v.toFixed(d);
  if (/^-0(\.0*)?$/.test(t)) return t.slice(1);
  return t.startsWith('-') ? MINUS + t.slice(1) : t;
};
const pad0 = (n, w) => String(n).padStart(w, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FMT = {
  lapTime: (ms) => { const t = Math.round(ms); return `${Math.floor(t / 60000)}:${pad0(Math.floor((t % 60000) / 1000), 2)}.${pad0(t % 1000, 3)}`; },
  lapTimeTenths: (ms) => { const t = Math.round(ms / 100); return `${Math.floor(t / 600)}:${pad0(Math.floor((t % 600) / 10), 2)}.${t % 10}`; },
  seconds: (ms, d) => fixed(ms / 1000, d),
  signedSeconds: (ms, d) => { const t = fixed(Math.abs(ms) / 1000, d); return `${ms < 0 && Number(t) !== 0 ? MINUS : '+'}${t}`; },
  lapNumber: (n, w = 2) => `L${String(n).padStart(w, '0')}`,
  lapRange: (a, b) => `L${pad0(a, 2)}–${pad0(b, 2)}`,
  pct: (p) => `${fixed(p, 0)}%`,
  wear: (p) => fixed(p, 1),
  /** proposed kit format: residual in standard deviations, `0.4` -> `+0.4σ` */
  sigma: (s) => `${s < 0 ? MINUS : '+'}${fixed(Math.abs(s), 1)}σ`,
  /** proposed kit format: a calendar day, `2026-10-15` -> `15 Oct` (only for createdAt / lastUsedAt / a session's date: never a race-clock time) */
  day: (iso) => { const [, m, d] = iso.split('-'); return `${d} ${MONTHS[Number(m) - 1]}`; },
};

// ---------------------------------------------------------------- wording (kit/text.ts and the calibration panel's text.ts)
const TEXT = {
  unknown: { insufficientData: 'too few laps or samples yet', noSource: 'no source in this set covers it: the track file default is used' },
  condition: { green: 'green', vsc: 'VSC', sc: 'SC' },
  session: { race: 'race', fp1: 'FP1', fp2: 'FP2', quali: 'quali' },
  lapNote: { lap1: 'lap 1', vsc: 'VSC', in: 'in', out: 'out' },
  missing: 'missing',
  missingHover: 'this stint is no longer in its session (session rebuilt or deleted): left out of every value',
  actions: ['new', 'copy', 'rename', 'delete'],
  add: 'add',
  remove: '×',
  defaults: 'defaults',
};

// ---------------------------------------------------------------- the source badge (kit piece, spec 4.4; replaces ˢ, A27)
// No mark = this session's share of the blend is above half. ᶜ = calibration (hover: the set's name and its sources). ᵈ = default
// (hover: the track file's source note). Every badged value carries its hover with its parts, session values too.
const SOURCE = { session: ' ', calibration: 'ᶜ', default: 'ᵈ' };
const SOURCE_WORD = { session: 'session', calibration: 'calibration', default: 'default' };
const badge = (kind) => (kind === 'session' ? ' ' : `<span class="d">${SOURCE[kind]}</span>`);

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
.ph .t { color:var(--pw-textDim); overflow:hidden; text-overflow:ellipsis; min-width:0; } .ph > span { flex-shrink:0; } .ph > .t { flex-shrink:1; } .ph .sp { flex:1; } .ph .lk { color:var(--pw-text); }
pre { font-family:inherit; font-size:inherit; line-height:inherit; padding:0 1ch; white-space:pre; }
svg { display:block; }
svg text { font-family:var(--pw-font); font-size:${FONT_PX}px; }
.cap { color:var(--pw-textFaint); margin:4px 0 0; min-width:44ch; }
.d { color:var(--pw-textDim); } .f { color:var(--pw-textFaint); } .w { color:var(--pw-warning); } .c { color:var(--pw-critical); }
.o, .hi { color:var(--pw-ownCar); font-weight:${DEFAULT_THEME.table.boldWeight}; } .m { font-weight:${DEFAULT_THEME.table.boldWeight}; }
.band { background:var(--pw-bgRowBand); display:inline-block; width:100%; }
.me { color:var(--pw-ownCar); font-weight:700; box-shadow:inset ${DEFAULT_THEME.table.barPx}px 0 0 var(--pw-text); display:inline-block; width:100%; }
.tip { text-decoration:underline dotted var(--pw-textFaint); }
.tooltip { display:inline-block; border:1px solid var(--pw-border); background:var(--pw-bgBand); color:var(--pw-text); padding:0 1ch; margin-left:2ch; }
/* a control: a number field or a select, drawn like .pw-input (a 1 px border-role frame, no fill); a button: a quiet word */
.fld { box-shadow:inset 0 0 0 ${DEFAULT_THEME.table.borderPx}px var(--pw-border); color:var(--pw-text); }
.fld.on { box-shadow:inset 0 0 0 ${DEFAULT_THEME.table.borderPx}px var(--pw-focus); }
.btn { color:var(--pw-textDim); }
.cur { background:var(--pw-bgBand); color:var(--pw-text); display:inline-block; width:100%; }
.topbar { display:flex; justify-content:space-between; gap:2ch; padding:0 1ch; border:1px solid var(--pw-border); color:var(--pw-textDim); white-space:nowrap; width:150ch; }
.topbar .side { display:flex; gap:2ch; } .topbar .t { color:var(--pw-text); }
.seg { box-shadow:inset 0 -1px 0 var(--pw-textFaint); }
.window { position:relative; width:150ch; height:${CELL_H * 16}px; outline:1px dashed var(--pw-border); background:var(--pw-bg); }
.window .layout { position:absolute; inset:${CELL_H + 8}px 8px 8px 8px; display:grid; grid-template-columns:1fr 1fr; gap:8px; opacity:0.35; }
.window .layout > div { background:var(--pw-bgPanel); outline:1px dashed var(--pw-border); color:var(--pw-textFaint); padding:0 1ch; }
.window .overlay { position:absolute; left:50%; top:${CELL_H * 3}px; transform:translateX(-50%); border:1px solid var(--pw-border); background:var(--pw-bgPanel); }
.window .overlay .bandT { background:var(--pw-bgBand); color:var(--pw-textDim); padding:0 1ch; white-space:nowrap; }
`;

// ---------------------------------------------------------------- HTML helpers
const strip = (s) => s.replace(/<[^>]+>/g, '');
const vis = (s) => [...strip(s)].length;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const span = (cls, t, tip) => `<span${cls ? ` class="${cls}"` : ''}${tip ? ` title="${esc(tip)}"` : ''}>${t}</span>`;
const sp = (n) => ' '.repeat(Math.max(0, n));
const padR = (s, n) => s + sp(n - vis(s));
const padL = (s, n) => sp(n - vis(s)) + s;
const C = (t, c, tip) => ({ t, c, tip });
/** An unknown value: an empty cell, its reason on hover (dotted underline). */
const U = (reason) => ({ t: '', c: 'tip', tip: TEXT.unknown[reason] });
/** A badged value: the number, then its one-cell badge; the hover names the source and its parts. */
const V = (text, kind, tip, c) => ({ t: text + badge(kind), c, tip });
/** A number field (a control): its width is the column's; empty or holding the typed value. */
const F = (value = '', focused = false) => ({ t: value, c: focused ? 'fld on' : 'fld' });

const GEAR = '<svg width="14" height="14" viewBox="0 0 14 14" style="display:inline;vertical-align:-2px"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="1.1" stroke-dasharray="2 1.4"/><circle cx="7" cy="7" r="2.1" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>';

/**
 * Character-cell table. spec = [{ h, w, a: 'l'|'r' }]; rows = [{ cls?, band?, cells: [string | { t, c, tip }] }].
 * Columns are GAP cells apart, one lead cell; odd body rows are banded like kit Table.
 */
function table(spec, rows, { head = true, band = true, lead = 1 } = {}) {
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
  if (head) out.push(span('f', sp(lead) + spec.map((c, i) => fit(c.h, i)).join(sp(GAP))));
  let k = 0;
  for (const r of rows) {
    if (r.raw !== undefined) { out.push(r.raw); continue; }
    const line = sp(lead) + r.cells.map(cell).join(sp(GAP));
    const banded = r.band ?? (band && k % 2 === 1);
    const cls = [banded ? 'band' : '', r.cls ?? ''].filter(Boolean).join(' ');
    out.push(cls ? span(cls, line) : line);
    k++;
  }
  return out;
}

/** Panel frame B: header band (title, link marker, state, gear), then the body in character cells. */
const SIZES = [];
function panel(title, { cols, rows, link = '', state = '', lines = [], svg = '', svgRows = 0, after = [], size }) {
  const all = [...lines, ...after];
  for (const l of all) if (vis(l) > cols) throw new Error(`${title}: line wider than ${cols}: "${strip(l)}" (${vis(l)})`);
  const used = lines.length + svgRows + after.length;
  if (rows !== undefined && used > rows) throw new Error(`${title}: ${used} rows, more than ${rows}`);
  if (size) SIZES.push(`${title} ${size}: ${cols}×${rows ?? used}`);
  const pre = (ls) => (ls.length ? `<pre>${ls.join('\n')}</pre>` : '');
  const fill = rows !== undefined ? rows - used : 0;
  return `<div class="panel" style="width:${cols + 2}ch"><div class="ph"><span class="t">${title}</span><span class="lk">${link}</span><span class="sp"></span><span class="age">${state}</span><span>${GEAR}</span></div>${pre(lines)}${svg}${pre(after)}${fill > 0 ? `<div style="height:${fill * CELL_H}px"></div>` : ''}</div>`;
}
const cap = (t) => `<div class="cap">${t}</div>`;
const fig = (p, c) => `<div>${p}${cap(c)}</div>`;
const page = (file, title, body) =>
  writeFileSync(new URL(file, import.meta.url), `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>${CSS}</style></head><body><h1>${title}</h1>${body}</body></html>\n`);

// ---------------------------------------------------------------- charts (kit Chart look: textDim axes in the theme font, grid role)
function chart({ cols, rows, x, y, series = [], over = () => '', margin = {} }) {
  const m = { l: 70, r: 70, t: 10, b: 40, ...margin };
  const W = (cols + 2) * CELL_W, H = rows * CELL_H;
  const X = (v) => m.l + ((W - m.l - m.r) * (v - x.min)) / (x.max - x.min);
  const Y = (v) => H - m.b - ((H - m.t - m.b) * (v - y.min)) / (y.max - y.min);
  let s = `<svg width="${W}" height="${H}">`;
  for (const v of y.ticks) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="${R.grid}"/><text x="${m.l - 6}" y="${Y(v) + 4}" fill="${R.textDim}" text-anchor="end">${y.fmt(v)}</text>`;
  for (const v of x.ticks) s += `<line y1="${m.t}" y2="${H - m.b}" x1="${X(v)}" x2="${X(v)}" stroke="${R.grid}"/><text x="${X(v)}" y="${H - m.b + 16}" fill="${R.textDim}" text-anchor="middle">${x.fmt(v)}</text>`;
  if (x.label) s += `<text x="${(m.l + W - m.r) / 2}" y="${H - 4}" fill="${R.textDim}" text-anchor="middle">${x.label}</text>`;
  if (y.label) s += `<text x="16" y="${(m.t + H - m.b) / 2}" fill="${R.textDim}" transform="rotate(-90 16 ${(m.t + H - m.b) / 2})" text-anchor="middle">${y.label}</text>`;
  for (const sr of series) {
    const pts = sr.pts.map(([a, b]) => `${X(a).toFixed(1)},${Y(b).toFixed(1)}`).join(' ');
    s += `<polyline points="${pts}" fill="none" stroke="${sr.colour}" stroke-width="${sr.width ?? CHART.lineWidth}" stroke-linejoin="round"/>`;
    if (sr.label) s += `<text x="${W - m.r + 6}" y="${Y(sr.pts.at(-1)[1]) + 4}" fill="${sr.colour}" ${sr.bold ? 'font-weight="700"' : ''}>${sr.label}</text>`;
  }
  s += over(X, Y, W, H, m);
  return s + '</svg>';
}
const noise = (k, a = 1) => a * (0.6 * Math.sin(k * 2.3) + 0.4 * Math.sin(k * 0.7 + 1));

// ================================================================ the sample: Silverstone (track 7), a league weekend on 06 Nov 2026
// Our cars KUH and LIN. Stored sessions: the league race on 15 Oct and its FP2 on 14 Oct, the pre-season test on 02 Sep, and
// this weekend's FP1 (06 Nov). The race is running now (L23/52), started on the preselection `league`.
const TRACK = 'Silverstone';
const SETS = [
  { id: 'league', name: 'league', createdAt: '2026-09-28', lastUsedAt: '2026-10-15', sources: 4, missing: 1 },
  { id: 'after-floor-upgrade', name: 'after-floor-upgrade', createdAt: '2026-11-06', sources: 2, missing: 0 },
  { id: 'pre-season', name: 'pre-season', createdAt: '2026-09-02', lastUsedAt: '2026-09-02', sources: 1, missing: 0 },
];
const PRESELECTED = 'league'; // the newest lastUsedAt (spec 3.3)

// calibration.values for `league`: per source its value (degradation's ν over that one stint), date and residual
const SOURCES = [
  { session: 'race', date: '2026-10-15', car: 'KUH', cmp: 'M', first: 1, last: 22, used: 17, deg: 54, drift: 0.4, expanded: true },
  { session: 'race', date: '2026-10-15', car: 'LIN', cmp: 'M', first: 1, last: 17, used: 15, deg: 47, drift: -0.6 },
  { session: 'fp2', date: '2026-10-14', car: 'KUH', cmp: 'M', first: 6, last: 17, used: 10, deg: 61, drift: 1.1 },
  { session: 'fp2', date: '2026-10-14', car: 'LIN', cmp: 'S', first: 3, last: 10, missing: true },
];
// the expanded source's laps (race 15 Oct, KUH, M, L01–22): raw lap time, not-pace reason, or excluded by the user
const LAPS = Array.from({ length: 22 }, (_, i) => {
  const lap = i + 1;
  const note = lap === 1 ? 'lap1' : lap === 9 || lap === 10 ? 'vsc' : lap === 22 ? 'in' : null;
  const ms = lap === 1 ? 97880 : note === 'vsc' ? 112400 + 300 * (lap - 9) : lap === 22 ? 98510 : lap === 14 ? 93120 : 91540 + noise(lap, 140);
  return { lap, ms, note, excluded: lap === 14 };
});
// calibration.candidates for Silverstone: this weekend first, then newest first
const SUGGESTIONS = [
  { session: 'fp1', date: '2026-11-06', car: 'KUH', cmp: 'M', first: 4, last: 15, used: 11, deg: 49 },
  { session: 'fp1', date: '2026-11-06', car: 'LIN', cmp: 'H', first: 3, last: 13, used: 9, deg: 36 },
];
// the set's values per compound (S: its only source is missing, H: no source, so both are the track file's defaults)
const DEFAULT_NOTE = 'default · Silverstone track file: community value (R3)';
const VALUES = [
  { cmp: 'S', kind: 'default', off: 0, deg: 60, sd: 60, wear: null, n: 0 },
  { cmp: 'M', kind: 'calibration', off: 405, deg: 52, sd: 6, wear: [2.4, 2.2, 1.9, 2.0], n: 3 },
  { cmp: 'H', kind: 'default', off: 772, deg: 60, sd: 60, wear: null, n: 0, override: { deg: '0.045' } },
];
const PIT_SET = [
  { c: 'green', kind: 'calibration', ms: 20400, stops: 6 },
  { c: 'vsc', kind: 'calibration', ms: 13400, stops: 1 },
  { c: 'sc', kind: 'default', ms: 9800, stops: 0 },
];

// ================================================================ page 1: the calibration panel
{
  const srcSpec = [
    { h: '', w: 1, a: 'l' }, { h: 'SESSION', w: 7, a: 'l' }, { h: 'DATE', w: 6, a: 'l' }, { h: 'CAR', w: 3, a: 'l' }, { h: 'CMP', w: 3, a: 'l' },
    { h: 'STINT', w: 6, a: 'l' }, { h: 'LAPS', w: 5, a: 'r' }, { h: 'DEG/LAP', w: 7, a: 'r' }, { h: 'DRIFT', w: 6, a: 'r' }, { h: '', w: 6, a: 'r' },
  ];
  const srcCells = (s, last) => [
    s.session === undefined ? '' : TEXT.session[s.session], FMT.day(s.date), s.car, s.cmp, FMT.lapRange(s.first, s.last),
  ].concat(last);
  // the expanded source's laps: three columns, column-major; a pace lap has its toggle ([x] used, [ ] excluded by the user)
  const lapCell = (l) => {
    const toggle = l.note ? '   ' : l.excluded ? '[ ]' : '[x]';
    const t = `${toggle} ${FMT.lapNumber(l.lap)} ${FMT.lapTime(l.ms)} ${padR(l.note ? TEXT.lapNote[l.note] : '', 5)}`;
    return l.note ? span('f', t, 'not a pace lap: never used') : l.excluded ? `[ ] ${span('f', `${FMT.lapNumber(l.lap)} ${FMT.lapTime(l.ms)}`, 'excluded by you')} ${sp(5)}` : t;
  };
  const lapGrid = (indent) => {
    const perCol = 8;
    const cols = [0, 1, 2].map((k) => LAPS.slice(k * perCol, (k + 1) * perCol));
    return Array.from({ length: perCol }, (_, r) => sp(indent) + cols.map((c) => (c[r] ? lapCell(c[r]) : sp(22))).join(sp(2)).trimEnd());
  };
  const sourceRows = () => {
    const out = [];
    SOURCES.forEach((s, i) => {
      const banded = i % 2 === 1;
      if (s.missing) {
        out.push({ band: banded, cells: [C('▸', 'f'), ...srcCells(s, []).map((t) => C(t, 'f')), C('', ''), C(TEXT.missing, 'w', TEXT.missingHover), C('', ''), C(TEXT.remove, 'btn')] });
        return;
      }
      out.push({ band: banded, cells: [C(s.expanded ? '▾' : '▸', 'd'), ...srcCells(s, []), C(`${s.used}/${s.last - s.first + 1}`, '', `${s.used} used of ${s.last - s.first + 1} laps`), FMT.signedSeconds(s.deg, 3), C(FMT.sigma(s.drift), '', 'this source minus the set, in sd of the set\'s value'), C(TEXT.remove, 'btn')] });
      if (s.expanded) for (const l of lapGrid(3)) out.push({ raw: l });
    });
    return out;
  };
  const sugSpec = srcSpec.slice(0, 8).concat([{ h: '', w: 6, a: 'r' }, { h: '', w: 6, a: 'r' }]);
  const sugRows = SUGGESTIONS.map((s, i) => ({ band: i % 2 === 1, cells: [C('▸', 'd'), ...srcCells(s, []), `${s.used}/${s.last - s.first + 1}`, FMT.signedSeconds(s.deg, 3), '', C(TEXT.add, 'btn')] }));

  const valSpec = [
    { h: 'CMP', w: 3, a: 'l' }, { h: 'TO SOFT', w: 7, a: 'r' }, { h: 'DEG/LAP', w: 7, a: 'r' }, { h: 'SD', w: 6, a: 'r' },
    { h: 'FL', w: 4, a: 'r' }, { h: 'FR', w: 4, a: 'r' }, { h: 'RL', w: 4, a: 'r' }, { h: 'RR', w: 4, a: 'r' }, { h: 'N', w: 2, a: 'r' },
  ];
  const valRows = (filled = true) => VALUES.flatMap((v, i) => {
    const ovr = filled ? v.override ?? {} : {};
    const dflt = v.kind === 'default';
    const tip = dflt ? DEFAULT_NOTE : `league · ${v.n} sources`;
    const val = (txt, key) => (ovr[key] ? C(strip(txt) + ' ', 'f', `replaced by your override ${ovr[key]}`) : dflt ? V(txt, 'default', tip, 'd') : C(txt + ' ', '', tip));
    const wear = v.wear ? v.wear.map((w) => C(FMT.wear(w))) : [0, 1, 2, 3].map(() => U('noSource'));
    return [
      { band: i % 2 === 1, cells: [C(v.cmp, dflt ? 'd' : ''), val(FMT.signedSeconds(v.off, 3), 'off'), val(FMT.signedSeconds(v.deg, 3), 'deg'), val(FMT.seconds(v.sd, 3), 'sd'), ...wear, C(String(v.n), dflt ? 'd' : '')] },
      { band: i % 2 === 1, cells: [C('ovr', 'f'), F(ovr.off), F(ovr.deg), F(ovr.sd), F(), F(), F(), F(), ''] },
    ];
  });
  const limits = ` ${span('f', 'LIMITS')}  wear limit ${span('', '70%', 'tyre-life config default')} ${span('fld', sp(5))}   age loss limit ${span('', '2.000 s', 'tyre-life config default')} ${span('fld', sp(6))}`;
  const pitSpec = [{ h: 'COND', w: 5, a: 'l' }, { h: 'SET', w: 6, a: 'r' }, { h: 'STOPS', w: 5, a: 'r' }, { h: 'OVR', w: 6, a: 'l' }];
  const pitRows = PIT_SET.map((p, i) => {
    const dflt = p.kind === 'default';
    const tip = dflt ? DEFAULT_NOTE : `league · ${p.stops} ${p.stops === 1 ? 'stop' : 'stops'} (race 15 Oct)`;
    return { band: i % 2 === 1, cells: [C(TEXT.condition[p.c], dflt ? 'd' : ''), dflt ? V(FMT.seconds(p.ms, 1), 'default', tip, 'd') : C(FMT.seconds(p.ms, 1) + ' ', '', tip), C(String(p.stops), dflt ? 'd' : ''), F()] };
  });

  const COLS = 76;
  const title = (t, rest = '') => ` ${span('f', t)}${rest ? ' ' + span('f', rest) : ''}`;
  const setLine = (active = true) => {
    const left = ` set ${span('fld', padR(' league ▾', 22))}  ${active ? span('', 'active in this race', 'calibration.active: preselection at session start') : span('f', 'no session')}`;
    const right = TEXT.actions.map((a) => span('btn', a)).join('  ') + ' ';
    return left + sp(COLS - vis(left) - vis(right)) + right;
  };
  const meta = ` ${span('f', `created ${FMT.day('2026-09-28')} · last used ${FMT.day('2026-10-15')} · 4 sources, 1 missing`)}`;
  const fullLines = (active = true) => [
    setLine(active), meta, '',
    title('SOURCES', '· one stint each; ▸ opens its laps'), ...table(srcSpec, sourceRows(), { band: false }), '',
    title('SUGGESTIONS', '· our stints on this track not in the set, this weekend first'), ...table(sugSpec, sugRows, { head: false, band: false }), '',
    title('VALUES PER COMPOUND', '· deg s/lap, wear %/lap; ovr = your override'), ...table(valSpec, valRows(), { band: false }), limits, '',
    title('PIT LOSS PER CONDITION', '· s'), ...table(pitSpec, pitRows, { band: false }),
  ];
  const full = panel('Calibration', { cols: COLS, state: TRACK, lines: fullLines(), size: 'full' });

  // compact: the set, its sources one line each (drift), the effective values; no laps, suggestions, fields or actions
  const compactLines = (active = true) => {
    const first = ` ${span('fld', padR(' league ▾', 22))}`;
    const st = active ? 'active' : span('f', 'no session');
    const out = [first + sp(36 - vis(first) - vis(st) - 1) + st + ' '];
    for (const s of SOURCES) {
      const head = `${padR(TEXT.session[s.session], 4)} ${FMT.day(s.date)} ${s.car} ${s.cmp}`;
      out.push(s.missing ? ` ${span('f', head)}  ${span('w', TEXT.missing, TEXT.missingHover)}` : ` ${head}  ${padL(FMT.signedSeconds(s.deg, 3), 6)} ${padL(FMT.sigma(s.drift), 5)}`);
    }
    const eff = (v) => (v.override?.deg ? `+${v.override.deg} ` : FMT.signedSeconds(v.deg, 3) + badge(v.kind === 'default' ? 'default' : 'session'));
    out.push(` ${span('f', 'deg')} ${VALUES.map((v) => `${v.cmp} ${eff(v)}`).join(' ')}`);
    out.push(` ${span('f', 'pit')} ${PIT_SET.map((p) => `${TEXT.condition[p.c]} ${FMT.seconds(p.ms, 1)}${badge(p.kind === 'default' ? 'default' : 'session')}`).join(' ')}`);
    return out;
  };
  const compact = panel('Calibration', { cols: 36, state: TRACK, lines: compactLines(), size: 'compact' });
  const compactNoSession = panel('Calibration', { cols: 36, state: TRACK, lines: compactLines(false) });

  // a rejected override (C73): the field keeps the draft, the bridge's reason below it
  const rejectSpec = valSpec.slice(0, 4);
  const rejected = panel('Calibration', { cols: 44, state: TRACK, lines: [
    span('f', ` ${rejectSpec.map((c, i) => (c.a === 'r' ? padL(c.h, c.w) : padR(c.h, c.w))).join(' ')}`),
    ` H    +0.772${badge('default')}  ${span('f', '+0.060 ')} 0.060${badge('default')}`,
    ` ${span('f', 'ovr')} ${span('fld', sp(7))} ${span('fld on', padL('3.5', 7))} ${span('fld', sp(6))}`,
    ` ${span('w', 'rejected: deg/lap must be 0.000 to 0.300 s')}`,
  ] });

  page('calibration-panel.html', `Calibration panel (SP4.1a §6): full and compact`, `
<div class="note">Sample: ${TRACK}, a league weekend on <b>06 Nov</b>. The race runs now (L23/52) on the set <b>league</b> (the preselection). <code>league</code> has 4 sources: three medium stints of the league race (15 Oct) and its FP2 (14 Oct), and one soft stint whose session was rebuilt: <b>missing</b>. Its copy <code>after-floor-upgrade</code> holds this weekend's two FP1 stints. Values are <code>calibration.values</code>, suggestions <code>calibration.candidates</code>, the active set <code>calibration.active</code>; every control sends one <code>calibration.*</code> uiAction (C73, C74). Hover texts are named in the captions (a screenshot cannot hover).</div>
<h2>Full ${COLS}×${fullLines().length}</h2>
<div class="row">${fig(full, `full · the set picker (a select) with new, copy, rename, delete as quiet words · SOURCES: one row per stint; the first is opened to its laps in three columns: <code>[x]</code> used, <code>[ ]</code> excluded by you (L14, faint), no toggle on laps that are never pace laps (lap 1, VSC, in) · LAPS = used of the stint's laps · DEG/LAP = the source's own value, DRIFT = its residual against the set in sd (README Q1) · the missing source faint with <b>missing</b> in amber, still removable (Q4) · SUGGESTIONS: this weekend's FP1 stints with <b>add</b> · VALUES: per compound the set's value and below it its override fields; S (its only source missing) and H (no source) are the track file's defaults (ᵈ, dim); H's DEG/LAP override is filled (0.045), so the value above is faint: replaced (Q2, Q3) · wear cells of S and H empty with "no source in this set covers it" on hover · LIMITS: tyre-life's two per-set overrides · PIT LOSS: green and VSC from the league race's stops, SC default`)}</div>
<h2>Compact 36×${compactLines().length}</h2>
<div class="row">${fig(compact, 'compact · the set and whether it is active, each source on one line (its DEG/LAP and DRIFT, or missing), the effective deg per compound (H shows the override) and the three pit losses · drops the laps, suggestions, fields, actions, SD and wear')}${fig(compactNoSession, 'no session loaded: the panel works from storage, on the newest stored session\'s track; "no session" instead of "active"')}</div>
<h2>A rejected override (C73)</h2>
<div class="row">${fig(rejected, 'the bridge validates the value against the key\'s declared range and rejects it; the field keeps the draft (window-local), the reason below in amber; nothing is stored')}</div>`);
}

// ================================================================ page 2: the session-start prompt and the top-bar segment
{
  const OV = 70; // a new overlay width, OVERLAY_COLS.calibration
  const pSpec = [{ h: '', w: 19, a: 'l' }, { h: '', w: 10, a: 'l' }, { h: '', w: 10, a: 'l' }, { h: '', w: 12, a: 'l' }, { h: '', w: 11, a: 'l' }];
  const promptLines = (cursor) => {
    const rows = SETS.map((s) => ({
      cls: s.id === cursor ? 'cur' : '',
      cells: [
        C(s.name, s.id === cursor ? '' : 'd'),
        C(`${s.sources} ${s.sources === 1 ? 'source' : 'sources'}`, 'f'),
        s.missing ? C(`${s.missing} missing`, 'w', TEXT.missingHover) : '',
        C(s.lastUsedAt ? `used ${FMT.day(s.lastUsedAt)}` : `new ${FMT.day(s.createdAt)}`, 'f'),
        s.id === PRESELECTED ? C('preselected', 'f', 'the set used last on this track; Esc keeps it') : '',
      ],
    }));
    const t = table(pSpec, rows, { head: false, band: false });
    const dl = ` ${padR(TEXT.defaults, 19)} ${span('f', "the track file's values")}`;
    t.push(cursor === null ? span('cur', padR(dl, OV - 2)) : ` ${span('d', padR(TEXT.defaults, 19))} ${span('f', "the track file's values")}`);
    return [...t, '', span('f', ` ↑↓ move · Enter choose · Esc keeps ${PRESELECTED}`)];
  };
  const box = (cursor) => {
    const ls = promptLines(cursor);
    for (const l of ls) if (vis(l) > OV - 2) throw new Error(`prompt line wider than ${OV - 2}: "${strip(l)}"`);
    return `<div class="overlay" style="width:${OV}ch"><div class="bandT">Calibration for this session · ${TRACK} race</div><pre>${ls.join('\n')}</pre></div>`;
  };
  const rowsOf = promptLines(PRESELECTED).length;

  const seg = (kind) => ({
    A: span('seg', `calibration ${span('t', 'league')}`, 'calibration.pick'),
    Adef: span('seg', `calibration ${span('t', TEXT.defaults)}`, 'calibration.pick'),
    B: span('seg', `${SOURCE.calibration} ${span('t', 'league')}`, 'calibration.pick'),
    C: span('seg', span('t', 'league'), 'calibration.pick'),
  })[kind];
  const bar = (s, { phase = 'RACE', lap = 'L23/52', clock = '1:12:04' } = {}) => `<div class="topbar"><div class="side"><span>garage</span><span class="t">${phase}</span><span>${TRACK}</span><span class="t">${lap}</span><span>${clock}</span><span>green</span><span>moment —</span>${s}</div><div class="side"><span>feed ok · 0.2 % loss</span><span>realism on</span></div></div>`;
  const windowWith = (cursor) => `<div class="window">${bar(seg('A'), { lap: 'L0/52', clock: '1:30:00' })}<div class="layout"><div>Calibration</div><div>Pit loss</div><div>Stint scatter</div><div></div></div>${box(cursor)}</div>`;

  page('start-prompt.html', 'Session-start prompt and top-bar set name (SP4.1a §3.3)', `
<div class="note">A new session starts (the league race at ${TRACK}, on the grid). The UI opens the prompt over the window: the track's sets, the preselection marked, and <b>defaults</b>. Each row is a command (<code>calibration.choose.&lt;setId&gt;</code>, <code>calibration.choose.defaults</code>, C72); Enter sends <code>calibration.choose</code>. Esc, or a click outside, keeps the preselection. <code>calibration.pick</code> (the top-bar segment) opens it again at any time. The layout behind is dimmed here only to show the overlay.</div>
<h2>Prompt as it opens: the cursor on the preselection (overlay ${OV}×${rowsOf} plus its title band)</h2>
${windowWith(PRESELECTED)}
${cap('the cursor row in the palette\'s look (band background, text white), the others dim · <b>preselected</b> faint at the right of league (the newest lastUsedAt, spec 3.3); the cursor starts there · "1 missing" amber with the missing-source hover · a set never used shows its creation day · <b>defaults</b> last: the track file\'s values (ᵈ everywhere)')}
<h2>The cursor moved to the copy (before Enter)</h2>
${windowWith('after-floor-upgrade')}
${cap('the preselected mark stays on league; the cursor is only where Enter will choose · the footer still says what Esc keeps')}
<h2>Top-bar segment: the active set's name (a click invokes <code>calibration.pick</code>)</h2>
<div class="note">Grey like the session segment, the name in the text role; underlined faint here only to point it out. Drawn: <b>A</b> (README Q5).</div>
${bar(seg('A'))}${cap('A · running on league, after the left segments (workbook, session, phase, moment)')}
<div style="height:10px"></div>${bar(seg('Adef'))}${cap('A · running on the track file\'s defaults (chosen, or no set on the track)')}
<div style="height:10px"></div>${bar(seg('B'))}${cap('B · the badge glyph as the label')}
<div style="height:10px"></div>${bar(seg('C'))}${cap('C · the name alone')}`);
}

// ================================================================ page 3: the source badge in the stint scatter and the pit-loss table (ᶜ for ˢ)
{
  // pitLosses.track in the race (L23): green from 6 stops this session plus league; VSC no stop yet, so league; SC default
  const PIT_LOSS = {
    green: { lossMs: 20300, stationaryMs: 2400, n: 6, kind: 'session', tip: 'session · 6 stops + league 20.4 (75 % session)' },
    vsc: { lossMs: 13400, stationaryMs: 2500, n: 0, kind: 'calibration', tip: 'calibration · league: 1 stop (race 15 Oct) · 0 stops this session' },
    sc: { lossMs: 9800, stationaryMs: null, n: 0, kind: 'default', tip: DEFAULT_NOTE },
  };
  const STOPS = [['BOR', 19, 20600, 2500], ['ANT', 18, 20100, 2300], ['BEA', 16, 20400, 2400], ['LIN', 15, 20000, 2300], ['LAW', 14, 20900, 2600], ['DOO', 12, 19800, 2400]];
  const CONDS = ['green', 'vsc', 'sc'];
  const plSpec = [{ h: 'COND', w: 5, a: 'l' }, { h: 'LOSS', w: 5, a: 'r' }, { h: 'STAT', w: 4, a: 'r' }, { h: 'N', w: 2, a: 'r' }, { h: 'SOURCE', w: 11, a: 'l' }];
  const condRows = CONDS.map((c) => {
    const p = PIT_LOSS[c];
    const dim = p.kind === 'default' ? 'd' : '';
    return { cells: [C(TEXT.condition[c], dim), C(FMT.seconds(p.lossMs, 1), dim, p.tip), p.stationaryMs === null ? U('insufficientData') : C(FMT.seconds(p.stationaryMs, 1), dim), C(String(p.n), dim), C(SOURCE_WORD[p.kind], dim, p.tip)] };
  });
  const stSpec = [{ h: 'LAP', w: 3, a: 'l' }, { h: 'DRV', w: 3, a: 'l' }, { h: 'COND', w: 5, a: 'l' }, { h: 'LOSS', w: 5, a: 'r' }, { h: 'STAT', w: 4, a: 'r' }];
  const stopRows = STOPS.map(([code, lap, loss, stat]) => ({ cls: code === 'LIN' ? 'me' : '', cells: [FMT.lapNumber(lap), code, TEXT.condition.green, FMT.seconds(loss, 1), FMT.seconds(stat, 1)] }));
  const pitLoss = panel('Pit loss', { cols: 32, rows: 13, state: TRACK, lines: [...table(plSpec, condRows), '', span('f', ' THIS SESSION, NEWEST FIRST'), ...table(stSpec, stopRows)] });
  const pitLossCompact = panel('Pit loss', { cols: 18, rows: 3, lines: CONDS.map((c) => { const p = PIT_LOSS[c]; const v = V(FMT.seconds(p.lossMs, 1), p.kind, p.tip); return ` ${padR(TEXT.condition[c], 5)} ${span('', padL(v.t, 5), v.tip)}`; }) });
  const demo = `<pre> green  20.3 <span class="tooltip">${PIT_LOSS.green.tip}</span>\n VSC    13.4${badge('calibration')}<span class="tooltip">${PIT_LOSS.vsc.tip}</span>\n SC      9.8${badge('default')}<span class="tooltip">${DEFAULT_NOTE}</span></pre>`;

  // stintAnalysis.car (KUH) with the compounds table: S, M this session; H calibration (LIN's 8 laps on H blend with league's override)
  const points = Array.from({ length: 23 }, (_, i) => {
    const lap = i + 1;
    const excluded = lap === 1 || lap === 9 || lap === 10;
    const corrected = lap === 1 ? 93800 : excluded ? 104000 : lap === 14 ? 91950 : 90950 + 55 * lap + noise(lap, 120);
    return { age: lap, corrected, used: !excluded, downWeighted: lap === 14 };
  });
  const fit = { from: 1, to: 23, base: 90950, deg: 55, sd: 150 };
  const COMPOUNDS = [
    ['S', 0, 85, 18, 14, 'session', 'session · 14 laps (LIN, stint 1) + track default'],
    ['M', 412, 55, 9, 41, 'session', 'session · 41 laps + league (3 sources), 88 % session'],
    ['H', 780, 41, 15, 8, 'calibration', 'calibration · league: your override 0.045 · + 8 laps this session (LIN), 31 % session'],
  ];
  const cfSpec = [{ h: 'CMP', w: 3, a: 'l' }, { h: 'TO SOFT', w: 7, a: 'r' }, { h: 'DEG/LAP', w: 7, a: 'r' }, { h: 'SD', w: 5, a: 'r' }, { h: 'LAPS', w: 4, a: 'r' }, { h: 'SOURCE', w: 11, a: 'l' }];
  const compoundsTable = table(cfSpec, COMPOUNDS.map(([cmp, off, deg, sd, laps, kind, tip]) => ({
    cells: [cmp, FMT.signedSeconds(off, 3) + ' ', V(FMT.signedSeconds(deg, 3), kind, tip), FMT.seconds(sd, 3), String(laps), C(SOURCE_WORD[kind], '', tip)],
  })));
  const cols = 72, rows = 16;
  const yMin = 90400, yMax = 92800;
  const svg = chart({
    cols, rows: rows - compoundsTable.length,
    x: { min: 0, max: 24, ticks: [0, 4, 8, 12, 16, 20, 24], fmt: String, label: 'tyre age, laps' },
    y: { min: yMin, max: yMax, ticks: [90500, 91000, 91500, 92000, 92500], fmt: FMT.lapTimeTenths, label: 'fuel-corrected lap' },
    margin: { l: 80, r: 74 },
    series: [{ pts: [[fit.from, fit.base + fit.deg * fit.from], [fit.to, fit.base + fit.deg * fit.to]], colour: R.ownCar, label: 'M L01–', bold: true }],
    over: (X, Y) => {
      let s = `<polygon points="${X(fit.from)},${Y(fit.base + fit.deg * fit.from + fit.sd)} ${X(fit.to)},${Y(fit.base + fit.deg * fit.to + fit.sd)} ${X(fit.to)},${Y(fit.base + fit.deg * fit.to - fit.sd)} ${X(fit.from)},${Y(fit.base + fit.deg * fit.from - fit.sd)}" fill="${R.ownCar}" opacity="0.10"/>`;
      for (const p of points) {
        const cy = p.corrected > yMax ? Y(yMax) + 6 : Y(p.corrected);
        if (!p.used) s += `<circle cx="${X(p.age)}" cy="${cy}" r="3.5" fill="none" stroke="${R.textFaint}" stroke-width="1.2"/>`;
        else if (p.downWeighted) s += `<circle cx="${X(p.age)}" cy="${cy}" r="3.5" fill="none" stroke="${R.ownCar}" stroke-width="1.2" stroke-dasharray="1.5 1.5"/>`;
        else s += `<circle cx="${X(p.age)}" cy="${cy}" r="3" fill="${R.ownCar}"/>`;
      }
      return s;
    },
  });
  const scatter = panel('Stint scatter', { cols, rows, link: '1 · KUH', state: 'basis wear', svg, svgRows: rows - compoundsTable.length, after: compoundsTable });

  page('source-badge.html', 'Source badge ᶜ in the stint scatter and the pit-loss table (SP4.1a §4.4, §6)', `
<div class="note">The approved 2026-10-30 designs (<code>4-longrun.html</code>), redrawn with the new badge: <b>no mark</b> = measured this session (its share of the blend above half), <b>ᶜ</b> = calibration (hover: the set's name and its sources), <b>ᵈ</b> = default (hover: the track file's source note). ᶜ replaces ˢ (A27). Same race: ${TRACK} L23/52 on the set <code>league</code>. Only the source words, the hovers and the sample numbers change; sizes and layout stay.</div>
<h2>The badge with its hovers</h2>
<div class="row">${fig(`<div class="panel" style="width:84ch">${demo}</div>`, 'the hover boxes drawn because a screenshot cannot hover · every badged value carries its parts, the session one too')}</div>
<h2>Pit-loss table: full 32×13, compact 18×3 (unchanged sizes)</h2>
<div class="row">${fig(pitLoss, 'full · SOURCE in words: session, calibration, default (the column widens from 8 to 11 within the 32 cells) · N = this session\'s stops · green: 6 stops this session, so no mark · VSC: no VSC stop yet, league\'s value · SC: default, muted, stationary unknown')}${fig(pitLossCompact, 'compact · the three losses with their badges: 13.4ᶜ, 9.8ᵈ')}</div>
<h2>Stint scatter: full 72×16 with the compounds table (compact 36×8 has no table)</h2>
<div class="row">${fig(scatter, 'full · KUH · the chart as approved · compounds table: the badge after DEG/LAP and the source in words · S and M session · H calibration: LIN\'s 8 hard laps are 31 % of the blend, the rest is league (your override 0.045) · hover per row as listed in the README')}</div>`);
}

console.log(SIZES.join('\n'));
console.log('written');
