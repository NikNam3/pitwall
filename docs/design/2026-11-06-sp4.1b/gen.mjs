// Generates the SP4.1b mockup changes (plan Task 0): node gen.mjs
// Same method as the 2026-10-30 set: every display is laid out in character cells, with the real theme (imported from
// apps/ui/src/theme) and the SP3 panel frame B. Presentation lives in one place each: THEME (roles, font, density),
// FMT (formats, mirroring kit/values/format.ts), TEXT (wording), SOURCE (the source badge).
// The generator throws when a line is wider than its panel or a cell wider than its column, so a misfit cannot ship.
import { writeFileSync } from 'node:fs';
import { DEFAULT_THEME, FONT_FAMILY } from '../../../apps/ui/src/theme/themes.ts';
import { TEAM_COLOURS } from '../../../apps/ui/src/theme/team-colours.ts';

// ---------------------------------------------------------------- theme (the real one)
const R = DEFAULT_THEME.roles;
const FONT_PX = DEFAULT_THEME.fontPx;
const LINE = DEFAULT_THEME.density.lineHeight;
const GAP = DEFAULT_THEME.density.columnGapCols;
const CELL_W = (800 / 100 / 14) * FONT_PX; // JetBrains Mono's advance, measured in headless Chromium
const CELL_H = FONT_PX * LINE;
const CHART = DEFAULT_THEME.chart;
const cell = (n) => n;

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
  condition: { green: 'green', vsc: 'VSC', sc: 'SC', red: 'red' },
  options: { rival1: 'Rival 1', rival2: 'Rival 2', rival3: 'Rival 3', none: 'none', player: 'player', teammate: 'teammate' },
  settingsTitle: (w) => `${w} · settings`, linkGroup: 'Link group', settingsSaved: 'saved in this workbook',
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
.b { color:var(--pw-best); } .g { color:var(--pw-personalBest); } .y { color:var(--pw-flagYellow); } .r { color:var(--pw-flagRed); }
.tip { text-decoration:underline dotted var(--pw-textFaint); }
.tooltip { display:inline-block; border:1px solid var(--pw-border); background:var(--pw-bgBand); color:var(--pw-text); padding:0 1ch; margin-left:2ch; }
/* a control: a number field or a select, drawn like .pw-input (a 1 px border-role frame, no fill); a button: a quiet word */
.fld { box-shadow:inset 0 0 0 ${DEFAULT_THEME.table.borderPx}px var(--pw-border); color:var(--pw-text); }
.fld.on { box-shadow:inset 0 0 0 ${DEFAULT_THEME.table.borderPx}px var(--pw-focus); }
.btn { color:var(--pw-textDim); }
.curi { background:var(--pw-bgBand); color:var(--pw-text); }
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
    s += `<polyline points="${pts}" fill="none" stroke="${sr.colour}" stroke-width="${sr.width ?? CHART.lineWidth}" stroke-linejoin="round"${sr.dash ? ` stroke-dasharray="${sr.dash.join(' ')}"` : ''}/>`;
    if (sr.label) s += `<text x="${W - m.r + 6}" y="${Y(sr.pts.at(-1)[1]) + 4}" fill="${sr.colour}" ${sr.bold ? 'font-weight="700"' : ''}>${sr.label}</text>`;
  }
  s += over(X, Y, W, H, m);
  return s + '</svg>';
}
const noise = (k, a = 1) => a * (0.6 * Math.sin(k * 2.3) + 0.4 * Math.sin(k * 0.7 + 1));

// ================================================================ the sample: Silverstone, our cars KUH and LIN (the 2026-10-30 set)
const TEAM = { HAM: 1, RUS: 0, NOR: 8, KUH: 3, LIN: 3 };
const OURS = new Set(['KUH', 'LIN']);
const colourOf = (code) => (OURS.has(code) ? R.ownCar : TEAM_COLOURS[TEAM[code]]);

