// Generates the sub-project 4a display mockups (plan Task 0): node gen.mjs
// Every display is laid out in character cells, with the real theme (imported from apps/ui/src/theme) and the SP3
// panel frame B. Presentation lives in one place each: THEME (roles, font, density), FMT (formats, mirroring
// kit/values/format.ts), TEXT (wording), GHOST_STYLES (the ghost variants), UC_HL (the undercut highlights), SOURCE (the source badge).
// The generator throws when a line is wider than its panel or a cell wider than its column, so a misfit cannot ship.
import { writeFileSync } from 'node:fs';
import { DEFAULT_THEME, FONT_FAMILY } from '../../../apps/ui/src/theme/themes.ts';
import { TEAM_COLOURS } from '../../../apps/ui/src/theme/team-colours.ts';

// ---------------------------------------------------------------- theme (the real one)
const R = DEFAULT_THEME.roles;
const FONT_PX = DEFAULT_THEME.fontPx;
const LINE = DEFAULT_THEME.density.lineHeight;
const GAP = DEFAULT_THEME.density.columnGapCols;
// JetBrains Mono's advance, measured in headless Chromium (100 cells = 800 px at 14 px). kit/size cellBox counts
// 0.6 em (8.4 px), so the app's cell counts are about 5 % conservative; the layouts page uses the app's count.
const CELL_W = (800 / 100 / 14) * FONT_PX;
const CELL_H = FONT_PX * LINE;
const CHART = DEFAULT_THEME.chart;
const roleVar = (r) => `var(--pw-${r})`;

// ---------------------------------------------------------------- formats (mirror kit/values/format.ts)
const MINUS = '−';
const fixed = (v, d) => {
  const t = v.toFixed(d);
  if (/^-0(\.0*)?$/.test(t)) return t.slice(1);
  return t.startsWith('-') ? MINUS + t.slice(1) : t;
};
const pad0 = (n, w) => String(n).padStart(w, '0');
const FMT = {
  lapTime: (ms) => { const t = Math.round(ms); return `${Math.floor(t / 60000)}:${pad0(Math.floor((t % 60000) / 1000), 2)}.${pad0(t % 1000, 3)}`; },
  /** proposed kit format: lap time to tenths, `90412` -> `1:30.4` */
  lapTimeTenths: (ms) => { const t = Math.round(ms / 100); return `${Math.floor(t / 600)}:${pad0(Math.floor((t % 600) / 10), 2)}.${t % 10}`; },
  /** proposed kit format: race time to tenths, `4724600` -> `1:18:44.6` */
  raceTime: (ms) => { const t = Math.round(ms / 100); const h = Math.floor(t / 36000); return `${h}:${pad0(Math.floor((t % 36000) / 600), 2)}:${pad0(Math.floor((t % 600) / 10), 2)}.${t % 10}`; },
  gap: (ms) => `${ms < 0 ? MINUS : '+'}${(Math.abs(Math.round(ms)) / 1000).toFixed(3)}`,
  seconds: (ms, d) => fixed(ms / 1000, d),
  signedSeconds: (ms, d) => { const t = fixed(Math.abs(ms) / 1000, d); return `${ms < 0 && Number(t) !== 0 ? MINUS : '+'}${t}`; },
  lapNumber: (n, w = 1) => `L${String(n).padStart(w, '0')}`,
  laps: (n) => `${fixed(n, 1)} laps`,
  position: (n) => `P${n}`,
  temp: (c) => `${fixed(c, 0)}°`,
  pct: (p) => `${fixed(p, 0)}%`,
  pct1: (p) => `${fixed(p, 1)}%`,
  /** proposed kit format: a forecast offset, `0` -> `now`, `30` -> `+30` (minutes in the header) */
  offsetMin: (m) => (m === 0 ? 'now' : `+${m}`),
  gapTick: (g) => (g === 0 ? '0' : g > 0 ? `+${g}` : `${MINUS}${-g}`),
};

// ---------------------------------------------------------------- wording (kit/text.ts, plus the new widgets' text.ts)
const TEXT = {
  unknown: {
    restricted: "hidden by the driver's telemetry setting",
    notReceived: 'not received yet',
    notApplicable: 'not applicable',
    realism: 'hidden by realism mode',
    insufficientData: 'too few laps or samples yet',
  },
  condition: { green: 'green', vsc: 'VSC', sc: 'SC' },
  sky: { clear: 'clear', lightCloud: 'cloud', overcast: 'overc.', lightRain: 'l.rain', heavyRain: 'h.rain', storm: 'storm' },
  trend: { up: '▲', down: '▼', flat: ' ' },
  tyreType: { slick: 'slick', inter: 'inter', wet: 'wet' },
};

// ---------------------------------------------------------------- the ghost (kit piece, spec 8.3): new Q1 answered B (faint,
// letters and dashes); round 3 shows B and three ways to mark where the ghost slots in, all with solid hairlines.
// One variant styles the crossing order (table), the gap chart (line) and the track map (marker) together.
const CONDITIONS = ['green', 'vsc', 'sc'];
const LETTER = { green: 'G', vsc: 'VSC', sc: 'SC' };
const B_LOOK = { colour: () => R.textFaint, opacity: 1, dash: (c) => ({ green: [2, 3], vsc: [7, 3], sc: [7, 3, 2, 3] })[c], marker: 'ring' };
const GHOST_STYLES = {
  B: { ...B_LOOK, name: 'B as answered: faint row', slot: '' },
  B1: { ...B_LOOK, name: 'B with hairlines above and below', slot: 'slot-both' },
  B2: { ...B_LOOK, name: 'B with a hairline on top', slot: 'slot-top' },
  B3: { ...B_LOOK, name: 'B sitting on a rule', slot: 'slot-base' },
};
const REC_GHOST = 'B1';

// ---------------------------------------------------------------- the undercut highlight: new Q9 answered B (colour);
// round 3 shows candidate hues for "our undercut possible" (a new theme role, proposed name `opportunity`); theirs stays amber.
const OPPORTUNITY = { cyan: '#3fd8e8', teal: '#2ec4b6', series6: R.series6 };
const REC_OPP = 'cyan';

// ---------------------------------------------------------------- flags on the map: how a car shown blue is marked (new Q16)
const BLUE_MARKS = { ring: 'a blue ring around the dot', tick: 'a short blue bar beside the dot', code: 'the car code in blue' };
const REC_BLUE = 'ring';

// ---------------------------------------------------------------- the source badge (kit piece, spec 8.1, 8.3)
// Measured this session: no mark (the normal case). Stored (earlier sessions): ˢ. Default (community value): ᵈ.
// Every prior-based value carries the hover text, measured ones too.
const SOURCE = { measured: ' ', stored: 'ˢ', default: 'ᵈ' };
const sourceHover = (s, unit) => (s.kind === 'default' ? `default · ${s.note}` : `${s.kind} · ${s.samples} ${unit}`);

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
svg text.s { font-size:${FONT_PX - 2}px; }
.cap { color:var(--pw-textFaint); margin:4px 0 0; min-width:40ch; }
.d { color:var(--pw-textDim); } .f { color:var(--pw-textFaint); } .w { color:var(--pw-warning); } .c { color:var(--pw-critical); }
.b { color:var(--pw-best); } .g { color:var(--pw-personalBest); } .y { color:var(--pw-flagYellow); }
.o, .hi { color:var(--pw-ownCar); font-weight:${DEFAULT_THEME.table.boldWeight}; } .m { font-weight:${DEFAULT_THEME.table.boldWeight}; }
.slot-both { display:inline-block; box-shadow:inset 0 1px 0 var(--pw-textFaint), inset 0 -1px 0 var(--pw-textFaint); }
.slot-top { display:inline-block; box-shadow:inset 0 1px 0 var(--pw-textFaint); }
.slot-base { display:inline-block; box-shadow:inset 0 -1px 0 var(--pw-textFaint); }
${Object.entries(OPPORTUNITY).map(([k, v]) => `.opp-${k} { color:${v}; font-weight:700; }`).join(' ')}
.gband { background:var(--pw-bgBand); }
.ty-inter { color:var(--pw-series3); }
.litW { background:var(--pw-text); color:var(--pw-bg); font-weight:700; } .litA { background:var(--pw-warning); color:var(--pw-bg); font-weight:700; }
.barW { box-shadow:inset 3px 0 0 var(--pw-ownCar); display:inline-block; width:100%; } .barA { box-shadow:inset 3px 0 0 var(--pw-warning); display:inline-block; width:100%; }
.wm { color:var(--pw-warning); font-weight:700; } .gm { color:var(--pw-personalBest); font-weight:700; }
.band { background:var(--pw-bgRowBand); display:inline-block; width:100%; }
.me { color:var(--pw-ownCar); font-weight:700; box-shadow:inset ${DEFAULT_THEME.table.barPx}px 0 0 var(--pw-text); display:inline-block; width:100%; }
.tip { text-decoration:underline dotted var(--pw-textFaint); }
.tooltip { display:inline-block; border:1px solid var(--pw-border); background:var(--pw-bgBand); color:var(--pw-text); padding:0 1ch; margin-left:2ch; }
.sel { color:var(--pw-ownCar); font-weight:700; text-decoration:underline; }
.q { border-left:2px solid var(--pw-border); padding-left:2ch; margin:10px 0 4px; max-width:130ch; color:var(--pw-textDim); }
.q b { color:var(--pw-text); font-weight:500; }
table.sizes { border-collapse:collapse; color:var(--pw-textDim); } table.sizes td, table.sizes th { padding:0 2ch 0 0; text-align:left; font-weight:400; }
table.sizes th { color:var(--pw-textFaint); }
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
/** A prior-based value: the number, then its one-cell badge; the hover names the source. */
const V = (text, source, unit, c) => ({ t: text + (source.kind === 'measured' ? ' ' : span('d', SOURCE[source.kind])), c, tip: sourceHover(source, unit) });

const GEAR = '<svg width="14" height="14" viewBox="0 0 14 14" style="display:inline;vertical-align:-2px"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="1.1" stroke-dasharray="2 1.4"/><circle cx="7" cy="7" r="2.1" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>';

/**
 * Character-cell table. spec = [{ h, w, a: 'l'|'r' }]; rows = [{ cls?, cells: [string | { t, c, tip }] }].
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
  rows.forEach((r, k) => {
    if (r.raw !== undefined) { out.push(r.raw); return; }
    const line = sp(lead) + r.cells.map(cell).join(sp(GAP));
    const cls = [band && k % 2 === 1 ? 'band' : '', r.cls ?? ''].filter(Boolean).join(' ');
    out.push(cls ? span(cls, line) : line);
  });
  return out;
}

/** Panel frame B: header band (title, link marker, state, gear), then the body in character cells. */
function panel(title, { cols, rows, link = '1 · KUH', state = '', lines = [], svg = '', svgRows = 0, after = [] }) {
  const all = [...lines, ...after];
  for (const l of all) if (vis(l) > cols) throw new Error(`${title}: line wider than ${cols}: "${strip(l)}" (${vis(l)})`);
  const used = lines.length + svgRows + after.length;
  if (rows !== undefined && used > rows) throw new Error(`${title}: ${used} rows, more than ${rows}`);
  const pre = (ls) => (ls.length ? `<pre>${ls.join('\n')}</pre>` : '');
  const fill = rows !== undefined ? rows - used : 0;
  return `<div class="panel" style="width:${cols + 2}ch"><div class="ph"><span class="t">${title}</span><span class="lk">${link}</span><span class="sp"></span><span class="age">${state}</span><span>${GEAR}</span></div>${pre(lines)}${svg}${pre(after)}${fill > 0 ? `<div style="height:${fill * CELL_H}px"></div>` : ''}</div>`;
}
const cap = (t) => `<div class="cap">${t}</div>`;
const fig = (p, c) => `<div>${p}${cap(c)}</div>`;
const page = (file, title, body) =>
  writeFileSync(new URL(file, import.meta.url), `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>${CSS}</style></head><body><h1>${title}</h1>${body}</body></html>\n`);