// ---------------------------------------------------------------- (a) raising-average-chart
const ra = (best, slope, curve, k) => Array.from({ length: 18 }, (_, i) => [i + 1, best + slope * i + curve * i * i + (i ? noise(i + k, 8) : 0)]);
const RIVALS = ['HAM', 'RUS', 'NOR']; // widget options rival1..rival3
const raCars = [
  { code: 'HAM', pts: ra(90300, 14, 0.4, 1) }, { code: 'RUS', pts: ra(90610, 22, 1.0, 2) }, { code: 'NOR', pts: ra(90450, 18, 0.5, 5) },
  { code: 'LIN', pts: ra(90705, 30, 1.4, 3) }, { code: 'KUH', pts: ra(90412, 20, 1.2, 4) },
];
const raising = (cols, rows) => panel('Raising average', {
  cols, rows, link: '',
  svg: chart({
    cols, rows,
    x: { min: 1, max: 18, ticks: cols > 50 ? [1, 3, 5, 7, 9, 11, 13, 15, 17] : [1, 6, 12, 18], fmt: String, label: cols > 50 ? 'best n laps' : '' },
    y: { min: 90300, max: 91700, ticks: [90400, 90800, 91200, 91600], fmt: FMT.lapTimeTenths, label: cols > 50 ? 'mean lap' : '' },
    margin: cols > 50 ? { l: 80 } : { l: 58, r: 46, b: 22 },
    series: raCars.map((c) => ({ pts: c.pts, colour: colourOf(c.code), width: OURS.has(c.code) ? CHART.ownCarLineWidth : CHART.lineWidth, dash: c.code === 'LIN' ? CHART.dash : undefined, label: c.code, bold: OURS.has(c.code) })),
  }),
  svgRows: rows,
});

// the panel's options popover (shell SettingsPopover.svelte): one select per car option, then the link group, then the saved note.
// A select is drawn as a framed field; the popover is the overlay look (band title, bgPanel, 40 cells = OVERLAY_COLS.narrow).
const select = (value, w, on = false) => span(on ? 'fld on' : 'fld', padR(' ' + value, w - 2) + '▾ ');
const popover = ({ values, openIndex = -1, list = [] }) => {
  const W = 40;
  const lines = values.map((v, i) => ` ${padR(TEXT.options['rival' + (i + 1)], 8)} ${select(v, 20, i === openIndex)}`);
  if (openIndex >= 0) {
    lines.splice(openIndex + 1, 0, ...list.map((t, i) => ` ${sp(9)}${span(i === 1 ? 'curi' : 'd', padR(' ' + t, 20))}`));
  }
  lines.push(` ${span('d', TEXT.linkGroup)}  ${[1, 2, 3, 4].map((g) => (g === 1 ? '(●)' : '( )') + g).join(' ')}`);
  lines.push(span('f', ' ' + TEXT.settingsSaved));
  for (const l of lines) if (vis(l) > W) throw new Error('popover line wider than ' + W + ': ' + strip(l));
  return `<div class="panel" style="width:${W + 2}ch;outline:1px solid var(--pw-border)"><div class="ph"><span class="t">${TEXT.settingsTitle('Raising average')}</span></div><pre>${lines.join('\n')}</pre></div>`;
};