// ---------------------------------------------------------------- charts (kit Chart look: textDim axes in the theme font, grid role, bgBand phase bands)
function chart({ cols, rows, x, y, series = [], bands = [], over = () => '', margin = {} }) {
  const m = { l: 70, r: 70, t: 10, b: 40, ...margin };
  const W = (cols + 2) * CELL_W, H = rows * CELL_H;
  const X = (v) => m.l + ((W - m.l - m.r) * (v - x.min)) / (x.max - x.min);
  const Y = (v) => (y.invert ? m.t + ((H - m.t - m.b) * (v - y.min)) / (y.max - y.min) : H - m.b - ((H - m.t - m.b) * (v - y.min)) / (y.max - y.min));
  let s = `<svg width="${W}" height="${H}">`;
  for (const b of bands) s += `<rect x="${X(b.from)}" y="${m.t}" width="${X(b.to) - X(b.from)}" height="${H - m.t - m.b}" fill="${R.bgBand}"/><text x="${X(b.from) + 4}" y="${H - m.b - 6}" fill="${R.textFaint}">${b.label}</text>`;
  for (const v of y.ticks) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="${R.grid}"/><text x="${m.l - 6}" y="${Y(v) + 4}" fill="${R.textDim}" text-anchor="end">${y.fmt(v)}</text>`;
  for (const v of x.ticks) s += `<line y1="${m.t}" y2="${H - m.b}" x1="${X(v)}" x2="${X(v)}" stroke="${R.grid}"/><text x="${X(v)}" y="${H - m.b + 16}" fill="${R.textDim}" text-anchor="middle">${x.fmt(v)}</text>`;
  if (x.label) s += `<text x="${(m.l + W - m.r) / 2}" y="${H - 4}" fill="${R.textDim}" text-anchor="middle">${x.label}</text>`;
  if (y.label) s += `<text x="16" y="${(m.t + H - m.b) / 2}" fill="${R.textDim}" transform="rotate(-90 16 ${(m.t + H - m.b) / 2})" text-anchor="middle">${y.label}</text>`;
  const ends = [];
  for (const sr of series) {
    const pts = sr.pts.map(([a, b]) => `${X(a).toFixed(1)},${Y(b).toFixed(1)}`).join(' ');
    s += `<polyline points="${pts}" fill="none" stroke="${sr.colour}" stroke-width="${sr.width ?? CHART.lineWidth}" ${sr.dash ? `stroke-dasharray="${sr.dash.join(' ')}"` : ''} ${sr.opacity ? `opacity="${sr.opacity}"` : ''} stroke-linejoin="round"/>`;
    if (sr.label) ends.push({ sr, y: Y(sr.pts.at(-1)[1]) });
  }
  ends.sort((p, q) => p.y - q.y);
  for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 14); // labels never overlap
  for (const e of ends) s += `<text x="${W - m.r + 6}" y="${e.y + 4}" fill="${e.sr.labelColour ?? e.sr.colour}" ${e.sr.opacity ? `opacity="${e.sr.opacity}"` : ''} ${e.sr.bold ? 'font-weight="700"' : ''}>${e.sr.label}</text>`;
  s += over(X, Y, W, H, m);
  return s + '</svg>';
}
const diamond = (x, y, r, colour, w = 2) => `<polygon points="${x},${y - r} ${x + r},${y} ${x},${y + r} ${x - r},${y}" fill="${R.bg}" stroke="${colour}" stroke-width="${w}"/>`;
const noise = (k, a = 1) => a * (0.6 * Math.sin(k * 2.3) + 0.4 * Math.sin(k * 0.7 + 1));

// ---------------------------------------------------------------- the sample race: Silverstone (track 7), L23/52, our cars KUH (P6) and LIN (P9)
const TEAM = { VER: 2, NOR: 8, PIA: 8, LEC: 1, HAM: 1, KUH: 3, RUS: 0, ALO: 4, LIN: 3, GAS: 5, HAD: 6, HUL: 9, OCO: 7, STR: 4, BEA: 7, ANT: 0, BOR: 9, LAW: 6, DOO: 5, TSU: 2 };
const OURS = new Set(['KUH', 'LIN']);
const LAP = 23, TOTAL = 52, LAP_S = 90.2;
const colourOf = (code) => (OURS.has(code) ? R.ownCar : TEAM_COLOURS[TEAM[code]]);
// gap to the leader at the end of L23 in s, and the stop lap of the cars that stopped (green, 20.3 s)
const FIELD = [
  ['VER', 0], ['NOR', 2.491], ['PIA', 6.315], ['LEC', 11.872], ['HAM', 15.99], ['KUH', 18.402], ['RUS', 19.706], ['ALO', 23.279],
  ['LIN', 27.358, 15], ['GAS', 31.042], ['HAD', 35.635], ['HUL', 38.414], ['OCO', 40.81], ['STR', 44.383], ['BEA', 47.952, 16],
  ['ANT', 49.61, 18], ['BOR', 53.12, 19], ['LAW', 55.04, 14], ['DOO', 61.3, 12],
];
const US_GAP = 18.402;
// pitLosses.track
const PIT_LOSS = {
  green: { lossMs: 20300, stationaryMs: 2400, source: { kind: 'measured', samples: 6 } },
  vsc: { lossMs: 13100, stationaryMs: 2500, source: { kind: 'stored', samples: 3 } },
  sc: { lossMs: 9800, stationaryMs: null, source: { kind: 'default', samples: 0, note: 'community value, Silverstone (R3)' } },
};
const STOPS = [['BOR', 19, 20600, 2500], ['ANT', 18, 20100, 2300], ['BEA', 16, 20400, 2400], ['LIN', 15, 20000, 2300], ['LAW', 14, 20900, 2600], ['DOO', 12, 19800, 2400]];
// rejoin.car (KUH): per condition, the crossing order around the ghost: [code | 'ghost', position, gapToNextMs (to the car ahead in the order)]
const REJOIN = {
  green: { position: 12, ahead: ['HUL', -612], behind: ['OCO', 1496], order: [['LIN', 8, 4079], ['GAS', 9, 3684], ['HAD', 10, 4593], ['HUL', 11, 2779], ['ghost', 12, 612], ['OCO', 13, 1496], ['STR', 14, 3573], ['BEA', 15, 3569]] },
  vsc: { position: 10, ahead: ['GAS', -458], behind: ['HAD', 4135], order: [['RUS', 6, 1304], ['ALO', 7, 3573], ['LIN', 8, 4079], ['GAS', 9, 3684], ['ghost', 10, 458], ['HAD', 11, 4135], ['HUL', 12, 2779], ['OCO', 13, 2396]] },
  sc: { position: 9, ahead: ['LIN', -844], behind: ['GAS', 2840], order: [['HAM', 5, 2412], ['RUS', 6, 1304], ['ALO', 7, 3573], ['LIN', 8, 4079], ['ghost', 9, 844], ['GAS', 10, 2840], ['HAD', 11, 4593], ['HUL', 12, 2779]] },
};

// ================================================================ page 1: ghost views (crossing order, gap chart ghost lines)
// Shared with page 6, so they live outside the page block.
const blockSpec = [{ h: 'P', w: 2, a: 'r' }, { h: 'DRV', w: 4, a: 'l' }, { h: 'INT', w: 7, a: 'r' }];
const BW = 2 + 1 + 4 + 1 + 7; // 15 cells
/** One condition of the crossing order: title (condition, loss), header, the cars around the ghost. */
function crossingBlock(c, { around = 2, active = false, unknown = false, v = REC_GHOST } = {}) {
  const r = REJOIN[c];
  const loss = PIT_LOSS[c];
  const lossCell = unknown ? span('tip', '    ', TEXT.unknown.insufficientData) : V(FMT.seconds(loss.lossMs, 1), loss.source, 'stops').t;
  const word = TEXT.condition[c];
  const title = `${word} ${unknown ? lossCell : span('', lossCell, sourceHover(loss.source, 'stops'))}`;
  const head = active ? span('hi', strip(title)) : title;
  if (unknown) return [padR(head, BW), span('f', padR(' P DRV      INT', BW)), span('tip', sp(BW), TEXT.unknown.insufficientData)];
  const gi = r.order.findIndex((o) => o[0] === 'ghost');
  const rows = r.order.slice(gi - around, gi + around + 1).map(([code, p, int]) => {
    if (code === 'ghost') return { cls: GHOST_STYLES[v].slot, cells: [C(String(p), 'f'), C('KUH', 'f'), C(FMT.gap(int), 'f')] };
    const near = code === r.ahead[0] || code === r.behind[0];
    const cls = OURS.has(code) ? 'o' : near ? 'm' : '';
    return { cells: [C(String(p), cls), C(code, cls), C(FMT.gap(int), cls)] };
  });
  return [padR(head, BW), ...table(blockSpec, rows, { lead: 0, band: false }).map((l) => padR(l, BW))];
}
const crossingFull = (opts = {}) => panel('Crossing order', { cols: 54, rows: 9, state: opts.state ?? '', lines: CONDITIONS.map((c) => crossingBlock(c, { around: 3, active: opts.active === c, unknown: opts.unknown, v: opts.v })).reduce((acc, b) => acc.map((l, i) => l + (l ? '   ' : ' ') + (b[i] ?? sp(BW))), Array(9).fill('')) });
const crossingCompact = (c, state = '', v = REC_GHOST) => panel('Crossing order', { cols: 20, rows: 7, state, lines: crossingBlock(c, { v }).map((l) => ' ' + l) });

/** The gap chart (existing widget) with the ghost lines of rejoin.car in variant v. */
function gapChart({ cols, rows, ghosts = true, laps = LAP, from = 1, v = REC_GHOST }) {
  const g = GHOST_STYLES[v];
  const cars = FIELD.slice(0, 14).map(([code, g23, stop], i) => {
    const lossAt = stop ? 20.3 : 0;
    const slope = (g23 - lossAt) / LAP;
    const pts = [];
    for (let l = from; l <= laps; l++) pts.push([l, slope * l + (stop && l >= stop ? lossAt : 0) + (l === LAP ? 0 : noise(l + i, 0.12))]);
    const own = OURS.has(code);
    const mate = code === 'LIN';
    return { pts, colour: colourOf(code), width: own ? CHART.ownCarLineWidth : CHART.lineWidth, dash: mate || ['PIA', 'HAM', 'ALO'].includes(code) ? CHART.dash : undefined, bold: own };
  });
  const us = cars[5].pts;
  const lettered = true;
  const ghostLines = ghosts
    ? CONDITIONS.map((c) => ({ pts: us.filter(([l]) => l >= LAP - 5).map(([l, gp]) => [l, gp + PIT_LOSS[c].lossMs / 1000]), colour: g.colour(c), opacity: g.opacity < 1 ? g.opacity : undefined, width: 1, dash: g.dash(c), label: lettered ? LETTER[c] : undefined }))
    : [];
  const wide = cols > 50;
  const svg = chart({
    cols, rows: rows - 1,
    x: { min: from, max: laps, ticks: Array.from({ length: laps }, (_, k) => k + 1).filter((l) => l >= from && (l - 1) % (wide ? 2 : 4) === 0), fmt: String, label: wide ? 'lap' : '' },
    y: { min: -2, max: 48, invert: true, ticks: [0, 10, 20, 30, 40], fmt: FMT.gapTick, label: wide ? 'behind reference, s' : '' },
    bands: from <= 9 ? [{ from: 9, to: 11, label: 'VSC' }] : [],
    series: [...cars, ...ghostLines],
    margin: wide ? { r: lettered && ghosts ? 40 : 16 } : { l: 44, r: lettered && ghosts ? 34 : 12, b: 22 },
    over: (X, Y) => (ghosts && !lettered ? CONDITIONS.map((c) => `<circle cx="${X(LAP)}" cy="${Y(us.at(-1)[1] + PIT_LOSS[c].lossMs / 1000)}" r="3.5" fill="${R.bg}" stroke="${g.colour(c)}" stroke-width="1.2" opacity="${g.opacity}"/>`).join('') : ''),
  });
  const leg = (c, words) => {
    const t = `${words ? (lettered ? LETTER[c] : TEXT.condition[c]) + ' ' : ''}${FMT.seconds(PIT_LOSS[c].lossMs, 1)}`;
    return t;
  };
  const legend = !ghosts ? '' : wide ? ` · ${span('d', 'pit')} ` + CONDITIONS.map((c) => leg(c, true)).join(' ') : `${span('d', 'pit')} ` + CONDITIONS.map((c) => leg(c, lettered)).join(' ');
  const ref = wide || !ghosts ? `ref leader avg 1:30.207${legend}` : legend;
  return panel('Gap chart', { cols, rows, lines: [padL(ref, cols)], svg, svgRows: rows - 1 });
}

{
  const gapCompact = (ghosts) => gapChart({ cols: 36, rows: 8, ghosts, from: LAP - 17 });
  page('1-ghost-views.html', '1 · Rejoin ghost: crossing order and gap chart (V03, V04)', `
<div class="note">Sample race for every page: Silverstone, <b>L23/52</b>. Our cars <b>KUH</b> (P6, medium, 23 laps old) and <b>LIN</b> (P9, stopped L15). The ghost is where KUH would be if it boxed at the end of this lap, per condition (<code>rejoin.car</code>). Our cars are white. Gap sign as SP3: a car ahead is negative, behind positive. Hover texts are in the captions (a screenshot cannot hover).</div>
<div class="note"><b>New Q1:</b> B is chosen (faint row, letters and dashes); how it marks the slot is open (page 6). This page shows the recommended ${REC_GHOST} (${GHOST_STYLES[REC_GHOST].name}): the ghost row in the faint text role between two solid hairlines, our code plain, the condition named by its column; in the chart faint lines told apart by dash and letter.</div>

<h2>Crossing order (V03): full 54×9, compact 20×7</h2>
<div class="row">${fig(crossingFull(), 'full · green running: the three conditions side by side, three cars either side of the ghost · INT = <code>intervalMs</code>, the gap to the car ahead in the projected crossing order · P = the order item\'s <code>position</code> · the car directly ahead and behind the ghost bold · LIN white (ours) · VSC loss stored (ˢ), SC loss default (ᵈ); hover: "measured · 6 stops", "stored · 3 stops", "default · community value, Silverstone (R3)"')}</div>
<div class="row" style="margin-top:12px">${fig(crossingCompact('green'), 'compact · green running: the green condition only, two cars either side')}${fig(crossingCompact('sc', span('y', 'SC')), 'compact · SC out: the SC condition (the one that applies now)')}${fig(crossingFull({ active: 'sc', state: span('y', 'SC') }), 'full · SC out: the SC condition\'s title white bold (relevant now); the header shows SC')}</div>
<div class="row" style="margin-top:12px">${fig(crossingFull({ unknown: true }), 'unknown · L1, no gaps yet: titles stay, the losses and orders are empty with "too few laps or samples yet" on hover')}</div>
<div class="note">Realism: no field of this display is hidden (positions and gaps are GPS and timing); a rival's hidden wear only changes the forecast's basis inside <code>rejoin</code>.</div>

<h2>Gap chart (V04) with ghost lines: full 72×14, compact 36×8 (existing sizes)</h2>
<div class="row">${fig(gapChart({ cols: 72, rows: 14 }), 'full · our gapper line plus each condition\'s loss, over the last 6 laps (Q6 A) · the cars between our white line and a ghost line are the cars we would drop behind · faint lines: G dotted, VSC dashed, SC dash-dot, the letter at the end · the header names the losses')}</div>
<div class="row" style="margin-top:12px">${fig(gapCompact(true), 'compact · letters and losses in the header')}${fig(gapCompact(false), 'rejoin unknown: no ghost lines, the chart as today')}</div>`);
}

// ================================================================ page 2: map views (track map, incident feed turn)
let mapPanelShared; // page 6 draws the map in each ghost variant
{
  // A sketch of a circuit (not Silverstone's real geometry): polygon vertices in lap order; each vertex is a turn.
  const POLY = [[62, 62], [70, 56], [78, 58], [84, 65], [90, 58], [92, 40], [86, 30], [74, 28], [66, 20], [58, 23], [52, 14], [44, 10], [34, 16], [24, 13], [14, 22], [10, 36], [17, 49], [12, 60]];
  const n = POLY.length;
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const corners = POLY.map((V, i) => {
    const P = POLY[(i - 1 + n) % n], N = POLY[(i + 1) % n];
    return { A: lerp(V, P, Math.min(2.2 / dist(V, P), 0.4)), V, B: lerp(V, N, Math.min(2.2 / dist(V, N), 0.4)) };
  });
  const start = lerp(corners[n - 1].B, corners[0].A, 0.55);
  const pts = [start];
  const apexIdx = [];
  for (const { A, V, B } of corners) {
    pts.push(A);
    for (let k = 1; k <= 10; k++) {
      const t = k / 10;
      pts.push([(1 - t) ** 2 * A[0] + 2 * (1 - t) * t * V[0] + t * t * B[0], (1 - t) ** 2 * A[1] + 2 * (1 - t) * t * V[1] + t * t * B[1]]);
      if (k === 5) apexIdx.push(pts.length - 1);
    }
  }
  pts.push(start);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  const L = cum.at(-1);
  const at = (f) => {
    const d = (((f % 1) + 1) % 1) * L;
    let i = 1;
    while (cum[i] < d) i++;
    return lerp(pts[i - 1], pts[i], (d - cum[i - 1]) / (cum[i] - cum[i - 1]));
  };
  const apexF = apexIdx.map((i) => cum[i] / L);
  const centroid = POLY.reduce((s, p) => [s[0] + p[0] / n, s[1] + p[1] / n], [0, 0]);
  const LABEL_NUDGE = {}; // 1-based turn: extra offset where the outward label meets the track
  const US_F = 0.585;
  const fOf = (gapToUs) => US_F - gapToUs / LAP_S;
  const carsOnTrack = FIELD.map(([code, g]) => ({ code, f: fOf(g - US_GAP), inPit: code === 'DOO' }));
  const ghostF = (c) => { const r = REJOIN[c]; const aheadGap = FIELD.find(([k]) => k === r.ahead[0])[1] - US_GAP; return fOf(aheadGap) + r.ahead[1] / 1000 / LAP_S; };
  const SECTORS = [0, 0.31, 0.665];
  // sample: one marshal zone around T15 (the collision) shows yellow; every other zone green or none
  const YELLOW_ZONES = [[apexF[14] - 0.035, apexF[14] + 0.03]];

  const map = ({ cols, rows, turns = true, codes = true, ghosts = true, incident = true, v = REC_GHOST, flags = true, blueCars = ['BOR'], blueMark = REC_BLUE }) => {
    const W = (cols + 2) * CELL_W, H = rows * CELL_H;
    const xs = POLY.map((p) => p[0]), ys = POLY.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const padPx = turns ? 34 : 18;
    const s = Math.min((W - 2 * padPx) / (x1 - x0), (H - 2 * padPx) / (y1 - y0));
    const ox = (W - s * (x1 - x0)) / 2, oy = (H - s * (y1 - y0)) / 2;
    const P = ([u, v]) => [ox + (u - x0) * s, oy + (v - y0) * s];
    const big = cols > 40;
    const unit = (dx, dy) => { const l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };
    const inward = (q) => unit(centroid[0] - q[0], centroid[1] - q[1]);
    // Labels never overlap each other or a dot: each tries its preferred side, then the other, then further out.
    const boxes = [];
    const hits = (x, y, w) => boxes.some((b) => Math.abs(b.x - x) < (b.w + w) / 2 + 2 && Math.abs(b.y - y) < (b.line ? 8 : 13));
    const label = (text, x, y, [ux, uy], fill, bold = false) => {
      const w = text.length * (FONT_PX - 2) * 0.6;
      for (const d of [14, 22, 32, 44, 58, 72]) for (const [vx, vy] of [[ux, uy], [-ux, -uy], [uy, -ux], [-uy, ux]]) {
        const [lx, ly] = [x + vx * d, y + vy * d];
        if (lx - w / 2 < 2 || lx + w / 2 > W - 2 || ly < 12 || ly > H - 6) continue;
        if (!hits(lx, ly, w)) { boxes.push({ x: lx, y: ly, w }); return `<text class="s" x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="middle" fill="${fill}" ${bold ? 'font-weight="700"' : ''}>${text}</text>`; }
      }
      return '';
    };
    let svg = `<svg width="${W}" height="${H}">`;
    svg += `<polyline points="${pts.map((p) => P(p).map((q) => q.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="${R.textFaint}" stroke-width="${big ? 3 : 2}" stroke-linejoin="round"/>`;
    // marshal zones (trackPositions.cars zones): a yellow zone redraws its stretch of the outline in flagYellow
    if (flags) for (const [a, b] of YELLOW_ZONES) {
      const zp = Array.from({ length: 41 }, (_, k) => P(at(a + ((b - a) * k) / 40)).map((q) => q.toFixed(1)).join(','));
      svg += `<polyline points="${zp.join(' ')}" fill="none" stroke="${R.flagYellow}" stroke-width="${big ? 4 : 3}" stroke-linecap="round"/>`;
    }
    const carDots = carsOnTrack.map((car) => { const q = at(car.f); const [cx, cy] = P(q); return { car, q, cx, cy: car.inPit ? cy - 9 : cy }; });
    for (const d of carDots) boxes.push({ x: d.cx, y: d.cy, w: 10 });
    for (let k = 0; k < 400; k++) { const [tx, ty] = P(at(k / 400)); boxes.push({ x: tx, y: ty, w: 2, line: true }); }
    // turn labels: outside each bend (only from the turn file)
    if (turns) POLY.forEach((V, i) => {
      const mid = lerp(POLY[(i - 1 + n) % n], POLY[(i + 1) % n], 0.5);
      const [x, y] = P(at(apexF[i]));
      svg += label(`T${i + 1}`, x, y, unit(V[0] - mid[0], V[1] - mid[1]), R.textFaint);
    });
    // start line and sector starts
    SECTORS.forEach((f, i) => {
      const [a, b] = [P(at(f - 0.002)), P(at(f + 0.002))];
      const [nx, ny] = unit(-(b[1] - a[1]), b[0] - a[0]);
      const [cx, cy] = P(at(f));
      svg += `<line x1="${cx - nx * 7}" y1="${cy - ny * 7}" x2="${cx + nx * 7}" y2="${cy + ny * 7}" stroke="${i === 0 ? R.text : R.textDim}" stroke-width="2"/>`;
      if (big) svg += label(`S${i + 1}`, cx, cy, inward(at(f)), R.textDim);
    });
    if (incident) {
      const q = at(apexF[14]);
      const [cx, cy] = P(q);
      svg += `<polygon points="${cx},${cy - 9} ${cx + 8},${cy + 5} ${cx - 8},${cy + 5}" fill="none" stroke="${R.warning}" stroke-width="2"/>`;
      boxes.push({ x: cx, y: cy, w: 16 });
      if (big) svg += label('collision', cx, cy, inward(q), R.warning);
    }
    for (const { car, q, cx, cy } of carDots) {
      const own = OURS.has(car.code);
      svg += car.inPit ? `<circle cx="${cx}" cy="${cy}" r="4" fill="none" stroke="${colourOf(car.code)}" stroke-width="1.5"/>` : `<circle cx="${cx}" cy="${cy}" r="${own ? 5.5 : 4}" fill="${colourOf(car.code)}"/>`;
      const blue = flags && blueCars.includes(car.code);
      if (blue && blueMark === 'ring') svg += `<circle cx="${cx}" cy="${cy}" r="${(own ? 5.5 : 4) + 3.5}" fill="none" stroke="${R.flagBlue}" stroke-width="2"/>`;
      if (blue && blueMark === 'tick') svg += `<line x1="${cx + (own ? 9 : 8)}" y1="${cy - 6}" x2="${cx + (own ? 9 : 8)}" y2="${cy + 6}" stroke="${R.flagBlue}" stroke-width="3"/>`;
      const showCode = own || codes || (blue && blueMark === 'code');
      if (showCode) svg += label(car.code, cx, cy, inward(q), blue && blueMark === 'code' ? R.flagBlue : own ? R.ownCar : R.textFaint, own || (blue && blueMark === 'code'));
    }
    if (ghosts) for (const c of CONDITIONS) {
      const g = GHOST_STYLES[v];
      const f = ghostF(c);
      const q = at(f);
      const [cx, cy] = P(q);
      const op = g.opacity < 1 ? ` opacity="${g.opacity}"` : '';
      if (g.marker === 'tick') {
        const [a, b] = [P(at(f - 0.002)), P(at(f + 0.002))];
        const [nx, ny] = unit(-(b[1] - a[1]), b[0] - a[0]);
        const h = big ? 8 : 6;
        svg += `<line x1="${cx - nx * h}" y1="${cy - ny * h}" x2="${cx + nx * h}" y2="${cy + ny * h}" stroke="${g.colour(c)}" stroke-width="2"/>`;
      } else svg += `<circle cx="${cx}" cy="${cy}" r="${big ? 5 : 4}" fill="none" stroke="${g.colour(c)}" stroke-width="1.5"${op}/>`;
      boxes.push({ x: cx, y: cy, w: 10 });
      if (big) svg += label(LETTER[c], cx, cy, inward(q).map((x) => -x), g.colour(c)).replace('<text', `<text${op}`);
    }
    return svg + '</svg>';
  };
  const mapPanel = (o) => panel('Track map', { cols: o.cols, rows: o.rows, link: '', state: o.state ?? '', svg: map(o), svgRows: o.rows });
  mapPanelShared = mapPanel;

  // ---- incident feed with the turn (existing widget: what column 18 wide; detail = turn when known, else the sector)
  const FEED_W = [3, 7, 18, 10];
  const feedLine = (cells) => ' ' + cells.map((t, i) => (i < FEED_W.length && i < cells.length - 1 ? padR(t, FEED_W[i]) : t)).join('  ');
  const feedRows = (turns) => [
    ['', ['L23', 'OCO STR', `collision ${turns ? 'T15' : 'S3'}`, 'lost 3.8 s', 'us —, OCO +22.4→+26.2']],
    ['', ['L22', 'GAS', `time loss ${turns ? 'T6' : 'S1'}`, 'lost 2.1 s', 'us —, GAS +14.7→+12.6']],
    ['d', ['L21', 'ALO', 'warning 1/3', '', '']],
    ['d', ['L09', 'VSC', 'neutralised', '', '']],
    ['', ['L09', 'TSU', 'retirement', '', 'us P7→P6']],
  ];
  const feed = (turns) => panel('Incidents', { cols: 70, rows: 5, link: '', lines: feedRows(turns).map(([c, cells]) => span(c, feedLine(cells).trimEnd())) });
  const feedCompact = (turns) => panel('Incidents', { cols: 34, rows: 3, link: '', lines: feedRows(turns).slice(0, 3).map(([c, cells]) => span(c, feedLine(cells.slice(0, 3)).trimEnd())) });

  page('2-map-views.html', '2 · Track map and the incident feed\'s turn', `
<div class="note">The outline is the analysis's centreline (<code>trackPositions.geometry</code>); here a sketch, not Silverstone's real shape, so the turn places are illustrative. <b>Turn labels come only from the turn file</b> (the corner's <code>turn</code>); a track without one shows no turn labels, the sectors stay. Rivals are dots in their team colour (Q7 B), our cars white and larger. The ghosts are B (faint rings with the condition letter). The amber triangle is a major incident of the last 2 laps, labelled with its kind (Q8 B; OCO and STR collided at T15). <b>Flags (new Q16):</b> the marshal zone around T15 shows yellow, so its stretch of the outline is drawn in the flag yellow; BOR is being shown blue, marked with ${BLUE_MARKS[REC_BLUE]} (recommended). DOO is in the pit lane (hollow). The white tick is the start line; the grey ticks are the sector starts.</div>
<h2>Track map: full 64×20, compact 32×10</h2>
<div class="row">${fig(mapPanel({ cols: 64, rows: 20 }), 'full · Silverstone (turn file): T1–T18, codes for every car, the three ghosts with their letter')}${fig(mapPanel({ cols: 32, rows: 10, turns: false, codes: false }), 'compact · no turn labels, no rival codes; ghosts without letters; the yellow zone and the blue ring stay')}</div>
<div class="row" style="margin-top:12px">${fig(mapPanel({ cols: 64, rows: 20, turns: false, state: 'Silverstone (Reverse)' }), 'no turn file (a reverse layout): no turn labels; the sectors stay')}${fig(mapPanel({ cols: 32, rows: 10, turns: false, codes: false, ghosts: false, incident: false }), 'rejoin unknown: no ghosts')}</div>
<div class="note">Realism: positions stay visible (a real team has GPS). Before the first full lap the geometry is <code>unknown</code> and the panel says "no data yet". The incident marker uses the topic's new <code>point</code> (Q8 B).</div>
<h2>Incident feed (V35) with the official turn: full 70×5, compact 34×3 (existing sizes)</h2>
<div class="row">${fig(feed(true), 'Silverstone (turn file): the turn replaces the sector in the what column (collision T15, time loss T6)')}${fig(feed(false), 'no turn file: the sector stays (collision S3, time loss S1), as today')}</div>
<div class="row" style="margin-top:12px">${fig(feedCompact(true), 'compact · with the turn')}</div>`);
}

// ================================================================ page 3: call cards (undercut, SC, pit sweep)
// The undercut card's highlight is open (new Q9, page 6): "our undercut is possible" (positive margin, AHEAD row) and
// its mirror "their undercut on us is possible" (positive margin, BEHIND row). Page 3 shows REC_UC.
const UC_HL = Object.fromEntries(Object.keys(OPPORTUNITY).map((k) => [k, { name: k, cell: (ahead) => (ahead ? `opp-${k}` : 'wm') }]));
const REC_UC = REC_OPP;
let undercutShared; // page 6 draws the card in each highlight variant
{
  // ---- undercut-card (undercut.car)
  const UNDERCUT = [
    { side: 'AHEAD', code: 'HAM', gap: -2412, delta: [1100, 2300, 3200], margin: [-1300, -100, 800], stopDue: false },
    { side: 'BEHIND', code: 'RUS', gap: 1304, delta: [900, 1900, 2700], margin: [-400, 600, 1400], stopDue: false },
    { side: 'BEHIND', code: 'ALO', gap: 4877, delta: [1400, 3000, 4400], margin: [-3500, -1900, -500], stopDue: true },
  ];
  const sec1 = (ms) => FMT.signedSeconds(ms, 1);
  const N = (h) => ({ h, w: 4, a: 'r' });
  const ucSpec = [{ h: '', w: 6, a: 'l' }, { h: 'DRV', w: 3, a: 'l' }, { h: 'GAP', w: 6, a: 'r' }, N('1'), N('2'), N('3'), { h: '', w: 0, a: 'l' }, N('1'), N('2'), N('3'), { h: 'STOP', w: 4, a: 'l' }];
  const row = (r, hl, { unknown = false, full = true } = {}) => {
    const ahead = r.side === 'AHEAD';
    const h = UC_HL[hl];
    const lit = r.margin.some((m) => m > 0) && !unknown;
    const margins = unknown ? r.margin.map(() => U('insufficientData')) : r.margin.map((m) => (m > 0 ? C(sec1(m), h.cell(ahead)) : sec1(m)));
    const side = lit && h.side ? C(r.side, h.side(ahead)) : r.side;
    const head = [side, r.code, FMT.gap(r.gap)];
    const cells = full ? [...head, ...(unknown ? r.delta.map(() => U('insufficientData')) : r.delta.map(sec1)), '', ...margins, r.stopDue ? 'due' : ''] : [...head, '', ...margins];
    return { cls: lit && h.row ? h.row(ahead) : '', cells };
  };
  const ucGroup = span('f', ' ' + sp(6 + 1 + 3 + 1 + 6 + 1) + padR('GAIN, n LAPS', 14) + '  ' + 'MARGIN, n LAPS');
  const undercut = (hl = REC_UC, unknown = false) => panel('Undercut', { cols: 58, rows: 5, lines: [ucGroup, ...table(ucSpec, UNDERCUT.map((r, i) => row(r, hl, { unknown: unknown && i === 2 })))] });
  const ucCSpec = [ucSpec[0], ucSpec[1], ucSpec[2], ucSpec[6], ucSpec[7], ucSpec[8], ucSpec[9]];
  const undercutCompact = (hl = REC_UC) => panel('Undercut', { cols: 36, rows: 4, lines: [span('f', ' ' + sp(19) + 'MARGIN, n LAPS'), ...table(ucCSpec, UNDERCUT.slice(0, 2).map((r) => row(r, hl, { full: false })))] });
  undercutShared = { undercut, undercutCompact };

  // ---- sc-card (scCall.car)
  const SC = { sc: { position: 9, gain: 10500, alsoGain: ['ALO', 'HAM'] }, vsc: { position: 10, gain: 7200, alsoGain: ['HAM'] } };
  const gainCell = (c) => V(FMT.signedSeconds(SC[c].gain, 1), PIT_LOSS[c].source, 'stops');
  const greenLine = (cols) => {
    const part = (c) => { const g = gainCell(c); return `${padR(TEXT.condition[c], 3)} ${padL(FMT.position(SC[c].position), 3)}  ${span('f', 'gain')} ${span('', g.t, g.tip)}`; };
    return panel('SC / VSC call', { cols, rows: cols > 40 ? 4 : 2, lines: [` ${span('d', 'if')} ${part('sc')}  ${span('f', '·')}  ${part('vsc')}`] });
  };
  const greenCompact = panel('SC / VSC call', { cols: 34, rows: 2, lines: [` ${span('d', 'if')} SC P9 ${span('', gainCell('sc').t, gainCell('sc').tip)}  ${span('f', '·')}  VSC P10 ${span('', gainCell('vsc').t, gainCell('vsc').tip)}`] });
  const scSpec = [{ h: '', w: 3, a: 'l' }, { h: 'REJOIN', w: 6, a: 'r' }, { h: 'LOSS', w: 5, a: 'r' }, { h: 'GAIN', w: 6, a: 'r' }, { h: 'ALSO GAIN', w: 15, a: 'l' }];
  const sheet = (active) => panel('SC / VSC call', {
    cols: 50, rows: 4, state: span('y', `${TEXT.condition[active]} out`),
    lines: table(scSpec, ['sc', 'vsc'].map((c) => {
      const cls = c === active ? 'hi' : '';
      const loss = V(FMT.seconds(PIT_LOSS[c].lossMs, 1), PIT_LOSS[c].source, 'stops', cls);
      const gain = gainCell(c); gain.c = cls;
      return { cells: [C(TEXT.condition[c], cls), C(FMT.position(SC[c].position), cls), loss, gain, C(SC[c].alsoGain.join(' '), cls)] };
    })),
  });
  const sheetCompact = (active) => panel('SC / VSC call', {
    cols: 34, rows: 2, state: span('y', `${TEXT.condition[active]} out`),
    lines: table(scSpec.slice(0, 4), [{ cells: [C(TEXT.condition[active], 'hi'), C(FMT.position(SC[active].position), 'hi'), V(FMT.seconds(PIT_LOSS[active].lossMs, 1), PIT_LOSS[active].source, 'stops', 'hi'), { ...gainCell(active), c: 'hi' }] }]).concat([` ${span('f', 'also gain')} ${SC[active].alsoGain.join(' ')}`]).slice(1),
  });

  // ---- pit-sweep-table (pitSweep.car, params compound)
  const SWEEP = {
    H: [[24, 12, ['OCO', 'STR'], 4724600, 7, false], [25, 12, ['OCO'], 4723100, 7, false], [26, 11, ['HUL', 'OCO'], 4722000, 6, false], [27, 11, ['HUL'], 4721700, 6, false], [28, 11, [], 4722300, 6, false], [29, 10, ['HAD'], 4723500, 6, false], [30, 10, ['HAD', 'HUL'], 4725200, 7, false]],
    M: [[24, 12, ['OCO', 'STR'], 4722900, 6, true], [25, 12, ['OCO'], 4721800, 6, true], [26, 11, ['HUL', 'OCO'], 4721100, 6, true], [27, 11, ['HUL'], 4721000, 6, true], [28, 11, [], 4721600, 6, false], [29, 10, ['HAD'], 4722800, 6, false], [30, 10, ['HAD', 'HUL'], 4724700, 7, false]],
  };
  const swSpec = [{ h: 'LAP', w: 3, a: 'l' }, { h: 'REJOIN', w: 6, a: 'r' }, { h: 'TRAFFIC', w: 11, a: 'l' }, { h: 'FINISH', w: 6, a: 'r' }, { h: 'POS', w: 3, a: 'r' }, { h: 'LIFE', w: 4, a: 'l' }];
  // finishDeltaMs (Q10 A): the analysis delivers it; here derived from the sample race times
  const bestOf = (k) => Math.min(...SWEEP[k].map((r) => r[3]));
  const selector = (sel) => ` ${span('f', 'NEXT')}  ${['H', 'M'].map((k) => (k === sel ? span('sel', k) : span('d', k))).join('  ')}`;
  const sweepRow = ([lap, pos, traffic, finish, fpos, over], unknown, best) => ({
    cells: [FMT.lapNumber(lap), FMT.position(pos), traffic.join(' '), unknown ? U('insufficientData') : FMT.signedSeconds(finish - best, 1), unknown ? U('insufficientData') : FMT.position(fpos), over ? C('over', 'w') : ''],
  });
  const sweep = (k, { unknown = false } = {}) => panel('Pit sweep', { cols: 40, rows: 10, lines: [selector(k), ...table(swSpec, SWEEP[k].map((r) => sweepRow(r, unknown, bestOf(k))))] });
  const swCSpec = [swSpec[0], swSpec[1], swSpec[4], swSpec[5]];
  const sweepCompact = (k) => panel('Pit sweep', { cols: 24, rows: 7, lines: [selector(k), ...table(swCSpec, SWEEP[k].slice(0, 5).map(([lap, pos, , , fpos, over]) => ({ cells: [FMT.lapNumber(lap), FMT.position(pos), FMT.position(fpos), over ? C('over', 'w') : ''] })))] });

  page('3-call-cards.html', '3 · Call cards: undercut, SC/VSC, pit sweep (V13, V18, V15)', `
<div class="note">Numbers only, no verdicts: no card says "box", "undercut works" or "stay out". <b>White bold</b> = relevant now (SP3), <b>amber</b> = advisory. Source badges as on page 4: no mark = measured this session, ˢ = stored from earlier sessions, ᵈ = community default; the hover names it.</div>
<h2>Undercut card (V13): full 58×5, compact 36×4</h2>
<div class="row">${fig(undercut(), 'full · one row per neighbour within 5 s · GAIN n = what the car that stops first gains over the other when the other stops n laps later · MARGIN = gain minus the absolute gap · a positive margin is bold in colour: the proposed <code>opportunity</code> hue on the AHEAD row (our undercut on HAM; candidate ' + REC_UC + ', page 6), amber on a BEHIND row (RUS\'s undercut on us) · ALO past its tyre life: STOP due')}</div>
<div class="row" style="margin-top:12px">${fig(undercutCompact(), 'compact · margins only, the nearest car ahead and behind')}${fig(undercut(REC_UC, true), 'unknown · ALO\'s model is missing: its gains and margins are empty ("too few laps or samples yet")')}</div>
<div class="note">Realism: a rival whose wear is hidden still gets gains from the age basis; the card looks the same. The hue of <code>opportunity</code> is open: page 6, new Q9.</div>
<h2>SC / VSC call (V18): full 50×4, compact 34×2</h2>
<div class="row">${fig(greenLine(50), 'green running · one line: if an SC came now we rejoin P9 and gain 10.5 s against a green stop; under a VSC P10, +7.2 s · the gains rest on the SC default and the VSC stored loss (ᵈ, ˢ)')}${fig(greenCompact, 'compact · the same, without the words')}</div>
<div class="row" style="margin-top:12px">${fig(sheet('sc'), 'SC out · the sheet: the SC row white bold, the cars within the window who would also gain · hover on 9.8ᵈ: "default · community value, Silverstone (R3)"')}${fig(sheet('vsc'), 'VSC out · the VSC row white bold')}${fig(sheetCompact('sc'), 'compact · SC out: the active option and who else gains')}</div>
<h2>Pit sweep (V15): full 40×10, compact 24×7</h2>
<div class="row">${fig(sweep('H'), 'full · next compound H (selected, white underlined) · one row per stop lap to the end of the window (L30) · REJOIN = position at pit exit · TRAFFIC = cars within 1.35 s in the first 3 laps · FINISH = the projected finish against the fastest row (<code>finishDeltaMs</code>, Q10 A), with no further stop · POS the position at the flag')}${fig(sweep('M'), 'next compound M · a stint to the flag beyond the medium\'s life: LIFE "over" (amber)')}</div>
<div class="row" style="margin-top:12px">${fig(sweepCompact('M'), 'compact · LAP, REJOIN, POS, LIFE')}${fig(sweep('H', { unknown: true }), 'unknown · the forecast lacks a model for a car: finish delta and position empty')}</div>
<div class="note">The selector's options are the next compounds of <code>pitWindow.car</code> (Q11 A).</div>`);
}