// ---------------------------------------------------------------- (b) lap-overview-grid
const heatBg = (h) => { const a = [0x14, 0x14, 0x16], b = [0x5c, 0x60, 0x68]; return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * h)).join(',')})`; };
const STATUS_CLASS = { vsc: 'y', sc: 'y', red: 'r' }; // theme roles flagYellow, flagYellow, flagRed
const RED_LAP = 11; // completed under a suspension, right after the VSC laps 9 and 10
const linLaps = [96100, 91300, 91000, 90900, 91100, 91000, 91300, 91200, 103400, 104000, 118200, 91600, 91900, 92200, 99700, 111200, 91000, 90800, 90700, 90900, 90600, 90800, 90900].map((ms, i) => {
  const lap = i + 1;
  const stint = lap <= 15 ? 1 : 2;
  const kind = lap === 15 ? 'in' : lap === 16 ? 'out' : 'normal';
  const status = lap === RED_LAP ? 'red' : lap === 9 || lap === 10 ? 'vsc' : 'green';
  const best = lap === 21 ? 'personal' : 'none';
  return { lap, ms, stint, compound: stint === 1 ? 'S' : 'H', kind, status, best, forPace: lap !== 1 && kind === 'normal' && status === 'green' };
});
for (const s of [1, 2]) {
  const pace = linLaps.filter((l) => l.stint === s && l.forPace);
  const [lo, hi] = [Math.min(...pace.map((l) => l.ms)), Math.max(...pace.map((l) => l.ms))];
  for (const l of pace) l.heat = (l.ms - lo) / (hi - lo); // sample data only: the analysis delivers heat
}
const MARK = { in: 'i', out: 'o', normal: ' ' };
const lapCell = (l) => {
  const t = FMT.lapTimeTenths(l.ms);
  const cls = l.best === 'session' ? 'b' : l.best === 'personal' ? 'g' : l.heat === undefined ? 'd' : '';
  return `<span${cls ? ` class="${cls}"` : ''} style="${l.heat !== undefined ? `background:${heatBg(l.heat)}` : ''}">${t}</span>` + span('f', MARK[l.kind]);
};
const gridLines = (laps) => {
  const out = [];
  let row = [];
  let rowStart = null;
  const flush = () => {
    if (!row.length) return;
    out.push(` ${span('f', FMT.lapNumber(rowStart, 2))} ${row.map(lapCell).join(' ')}`);
    if (row.some((l) => l.status !== 'green')) out.push(` ${sp(3)} ${row.map((l) => (l.status === 'green' ? sp(7) : span(STATUS_CLASS[l.status], padR(TEXT.condition[l.status], 7)))).join(' ')}`);
    row = [];
  };
  laps.forEach((l, i) => {
    if (i === 0 || l.stint !== laps[i - 1].stint) { flush(); out.push(span('f', ` STINT ${l.stint} · ${l.compound}`)); }
    if (row.length === 10 || (row.length && (l.lap - 1) % 10 === 0)) flush();
    if (!row.length) rowStart = l.lap;
    row.push(l);
  });
  flush();
  return out;
};
const lapOverview = panel('Lap overview', { cols: 84, rows: 8, link: '1 · LIN', lines: gridLines(linLaps) });
const BLOCKS = '▁▂▃▄▅▆▇█';
const kuhLaps = Array.from({ length: 23 }, (_, i) => {
  const lap = i + 1;
  const status = lap === RED_LAP ? 'red' : lap === 9 || lap === 10 ? 'vsc' : 'green';
  return { lap, status, heat: lap === 1 || status !== 'green' ? undefined : lap === 20 ? 0 : Math.min(1, Math.max(0.05, 0.25 + 0.03 * lap + noise(lap, 0.25))), best: lap === 20 ? 'session' : 'none' };
});
const compactGrid = (laps, label) => panel('Lap overview', {
  cols: 30, rows: 3, link: '1 · KUH',
  lines: [
    span('f', ` ${label}`),
    ' ' + laps.map((l) => (l.heat === undefined ? span('f', '·') : span(l.best === 'session' ? 'b' : l.best === 'personal' ? 'g' : '', BLOCKS[Math.round(l.heat * 7)]))).join(''),
    ' ' + laps.map((l) => (l.status === 'green' ? ' ' : span(STATUS_CLASS[l.status], '━'))).join(''),
  ],
});

page('changes.html', 'SP4.1b · changes against the approved 2026-10-30 mockups (raising average, lap overview)', `
<div class="note">Two changes, everything else as approved on page 4 of the 2026-10-30 set. Same Silverstone sample, our cars KUH and LIN. <b>(a)</b> the raising average draws up to three rivals chosen in the panel's options. <b>(b)</b> the lap overview gains a <b>red</b> lap status.</div>
<h2>(a) Raising average: full 60×14, compact 36×8</h2>
<div class="row">${fig(raising(60, 14), 'full · KUH and LIN white (LIN dashed) · rivals from the options Rival 1 to 3 (here HAM, RUS, NOR) in their team colour · a rival option left empty draws no line')}${fig(raising(36, 8), 'compact · same lines, chart only')}</div>
<h2>(a) The panel's options popover: three car pickers</h2>
<div class="row">${fig(popover({ values: ['HAM', 'RUS', 'NOR'] }), 'the existing settings popover (gear in the panel header, 40 cells) · one select per car option · three new: Rival 1, 2, 3 · then the link group and the saved note, as for every panel')}${fig(popover({ values: ['HAM', 'RUS', TEXT.options.none], openIndex: 2, list: [TEXT.options.none, 'HAM', 'RUS', 'NOR', '...'] }), 'Rival 3 opened · the list is the session\'s cars by code; the first choice is "none" for a rival (a car option\'s generic first choice is "follow", which means nothing here) · see Q3')}</div>
<h2>(b) Lap overview: full 84×8 (was 84×7), compact 30×3</h2>
<div class="row">${fig(lapOverview, 'full · LIN · L11 is a lap completed under a red flag (suspension): no heat, dim, and a red strip under it, like the yellow one under the VSC laps L09 and L10 · the grid grows by one strip row (the L11 row now has a strip under it: 84×8 where the original had 84×7, see Q4)')}</div>
<div class="row" style="margin-top:12px">${fig(compactGrid(kuhLaps, 'M  L01–L23'), 'compact · KUH · the strip marks the VSC laps in yellow and L11 (red flag) in red · the cell above each is "·" (no heat)')}</div>
<div class="note">Strip colours are theme roles: <span class="y">flagYellow</span> for VSC and SC, <span class="r">flagRed</span> for red (both exist in themes.ts). Status wording: <code>VSC</code>, <code>SC</code>, <code>red</code> (the widget's text.ts).</div>`);
console.log(SIZES.join('\n'));