// ================================================================ page 4: longrun views (pit-loss table, stint scatter, raising average, lap overview)
{
  // ---- pit-loss-table (pitLosses.track)
  const plSpec = [{ h: 'COND', w: 5, a: 'l' }, { h: 'LOSS', w: 5, a: 'r' }, { h: 'STAT', w: 4, a: 'r' }, { h: 'N', w: 2, a: 'r' }, { h: 'SOURCE', w: 8, a: 'l' }];
  const condRows = CONDITIONS.map((c) => {
    const p = PIT_LOSS[c];
    const dim = p.source.kind === 'default' ? 'd' : '';
    return { cells: [C(TEXT.condition[c], dim), C(FMT.seconds(p.lossMs, 1), dim, sourceHover(p.source, 'stops')), p.stationaryMs === null ? U('insufficientData') : C(FMT.seconds(p.stationaryMs, 1), dim), C(String(p.source.samples), dim), C(p.source.kind, dim, sourceHover(p.source, 'stops'))] };
  });
  const stSpec = [{ h: 'LAP', w: 3, a: 'l' }, { h: 'DRV', w: 3, a: 'l' }, { h: 'COND', w: 5, a: 'l' }, { h: 'LOSS', w: 5, a: 'r' }, { h: 'STAT', w: 4, a: 'r' }];
  const stopRows = STOPS.map(([code, lap, loss, stat]) => ({ cls: OURS.has(code) ? 'me' : '', cells: [FMT.lapNumber(lap), code, TEXT.condition.green, FMT.seconds(loss, 1), FMT.seconds(stat, 1)] }));
  const pitLoss = panel('Pit loss', { cols: 32, rows: 13, link: '', state: 'Silverstone', lines: [...table(plSpec, condRows), '', span('f', ' THIS SESSION, NEWEST FIRST'), ...table(stSpec, stopRows)] });
  const pitLossCompact = panel('Pit loss', { cols: 18, rows: 3, link: '', lines: CONDITIONS.map((c) => { const p = PIT_LOSS[c]; const v = V(FMT.seconds(p.lossMs, 1), p.source, 'stops'); return ` ${padR(TEXT.condition[c], 5)} ${span('', padL(v.t, 5), v.tip)}`; }) });
  const tooltipDemo = `<pre> VSC   13.1${span('d', 'ˢ')}<span class="tooltip">stored · 3 stops</span>\n SC     9.8${span('d', 'ᵈ')}<span class="tooltip">default · community value, Silverstone (R3)</span></pre>`;

  // ---- stint-scatter (stintAnalysis.car)
  const kuhPoints = Array.from({ length: 23 }, (_, i) => {
    const lap = i + 1;
    const excluded = lap === 1 ? 'lap 1' : lap === 9 || lap === 10 ? 'VSC' : null;
    const corrected = lap === 1 ? 93800 : excluded ? 104000 : lap === 14 ? 91950 : 90950 + 55 * lap + noise(lap, 120);
    return { lap, age: lap, corrected, used: !excluded, excludedBy: excluded, downWeighted: lap === 14 };
  });
  const linPoints = [
    ...Array.from({ length: 15 }, (_, i) => ({ stint: 0, age: i + 1, corrected: i === 0 ? 93700 : i === 8 || i === 9 ? 104000 : i === 14 ? 99000 : 90600 + 85 * (i + 1) + noise(i + 3, 110), used: ![0, 8, 9, 14].includes(i) })),
    ...Array.from({ length: 8 }, (_, i) => ({ stint: 1, age: i + 1, corrected: i === 0 ? 108000 : 91350 + 38 * (i + 1) + noise(i + 9, 100), used: i !== 0 })),
  ];
  const scatter = ({ cols, rows, points, fits, compoundsTable, state, link = '1 · KUH' }) => {
    const yMin = 90400, yMax = 92800;
    const svg = chart({
      cols, rows: rows - (compoundsTable ? compoundsTable.length : 0),
      x: { min: 0, max: 24, ticks: [0, 4, 8, 12, 16, 20, 24], fmt: String, label: cols > 50 ? 'tyre age, laps' : '' },
      y: { min: yMin, max: yMax, ticks: [90500, 91000, 91500, 92000, 92500], fmt: FMT.lapTimeTenths, label: cols > 50 ? 'fuel-corrected lap' : '' },
      margin: cols > 50 ? { l: 80, r: 74 } : { l: 58, r: 40, b: 22 },
      series: fits.map((f) => ({ pts: [[f.from, f.base + f.deg * f.from], [f.to, f.base + f.deg * f.to]], colour: f.colour, width: CHART.lineWidth, label: cols > 50 ? f.label : undefined, bold: f.current })),
      over: (X, Y) => {
        let s = '';
        for (const f of fits) s += `<polygon points="${X(f.from)},${Y(f.base + f.deg * f.from + f.sd)} ${X(f.to)},${Y(f.base + f.deg * f.to + f.sd)} ${X(f.to)},${Y(f.base + f.deg * f.to - f.sd)} ${X(f.from)},${Y(f.base + f.deg * f.from - f.sd)}" fill="${f.colour}" opacity="0.10"/>`;
        for (const p of points) {
          const off = p.corrected > yMax;
          const cy = off ? Y(yMax) + 6 : Y(p.corrected);
          const colour = p.stint === 0 ? R.textDim : R.ownCar;
          if (!p.used) s += `<circle cx="${X(p.age)}" cy="${cy}" r="3.5" fill="none" stroke="${R.textFaint}" stroke-width="1.2"/>`;
          else if (p.downWeighted) s += `<circle cx="${X(p.age)}" cy="${cy}" r="3.5" fill="none" stroke="${colour}" stroke-width="1.2" stroke-dasharray="1.5 1.5"/>`;
          else s += `<circle cx="${X(p.age)}" cy="${cy}" r="3" fill="${colour}"/>`;
        }
        return s;
      },
    });
    return panel('Stint scatter', { cols, rows, link, state, svg, svgRows: rows - (compoundsTable ? compoundsTable.length : 0), after: compoundsTable ?? [] });
  };
  const COMPOUNDS = [
    ['S', 0, 85, 18, 14, { kind: 'measured', samples: 14 }],
    ['M', 412, 55, 9, 41, { kind: 'measured', samples: 41 }],
    ['H', 780, 38, 15, 0, { kind: 'default', samples: 0, note: 'community value, Silverstone (R3)' }],
  ];
  const cfSpec = [{ h: 'CMP', w: 3, a: 'l' }, { h: 'TO SOFT', w: 7, a: 'r' }, { h: 'DEG/LAP', w: 7, a: 'r' }, { h: 'SD', w: 5, a: 'r' }, { h: 'LAPS', w: 4, a: 'r' }, { h: 'SOURCE', w: 8, a: 'l' }];
  const compoundsTable = table(cfSpec, COMPOUNDS.map(([cmp, off, deg, sd, laps, src]) => {
    const dim = src.kind === 'default' ? 'd' : '';
    return { cells: [C(cmp, dim), C(FMT.signedSeconds(off, 3), dim), C(FMT.signedSeconds(deg, 3), dim), C(FMT.seconds(sd, 3), dim), C(String(laps), dim), C(src.kind, dim, sourceHover(src, 'laps'))] };
  }));
  const kuhFit = [{ from: 1, to: 23, base: 90950, deg: 55, sd: 150, colour: R.ownCar, label: 'M L01–', current: true }];
  const linFits = [{ from: 1, to: 15, base: 90600, deg: 85, sd: 160, colour: R.textDim, label: 'S L01–15' }, { from: 1, to: 8, base: 91350, deg: 38, sd: 140, colour: R.ownCar, label: 'H L16–', current: true }];

  // ---- raising-average-chart (raisingAverage.car, one topic per car)
  const ra = (best, slope, curve, k) => Array.from({ length: 18 }, (_, i) => [i + 1, best + slope * i + curve * i * i + (i ? noise(i + k, 8) : 0)]);
  const raCars = [
    { code: 'HAM', pts: ra(90350, 18, 0.6, 1) }, { code: 'RUS', pts: ra(90610, 22, 1.0, 2) },
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

  // ---- lap-overview-grid (lapOverview.car)
  const heatBg = (h) => { const a = [0x14, 0x14, 0x16], b = [0x5c, 0x60, 0x68]; return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * h)).join(',')})`; };
  const linLaps = [96100, 91300, 91000, 90900, 91100, 91000, 91300, 91200, 103400, 104000, 91500, 91600, 91900, 92200, 99700, 111200, 91000, 90800, 90700, 90900, 90600, 90800, 90900].map((ms, i) => {
    const lap = i + 1;
    const stint = lap <= 15 ? 1 : 2;
    const kind = lap === 15 ? 'in' : lap === 16 ? 'out' : 'normal';
    const status = lap === 9 || lap === 10 ? 'vsc' : 'green';
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
    const body = `<span${cls ? ` class="${cls}"` : ''} style="${l.heat !== undefined ? `background:${heatBg(l.heat)}` : ''}">${t}</span>`;
    return body + span('f', MARK[l.kind]);
  };
  const gridLines = (laps) => {
    const out = [];
    let row = [];
    let rowStart = null;
    const flush = () => {
      if (!row.length) return;
      out.push(` ${span('f', FMT.lapNumber(rowStart, 2))} ${row.map(lapCell).join(' ')}`);
      const strip = row.map((l) => (l.status === 'green' ? sp(7) : span('y', padR(TEXT.condition[l.status], 7)))).join(' ');
      if (row.some((l) => l.status !== 'green')) out.push(` ${sp(3)} ${strip}`);
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
  const lapOverview = panel('Lap overview', { cols: 84, rows: 7, link: '1 · LIN', lines: gridLines(linLaps) });
  const BLOCKS = '▁▂▃▄▅▆▇█';
  const kuhLaps = Array.from({ length: 23 }, (_, i) => {
    const lap = i + 1;
    const vsc = lap === 9 || lap === 10;
    return { lap, vsc, heat: lap === 1 || vsc ? undefined : lap === 20 ? 0 : Math.min(1, Math.max(0.05, 0.25 + 0.03 * lap + noise(lap, 0.25))), best: lap === 20 ? 'session' : 'none' };
  });
  const compactGrid = (laps, label) => panel('Lap overview', {
    cols: 30, rows: 3, link: '1 · KUH',
    lines: [
      span('f', ` ${label}`),
      ' ' + laps.map((l) => (l.heat === undefined ? span('f', '·') : span(l.best === 'session' ? 'b' : l.best === 'personal' ? 'g' : '', BLOCKS[Math.round(l.heat * 7)]))).join(''),
      ' ' + laps.map((l) => (l.vsc ? span('y', '━') : ' ')).join(''),
    ],
  });

  page('4-longrun.html', '4 · Long-run views: pit loss, stint scatter, raising average, lap overview (V33, V07, V08, V09)', `
<div class="note">These read per-session analyses; in the <code>longrun</code> workbook they serve practice long runs, and the pit-loss table also the race. Same sample race (Silverstone, L23/52). Lap times to tenths in charts and grids (a proposed kit format, <code>1:30.4</code>); exact times on hover.</div>
<h2>The source badge (kit piece, spec 8.1, 8.3)</h2>
<div class="row">${fig(`<div class="panel" style="width:62ch">${tooltipDemo}</div>`, 'a value that rests on a prior carries one cell after it: none = measured this session, ˢ = stored (earlier sessions in scope), ᵈ = community default. Every such value has the hover (measured ones too: "measured · 6 stops"). The hover boxes are drawn here because a screenshot cannot hover.')}</div>
<h2>Pit-loss table (V33): full 32×13, compact 18×3</h2>
<div class="row">${fig(pitLoss, 'full · loss per condition with stationary time (STAT), sample count and source in words · the default row is muted (dim) · its stationary time is unknown ("too few laps or samples yet") · this session\'s stops newest first, our LIN white with the bar')}${fig(pitLossCompact, 'compact · the three losses with their badges')}</div>
<h2>Stint scatter (V07): full 72×16, compact 36×8</h2>
<div class="row">${fig(scatter({ cols: 72, rows: 16, points: kuhPoints, fits: kuhFit, compoundsTable, state: 'basis wear' }), 'full · KUH · fuel-corrected lap time over tyre age · used laps white dots · excluded laps faint rings (L1, the VSC laps L09–L10 pinned at the top edge: off scale) with the reason on hover · the slow outlier L14 is used but down-weighted (dotted ring, README Q12) · the fit with its band · the weekend compounds below (H default, muted)')}</div>
<div class="row" style="margin-top:12px">${fig(scatter({ cols: 72, rows: 12, points: linPoints, fits: linFits, state: 'basis age', link: '1 · LIN' }), 'full · LIN · two stints: the earlier one (S) grey, the current one (H) white · basis age: LIN\'s wear is hidden by his telemetry setting (restricted), so the fit runs on tyre age')}${fig(scatter({ cols: 36, rows: 8, points: kuhPoints, fits: kuhFit, state: '' }), 'compact · chart only, current stint')}</div>
<h2>Raising average (V08): full 60×14, compact 36×8</h2>
<div class="row">${fig(raising(60, 14), 'full · mean of the best n valid laps for n = 1…18 · flat = consistent · our cars white (LIN dashed), the chosen rivals in their team colour (README Q13)')}${fig(raising(36, 8), 'compact')}</div>
<h2>Lap overview (V09): full 84×7, compact 30×3</h2>
<div class="row">${fig(lapOverview, 'full · LIN · one block per lap, ten to a row, a new row per stint · the background is the heat within the stint (dark = its best pace lap, light = its worst) · laps outside the pace set (L1, in, out, VSC) dim without heat · i = in-lap, o = out-lap · green = personal best (L21), purple = session best · the yellow strip under the row marks VSC/SC laps')}</div>
<div class="row" style="margin-top:12px">${fig(compactGrid(kuhLaps, 'M  L01–L23'), 'compact · KUH · one cell per lap, the block height is the heat · · = no heat (L1, VSC) · purple = session best (L20) · the strip marks the VSC')}</div>
<div class="note">Realism: no field of these four displays is hidden for our own cars. For a rival the raising average needs only lap times (always visible).</div>`);
}

// ================================================================ page 5: weather views (forecast strip, crossover chart)
{
  const SAMPLES = [
    [0, 'lightCloud', 5, 34, 'flat', 21, 'flat'], [5, 'overcast', 10, 33, 'down', 21, 'flat'], [10, 'overcast', 20, 32, 'down', 20, 'down'], [15, 'overcast', 30, 31, 'down', 20, 'flat'],
    [30, 'lightRain', 45, 28, 'down', 19, 'down'], [45, 'lightRain', 60, 26, 'down', 18, 'down'], [60, 'heavyRain', 75, 24, 'down', 18, 'flat'],
  ];
  const FIRST_RAIN = 30;
  const fcSpec = [{ h: 'MIN', w: 6, a: 'l' }, ...SAMPLES.map(([o]) => ({ h: FMT.offsetMin(o), w: 6, a: 'r' }))];
  const hl = (o, t) => (o === FIRST_RAIN ? C(t, 'hi') : t);
  const strip = (approx) => panel('Forecast', {
    cols: 56, rows: 5, link: '', state: approx ? span('d', 'approximate') : '',
    lines: table(fcSpec, [
      { cells: ['SKY', ...SAMPLES.map(([o, w]) => hl(o, TEXT.sky[w]))] },
      { cells: ['RAIN %', ...SAMPLES.map(([o, , r]) => hl(o, String(r)))] },
      { cells: ['TRACK', ...SAMPLES.map(([, , , t, tt]) => FMT.temp(t) + TEXT.trend[tt])] },
      { cells: ['AIR', ...SAMPLES.map(([, , , , , a, at]) => FMT.temp(a) + TEXT.trend[at])] },
    ]),
  });
  const stripCompact = panel('Forecast', { cols: 34, rows: 2, link: '', state: span('d', 'approx.'), lines: [` ${span('f', 'now')} ${TEXT.sky.lightCloud} 5%  ${span('f', 'track')} 34° ${span('f', 'air')} 21°`, ` ${span('f', 'rain')} ${span('hi', '45% at +30 min')}`] });
  const stripNone = panel('Forecast', { cols: 34, rows: 2, link: '', lines: [` ${span('f', 'now')} clear 0%  ${span('f', 'track')} 41° ${span('f', 'air')} 26°`, ` ${span('f', 'rain')} ${span('tip', '              ', TEXT.unknown.notApplicable)}`] });

  // ---- crossover (crossover.field) at L34: rain since L30, the first inters from L32
  const slick = [[26, 90200], [27, 90100], [28, 90300], [29, 90400], [30, 91900], [31, 93600], [32, 95200], [33, 96800], [34, 98100]];
  const inter = [[32, 97400], [33, 96000], [34, 95300]];
  const DRY = 89412, L110 = 98353;
  const TYPE_ROLE = { slick: 'text', inter: 'series3', wet: 'series1' };
  const xover = (cols, rows) => panel('Crossover', {
    cols, rows, link: '', state: 'L34',
    lines: [
      ` ${span('f', 'US')} 109.3% ${span('f', 'of dry ref')} ${FMT.lapTime(DRY)}   ${span('f', 'PAYBACK')} ${span('m', FMT.laps(12.3))}`,
      ` ${span('f', 'FIRST FASTER')} GAS ${span('f', 'on')} ${span('ty-inter', 'inter')} ${span('f', 'in')} S2 ${span('f', 'on')} L33`,
    ],
    svg: chart({
      cols, rows: rows - 2,
      x: { min: 26, max: 34, ticks: [26, 28, 30, 32, 34], fmt: String, label: 'lap' },
      y: { min: 88500, max: 99500, ticks: [89000, 91000, 93000, 95000, 97000, 99000], fmt: FMT.lapTimeTenths, label: 'median lap' },
      margin: { l: 80, r: 74 },
      series: [
        { pts: slick, colour: R[TYPE_ROLE.slick], label: TEXT.tyreType.slick },
        { pts: inter, colour: R[TYPE_ROLE.inter], label: TEXT.tyreType.inter },
        { pts: [[26, L110], [34, L110]], colour: R.textDim, dash: CHART.dash, width: 1, label: '110%', labelColour: R.textDim },
        { pts: [[26, DRY], [34, DRY]], colour: R.textFaint, dash: [2, 3], width: 1, label: 'dry ref', labelColour: R.textFaint },
      ],
      bands: [],
    }),
    svgRows: rows - 2,
  });
  const xoverCompact = panel('Crossover', { cols: 40, rows: 3, link: '', state: 'L34', lines: [` ${span('f', 'US')} 109.3% ${span('f', 'of dry ref')} ${FMT.lapTime(DRY)}`, ` ${span('f', 'FIRST FASTER')} GAS ${span('ty-inter', 'inter')} S2 L33`, ` ${span('f', 'PAYBACK')} ${span('m', FMT.laps(12.3))}`] });
  const xoverDry = panel('Crossover', { cols: 40, rows: 3, link: '', state: 'L23', lines: [` ${span('f', 'US')} 100.6% ${span('f', 'of dry ref')} ${FMT.lapTime(DRY)}`, ` ${span('f', 'FIRST FASTER')} ${span('tip', sp(16), TEXT.unknown.notApplicable)}`, ` ${span('f', 'PAYBACK')} ${span('tip', sp(10), TEXT.unknown.notApplicable)}`] });

  page('5-weather.html', '5 · Weather: forecast strip and crossover chart (V19)', `
<div class="note">The forecast is the game's (<code>weather.forecast</code>), samples of this session only. The crossover chart is the field's median lap per tyre type. Tyre types are told apart by colour (slick grey, <span class="ty-inter">inter series3</span>, <span style="color:${R.series1}">wet series1</span>), which is the one place colour distinguishes here. No text says "switch now".</div>
<h2>Forecast strip: full 56×5, compact 34×2</h2>
<div class="row">${fig(strip(true), 'full · one column per sample (minutes from now) · the first sample at or above the rain threshold (+30, 45 %) white bold · ▲▼ = the game\'s trend · "approximate" = the game\'s accuracy flag')}${fig(stripCompact, 'compact · now, and the first rain')}${fig(stripNone, 'no rain in the forecast: first rain not applicable')}</div>
<h2>Crossover chart (V19): full 72×16, compact 40×3</h2>
<div class="row">${fig(xover(72, 16), 'full · L34, rain since L30 · slick median rising, inters from L32 · the 110 % line of the dry reference (README Q14) · our last lap as % of the dry reference · the first car on the other type faster in a sector · payback = pit loss / (our lap − the inter median): 12.3 laps')}</div>
<div class="row" style="margin-top:12px">${fig(xoverCompact, 'compact · the three numbers; payback bold as the card\'s main number (SP3: bold, normal grey)')}${fig(xoverDry, 'dry (L23): no other type faster, first faster and payback not applicable')}</div>`);
}

// ================================================================ page 0: workbooks
{
  const screen = (name, w, h, boxes) => {
    let s = `<div style="position:relative;width:${w}px;height:${h}px;background:${R.bg};border:1px solid ${R.border};display:inline-block;margin-right:20px;vertical-align:top">`;
    s += `<div style="position:absolute;left:0;top:0;right:0;height:18px;background:${R.bgBand};color:${R.textDim};font-size:11px;padding:0 6px;line-height:18px">${name} · top bar</div>`;
    const cw = 228, ch = 53;
    for (const [label, gx, gy, gw, gh, note] of boxes) {
      const cells = `${Math.floor(gw * cw)}×${Math.floor(gh * ch)}`;
      s += `<div style="position:absolute;left:${gx * w + 3}px;top:${18 + gy * (h - 18) + 3}px;width:${gw * w - 6}px;height:${gh * (h - 18) - 6}px;border:1px solid ${R.border};background:${R.bgRowBand};font-size:11px;line-height:1.3;padding:3px 5px;overflow:hidden"><span style="color:${R.text}">${label}</span> <span style="color:${R.textFaint}">${cells}</span><br><span style="color:${R.textFaint}">${note ?? ''}</span></div>`;
    }
    return s + '</div>';
  };
  const W24 = 684, H24 = 385, W14 = 480, H14 = 270;
  const strategyMain = [
    ['timing-tower', 0, 0, 0.38, 0.6, 'full, 20 rows'],
    ['crossing-order', 0, 0.6, 0.38, 0.4, 'full'],
    ['track-map', 0.38, 0, 0.3, 0.58, 'full, ghosts'],
    ['gap-chart', 0.68, 0, 0.32, 0.58, 'ghost lines'],
    ['undercut-card', 0.38, 0.58, 0.3, 0.2, 'full'],
    ['sc-card', 0.38, 0.78, 0.3, 0.22, 'full'],
    ['pit-sweep-table', 0.68, 0.58, 0.32, 0.42, 'full'],
  ];
  const strategySide = [
    ['forecast-strip', 0, 0, 0.5, 0.25, 'full'],
    ['tyre-life-bar', 0.5, 0, 0.5, 0.25, 'Q15 A'],
    ['corner-block', 0, 0.25, 0.5, 0.35, 'Q15 A'],
    ['fuel-gauge', 0.5, 0.25, 0.22, 0.35, 'Q15 A'],
    ['ers-budget', 0.72, 0.25, 0.28, 0.35, 'Q15 A'],
    ['alarm-list', 0, 0.6, 0.6, 0.4, 'Q15 A'],
    ['damage-card', 0.6, 0.6, 0.4, 0.4, 'Q15 A'],
  ];
  const longrunMain = [
    ['stint-scatter', 0, 0, 0.55, 0.6, 'full'],
    ['raising-average-chart', 0.55, 0, 0.45, 0.6, 'full'],
    ['lap-overview-grid', 0, 0.6, 0.55, 0.4, 'full'],
    ['timing-tower', 0.55, 0.6, 0.45, 0.4, '(Q15 A)'],
  ];
  const longrunSide = [
    ['pit-loss-table', 0, 0, 0.35, 1, 'full'],
    ['crossover-chart', 0.35, 0, 0.65, 0.65, 'full'],
    ['(free)', 0.35, 0.65, 0.65, 0.35, ''],
  ];
  page('0-layouts.html', '0 · Default workbooks strategy and longrun (spec 9)', `
<div class="note">Proportions on a 1920×1080 screen each; the 24" main monitor left, the 14" side monitor right. At 14 px a window holds about 228 × 53 character cells; each box shows its cells (cols × rows), so you can check them against the displays' minimum sizes. The 14" window will likely get its own font size (saved per window). Starting points: panels can be dragged and resized, and the workbook saves it. The existing <code>car</code>, <code>quali</code> and <code>race</code> stay as they are.</div>
<h2>strategy (the race, when a call is near)</h2>
<div>${screen('strategy main', W24, H24, strategyMain)}${screen('strategy side', W14, H14, strategySide)}</div>
<div class="q"><b>Main = every call and the race picture it needs</b>: the tower, where we would rejoin (crossing order, map, ghost lines), the undercut and SC cards and the pit sweep. <b>Side = the forecast, then car care</b>: the <code>race</code> workbook's car-care set there, so the side screen keeps one job in every race workbook (Q15 A, approved as a starting point).</div>
<h2>longrun (practice long runs, and the post-stint look in the race)</h2>
<div>${screen('longrun main', W24, H24, longrunMain)}${screen('longrun side', W14, H14, longrunSide)}</div>
<div class="q"><b>Main = our pace</b> (stint scatter, raising average, lap overview); <b>side = the knowledge it feeds</b> (pit loss, crossover). The timing tower on main keeps the rivals' pace in view (Q15 A).</div>`);
}
// ================================================================ page 6: options for new Q1 (the ghost's slot), new Q9 (the opportunity hue), new Q16 (blue flag)
{
  const SLOT_TEXT = {
    B: 'the baseline as answered: the ghost row in the faint text role, no line.',
    B1: 'two solid hairlines (faint, 1 px) above and below the ghost row: the row reads as a slot opened between the two cars.',
    B2: 'one solid hairline on top of the ghost row: the line marks where the ghost cuts in, under the car it would follow.',
    B3: 'one solid hairline under the ghost row: the faint row sits on a rule between the two cars.',
  };
  const slotRows = Object.keys(GHOST_STYLES).map((v) => `
<h2>${v} · ${GHOST_STYLES[v].name}${v === REC_GHOST ? ' (recommended)' : ''}</h2>
<div class="note">${SLOT_TEXT[v]}</div>
<div class="row">${fig(crossingFull({ v }), 'full · three conditions')}${fig(crossingCompact('green', '', v), 'compact · green')}${fig(crossingCompact('sc', span('y', 'SC'), v), 'compact · SC out')}</div>`).join('');
  const OPP_TEXT = {
    cyan: 'cyan #3fd8e8: the furthest from green and purple; lighter than the blue flag (#5ca8ff), so the two differ in brightness as well as hue.',
    teal: 'teal #2ec4b6: calmer, but close to the personal-best green (#3fcf70) for red-green colour blindness.',
    series6: 'the existing muted series6 (oklch 0.72 0.09 200): no new value, but too soft to be stronger than white bold.',
  };
  const oppRows = Object.keys(OPPORTUNITY).map((k) => `
<h2>${k}${k === REC_OPP ? ' (recommended)' : ''}</h2>
<div class="note">${OPP_TEXT[k]}</div>
<div class="row">${fig(undercutShared.undercut(k), 'full · HAM ahead: our undercut possible at n = 3 (the candidate) · RUS behind: theirs at n = 2, 3 (amber)')}${fig(undercutShared.undercutCompact(k), 'compact')}</div>`).join('');
  // the palette check: every colour that already means something, next to each candidate
  const sw = (label, colour, text, bold = true) => ` ${padR(label, 19)} <span style="color:${colour};${bold ? 'font-weight:700' : ''}">${text}</span>`;
  const palette = panel('Palette check', { cols: 46, rows: 9, link: '', lines: [
    sw('session best', R.best, '28.104  S1'), sw('personal best', R.personalBest, '41.311  S2'),
    ...Object.entries(OPPORTUNITY).map(([k, c]) => sw(`opportunity ${k}`, c, '+0.8    margin')),
    sw('blue flag', R.flagBlue, '●  BOR shown blue'), sw('advisory', R.warning, '+1.4    margin'), sw('critical', R.critical, '−0.7    laps'), sw('yellow flag', R.flagYellow, '━━  zone'),
  ] });
  const lapRow = (k) => panel('Side by side', { cols: 46, rows: 1, link: '', lines: [` S1 ${span('b', '28.104')}  S2 ${span('g', '41.311')}  MARGIN ${span(`opp-${k}`, '+0.8')} ${span('wm', '+1.4')}`] });
  const blueRows = Object.keys(BLUE_MARKS).map((k) => `
<h2>${k}${k === REC_BLUE ? ' (recommended)' : ''}</h2>
<div class="note">${BLUE_MARKS[k]}.</div>
<div class="row">${fig(mapPanelShared({ cols: 64, rows: 20, blueMark: k }), 'full · BOR shown blue; the yellow zone around T15')}${fig(mapPanelShared({ cols: 32, rows: 10, turns: false, codes: false, blueMark: k, blueCars: ['KUH'] }), 'compact · our car KUH shown blue')}</div>`).join('');
  page('6-options.html', '6 · Options: the ghost\'s slot (new Q1), the opportunity hue (new Q9), the blue flag (new Q16)', `
<div class="note">Round 3. The user chose B for the ghost and B (colour) for the undercut; this page shows the variants inside those answers, plus the new flags on the map. Each variant is shown in every place it applies, with the same sample race.</div>
<h2>New Q1 · B, and how it marks the slot</h2>
<div class="note">B stays the ghost's look: faint, our code plain, no glyph; the gap chart's faint lines (G dotted, VSC dashed, SC dash-dot, the letter at the end) and the map's faint rings are the same in every variant. The variants differ only in the crossing order: how the ghost row shows <b>where it slots in</b> between two cars, with solid 1 px hairlines in the faint role, no dashes and no leader dots. Every row keeps the exact columns of the real rows.</div>
${slotRows}
<h2>New Q9 · B (colour): the hue for "our undercut is possible"</h2>
<div class="note">A positive margin on an AHEAD row is bold in a new theme role, proposed name <code>opportunity</code>; on a BEHIND row it stays bold amber (<code>warning</code>). The hue must not clash with purple (session best), green (personal best), amber, red or the blue flag. The theme's series roles are muted (oklch 0.72, chroma 0.09) and read weaker than white bold, so the candidates are full-strength values except series6 for comparison.</div>
<div class="row">${fig(palette, 'every colour that already means something, next to each candidate')}${fig(lapRow(REC_OPP), 'the recommended candidate in one line with a purple and a green sector and the amber mirror')}</div>
${oppRows}
<h2>New Q16 · flags on the map</h2>
<div class="note"><b>Yellow:</b> a marshal zone that shows yellow redraws its stretch of the outline in <code>flagYellow</code> (the sample: the zone around T15). Green and no-flag zones stay grey. The game sends one yellow (<code>ZoneFlag</code>: unknown, none, green, blue, yellow), so there is no double yellow to show. <b>Blue:</b> a car being shown blue (its <code>fiaFlag</code>) gets a mark in <code>flagBlue</code>; the ways to mark it follow. Rivals in team colour, ghosts as B.</div>
${blueRows}`);
}
console.log('written');
