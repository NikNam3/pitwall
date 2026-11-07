// Generates the SP4.2 mockup of the new pit-window-strip display (brainstorm 2026-11-07): node gen.mjs
// Same method as the 2026-10-30 and 2026-11-06 sets: the real theme (imported from apps/ui/src/theme), the SP3 panel
// frame B, sizes in character cells. The full size is a chart (kit Chart look); the compact size is text in cells.
// Round 2: no sentences in the display; the shapes say what the text said.
import { writeFileSync } from 'node:fs';
import { DEFAULT_THEME, FONT_FAMILY } from '../../../apps/ui/src/theme/themes.ts';

// ---------------------------------------------------------------- theme (the real one)
const R = DEFAULT_THEME.roles;
const FONT_PX = DEFAULT_THEME.fontPx;
const LINE = DEFAULT_THEME.density.lineHeight;
const GAP = DEFAULT_THEME.density.columnGapCols;
const CELL_H = FONT_PX * LINE;
const CELL_W = (800 / 100 / 14) * FONT_PX; // JetBrains Mono's advance, measured in headless Chromium

// ---------------------------------------------------------------- formats (mirror kit/values/format.ts)
const pad0 = (n, w) => String(n).padStart(w, '0');
const FMT = {
  lapNumber: (n) => `L${pad0(n, 2)}`,
  /** proposed kit format: a lap range on one lap scale, `L22–31` */
  lapRange: (a, b) => `L${pad0(a, 2)}–${pad0(b, 2)}`,
  pct: (p) => `${Math.round(p)}%`,
};

// ---------------------------------------------------------------- wording (the widget's text.ts)
const TEXT = {
  title: 'Pit window',
  unknown: {
    insufficientData: 'too few laps on these tyres yet (3 needed)',
    notReceived: 'tyre sets not received yet',
  },
};

// ---------------------------------------------------------------- CSS from the theme (the 4.1b set's, trimmed)
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
.cap { color:var(--pw-textFaint); margin:4px 0 0; min-width:44ch; }
.d { color:var(--pw-textDim); } .f { color:var(--pw-textFaint); } .w { color:var(--pw-warning); font-weight:${DEFAULT_THEME.table.boldWeight}; }
.hi { color:var(--pw-ownCar); font-weight:${DEFAULT_THEME.table.boldWeight}; }
.band { background:var(--pw-bgRowBand); display:inline-block; width:100%; }
.tip { text-decoration:underline dotted var(--pw-textFaint); }
`;

// ---------------------------------------------------------------- HTML helpers (the 4.1b set's)
const strip = (s) => s.replace(/<[^>]+>/g, '');
const vis = (s) => [...strip(s)].length;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const span = (cls, t, tip) => (cls || tip ? `<span${cls ? ` class="${cls}"` : ''}${tip ? ` title="${esc(tip)}"` : ''}>${t}</span>` : t);
const sp = (n) => ' '.repeat(Math.max(0, n));
const padR = (s, n) => s + sp(n - vis(s));
const padL = (s, n) => sp(n - vis(s)) + s;
const GEAR = '<svg width="14" height="14" viewBox="0 0 14 14" style="display:inline;vertical-align:-2px"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="1.1" stroke-dasharray="2 1.4"/><circle cx="7" cy="7" r="2.1" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>';
const SIZES = [];
function panel(title, { cols, rows, link = '1 · KUH', state = '', lines = [], size }) {
  for (const l of lines) if (vis(l) > cols) throw new Error(`${title}: line wider than ${cols}: "${strip(l)}" (${vis(l)})`);
  if (rows !== undefined && lines.length > rows) throw new Error(`${title}: ${lines.length} rows, more than ${rows}`);
  if (size) SIZES.push(`${title} ${size}: ${cols}×${rows ?? lines.length}`);
  const fill = rows !== undefined ? rows - lines.length : 0;
  return `<div class="panel" style="width:${cols + 2}ch"><div class="ph"><span class="t">${title}</span><span class="lk">${link}</span><span class="sp"></span><span>${state}</span><span>${GEAR}</span></div><pre>${lines.join('\n')}</pre>${fill > 0 ? `<div style="height:${fill * CELL_H}px"></div>` : ''}</div>`;
}
const cap = (t) => `<div class="cap">${t}</div>`;
const fig = (p, c) => `<div>${p}${cap(c)}</div>`;
const page = (file, title, body) =>
  writeFileSync(new URL(file, import.meta.url), `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>${CSS}</style></head><body><h1>${title}</h1>${body}</body></html>\n`);

// ================================================================ the display
// pitWindow.car (sample values; the analysis delivers every number):
//   stint: the fitted set, its first lap and the lap it reaches its life (tyre-life);
//   sets[]: per available dry set that meets the compound rule: earliest (the first lap from which it reaches the flag),
//           latest (= the fitted set's life), and the lap its life ends when fitted at the latest.
// The display places laps on the race's lap axis; it computes nothing.
const LABEL_W = 3;   // cells: the compound letter
const RANGE_W = 7;   // cells: L23–31
const ROW_H = CELL_H;
const BAR = 6;       // px

// ---------------------------------------------------------------- label layout (round 5: the rules the display's layout.ts gets)
// Every lap label is a box in its row. Rules, in order:
//  1. labels sit on top of lines: each gets a knockout in its row's background, so a line (now, flag, a life line) breaks behind it;
//  2. a window's laps go left and right of its band; if either does not fit, both go together (`L23–31`) on the right, else on the left;
//  3. the fitted set's last lap goes right of its bar end, else left of it;
//  4. the axis: now first, then the flag, then the faint laps every 10; a later label that would touch an earlier one is dropped.
// A layout that still overlaps throws: the generator sweeps every lap of several races (see `sweep`), as the property test will.
const PAD = 4;      // px between a label and its bar
const GAP_PX = CELL_W; // between two labels
function layoutRow(cands, placed, lo, hi) {
  for (const group of cands) {
    const boxes = group.map((l) => ({ ...l, ...boxOf(l) }));
    if (boxes.every((b) => b.l >= lo && b.r <= hi && placed.every((p) => b.r + (p.bar ? PAD : GAP_PX) <= p.l || b.l >= p.r + (p.bar ? PAD : GAP_PX)))) { placed.push(...boxes); return true; }
  }
  return false;
}
const boxOf = (l) => { const w = vis(l.t) * CELL_W; return l.anchor === 'end' ? { l: l.x - w, r: l.x } : l.anchor === 'middle' ? { l: l.x - w / 2, r: l.x + w / 2 } : { l: l.x, r: l.x + w }; };

function chartSvg({ cols, now, flag, stint, sets, unknownLife }) {
  const W = (cols + 2) * CELL_W;
  const rows = 1 + sets.length;
  const H = rows * ROW_H + ROW_H; // + the axis row
  const lo = (LABEL_W + 0.5) * CELL_W, hi = W - 2;
  const x0 = (LABEL_W + 1) * CELL_W, x1 = W - 4 * CELL_W - PAD - 2; // room right of the flag for one lap label
  const Xe = (lap) => x0 + ((x1 - x0) * lap) / flag;               // the end of lap `lap`
  const Xs = (lap) => x0 + ((x1 - x0) * (lap - 1)) / flag;         // the start of lap `lap`
  const yMid = (r) => r * ROW_H + ROW_H / 2;
  const rowBg = (r) => (r >= 1 && r <= sets.length && (r - 1) % 2 === 0 ? R.bgRowBand : R.bgPanel);
  const labels = []; // { row, x, anchor, t, fill, bold, l, r }
  let s = `<svg width="${W}" height="${H}">`;
  const text = (x, y, t, fill, anchor = 'start', bold = false) => `<text x="${x}" y="${y + 4}" fill="${fill}" text-anchor="${anchor}"${bold ? ' font-weight="700"' : ''}>${t}</text>`;
  const rule = (xa, xb, y, colour = R.textFaint) => (xb > xa ? `<line x1="${xa}" x2="${xb}" y1="${y}" y2="${y}" stroke="${colour}" stroke-width="1"/>` : '');
  const need = (ok, what) => { if (!ok) throw new Error(`pit window L${now}/${flag}: no room for ${what}`); };
  sets.forEach((_, i) => { if (i % 2 === 0) s += `<rect x="0" y="${(i + 1) * ROW_H}" width="${W}" height="${ROW_H}" fill="${R.bgRowBand}"/>`; });
  // lines and bars first
  s += `<line x1="${Xe(flag)}" x2="${Xe(flag)}" y1="2" y2="${rows * ROW_H}" stroke="${R.textDim}" stroke-width="1"/>`;
  const r0 = yMid(0);
  s += text(CELL_W, r0, stint.letter, R.textDim);
  s += `<rect x="${Xs(stint.from)}" y="${r0 - BAR / 2}" width="${Xe(now) - Xs(stint.from)}" height="${BAR}" fill="${R.text}"/>`;
  const placed = rows + 1 ? Array.from({ length: rows + 1 }, () => []) : [];
  if (!unknownLife) {
    const over = now > stint.life;
    if (!over) s += `<rect x="${Xe(now) + 0.5}" y="${r0 - BAR / 2 + 0.5}" width="${Math.max(0, Xe(Math.min(stint.life, flag)) - Xe(now) - 1)}" height="${BAR - 1}" fill="none" stroke="${R.textDim}"/>`;
    else s += `<rect x="${Xe(stint.life)}" y="${r0 - BAR / 2}" width="${Xe(now) - Xe(stint.life)}" height="${BAR}" fill="${R.warning}"/>`;
    placed[0].push({ bar: true, l: Xs(stint.from), r: Math.max(Xe(Math.min(stint.life, flag)), Xe(now)) });
    if (stint.life < flag) {
      const end = Math.max(Xe(stint.life), Xe(now));
      const l = { row: 0, t: FMT.lapNumber(stint.life), fill: over ? R.warning : R.text, bold: over };
      need(layoutRow([[{ ...l, x: end + PAD, anchor: 'start' }], [{ ...l, x: Xs(stint.from) - PAD, anchor: 'end' }], [{ ...l, x: end - PAD, anchor: 'end' }]], placed[0], lo, hi), 'the fitted set\'s last lap');
    }
  } else {
    s += `<rect x="${Xe(now)}" y="${r0 - ROW_H / 2}" width="${x1 - Xe(now)}" height="${ROW_H}" fill="transparent"><title>${TEXT.unknown[unknownLife]}</title></rect>`;
    s += `<line x1="${Xe(now) + 4}" x2="${Xe(now) + 4 + 6 * CELL_W}" y1="${r0 + 7}" y2="${r0 + 7}" stroke="${R.textFaint}" stroke-dasharray="1 2"/>`;
  }
  sets.forEach((set, i) => {
    const row = i + 1, y = yMid(row);
    s += text(CELL_W, y, set.letter, R.textDim);
    if (set.lifeEnd < flag) {
      s += rule(Xe(set.latest), Xe(set.lifeEnd), y) + `<line x1="${Xe(set.lifeEnd)}" x2="${Xe(set.lifeEnd)}" y1="${y - 4}" y2="${y + 4}" stroke="${R.textFaint}"/>`;
      return;
    }
    const open = now >= set.earliest && now <= set.latest;
    const closed = now > set.latest;
    const fill = open ? R.ownCar : closed ? R.textFaint : R.text;
    const from = Math.max(set.earliest, now + 1);
    if (from <= set.latest) s += `<rect x="${Xs(from)}" y="${y - BAR / 2}" width="${Xe(set.latest) - Xs(from)}" height="${BAR}" fill="${open ? R.ownCar : R.textDim}"/>`;
    s += rule(Xe(set.latest), Xe(flag), y);
    const bandL = Xs(Math.min(set.earliest, from)), bandR = Xe(set.latest);
    const base = { row, fill, bold: open };
    const a = FMT.lapNumber(set.earliest), b = FMT.lapNumber(set.latest);
    const ab = set.earliest === set.latest ? b : FMT.lapRange(set.earliest, set.latest).replace(/–L/, '–');
    placed[row].push({ bar: true, l: bandL, r: bandR });
    need(layoutRow(set.earliest === set.latest ? [
      [{ ...base, t: b, x: bandR + PAD, anchor: 'start' }],
      [{ ...base, t: b, x: bandL - PAD, anchor: 'end' }],
    ] : [
      [{ ...base, t: a, x: bandL - PAD, anchor: 'end' }, { ...base, t: b, x: bandR + PAD, anchor: 'start' }],
      [{ ...base, t: ab, x: bandR + PAD, anchor: 'start' }],
      [{ ...base, t: ab, x: bandL - PAD, anchor: 'end' }],
    ], placed[row], lo, hi), `the ${set.letter} window`);
  });
  s += `<line x1="${Xe(now)}" x2="${Xe(now)}" y1="2" y2="${rows * ROW_H}" stroke="${R.ownCar}" stroke-width="1"/>`;
  // the axis: now, the flag, then every 10 laps; dropped when they touch
  const axis = placed[rows];
  const clampMid = (x, t) => Math.min(hi - (vis(t) * CELL_W) / 2, Math.max(lo + (vis(t) * CELL_W) / 2, x));
  const nowT = FMT.lapNumber(now);
  need(layoutRow([[{ row: rows, t: nowT, x: clampMid(Xe(now), nowT), anchor: 'middle', fill: R.ownCar, bold: true }]], axis, lo, hi), 'now');
  const flagT = FMT.lapNumber(flag);
  layoutRow([[{ row: rows, t: flagT, x: clampMid(Xe(flag), flagT), anchor: 'middle', fill: R.textDim }]], axis, lo, hi);
  for (let l = 10; l < flag; l += 10) layoutRow([[{ row: rows, t: FMT.lapNumber(l), x: (Xs(l) + Xe(l)) / 2, anchor: 'middle', fill: R.textFaint }]], axis, lo, hi);
  // labels last, each on a knockout in its row's background
  for (const row of placed) for (const l of row.filter((x) => !x.bar)) {
    s += `<rect x="${l.l - 2}" y="${l.row * ROW_H + 2}" width="${l.r - l.l + 4}" height="${ROW_H - 4}" fill="${rowBg(l.row)}"/>`;
    s += text(l.x, yMid(l.row), l.t, l.fill, l.anchor, l.bold);
  }
  return { svg: s + '</svg>', svgRows: rows + 1 };
}

function panelSvg(title, { cols, rows, link = '1 · KUH', state = '', svg, svgRows, size }) {
  if (size) SIZES.push(`${title} ${size}: ${cols}×${rows}`);
  const fill = rows - svgRows;
  return `<div class="panel" style="width:${cols + 2}ch"><div class="ph"><span class="t">${title}</span><span class="lk">${link}</span><span class="sp"></span><span>${state}</span><span>${GEAR}</span></div>${svg}${fill > 0 ? `<div style="height:${fill * CELL_H}px"></div>` : ''}</div>`;
}

const FULL_COLS = 46;
const full = (w, opts = {}) => panelSvg(TEXT.title, { cols: FULL_COLS, rows: 4, state: `${FMT.lapNumber(w.now)}/${w.flag}`, ...chartSvg({ cols: FULL_COLS, ...w }), ...opts });

function compactLines({ now, stint, sets, unknownLife }) {
  const lines = [];
  const label = (letter, rest) => `${span('d', letter)} ${padR(rest, 4)}`;
  if (unknownLife) lines.push(` ${label(stint.letter, '')} ${span('tip', sp(RANGE_W), TEXT.unknown[unknownLife])}`);
  else {
    const over = now > stint.life;
    lines.push(` ${label(stint.letter, '')} ${span(over ? 'w' : '', padL(FMT.lapNumber(stint.life), RANGE_W))}`);
  }
  for (const s of sets) {
    if (s.lifeEnd < 52) continue; // a set that cannot reach the flag has no window: no line in compact
    const open = now >= s.earliest && now <= s.latest;
    lines.push(` ${label(s.letter, '')} ${span(open ? 'hi' : now > s.latest ? 'f' : '', padL(FMT.lapRange(s.earliest, s.latest).replace(/–L/, '–'), RANGE_W))}`);
  }
  return lines;
}
const compact = (w, opts = {}) => panel(TEXT.title, { cols: 22, rows: 3, state: '', lines: compactLines(w), ...opts });

// ================================================================ the sample: Silverstone L23/52, KUH on mediums since L1
// Round 3: only new sets (user, 2026-11-07), one row per compound. H (earliest L23, life to the flag), S (fitted at L31 it lasts to L46).
// The second M set is left out: KUH started on M, the compound rule needs another dry compound.
const SETS = [
  { letter: 'H', earliest: 23, latest: 31, lifeEnd: 60 },
  { letter: 'S', earliest: 0, latest: 31, lifeEnd: 46 },
];
const STINT = { letter: 'M', from: 1, life: 31 };
const OPEN = { now: 23, flag: 52, stint: STINT, sets: SETS };
const AHEAD = { now: 15, flag: 52, stint: STINT, sets: SETS };
const OVER = { now: 33, flag: 52, stint: STINT, sets: SETS };
const NOSTOP = { now: 41, flag: 52, stint: { letter: 'H', from: 16, life: 55 }, sets: [] };
const EARLY = { now: 2, flag: 52, stint: { letter: 'M', from: 1 }, sets: [], unknownLife: 'insufficientData' };

page('pit-window.html', 'SP4.2 · pit-window-strip, round 5', `
<div class="note">Lap axis = the whole race, the flag a vertical line, <b>now</b> the white line. Top row: the fitted set, done laps solid, the rest of its life hollow. Below: one row per compound we still have a new set of (compound rule applied), its window solid (white when open now), then its life as a thin line. A line that stops short of the flag is a set that does not make it. No words in the panel.</div>
<h2>Full ${FULL_COLS}×4</h2>
<div class="row">${fig(full(OPEN, { size: 'full' }), 'L23, H new open')}${fig(full(AHEAD), 'L15')}</div>
<div class="row" style="margin-top:12px">${fig(full(OVER), 'L33, mediums past their life')}${fig(full({ ...NOSTOP }, { link: '1 · LIN' }), 'LIN L41, tyres reach the flag, rule met')}${fig(full(EARLY), 'L02, life still unknown, sets not received')}</div>
<h2>Compact 22×3</h2>
<div class="row">${fig(compact(OPEN, { size: 'compact' }), 'L23')}${fig(compact(OVER), 'L33')}</div>`);

// ================================================================ the sweep: every lap of several races through the layout rules
// Each scenario runs now = 1 … flag; the layout throws on any overlap. The page shows a sample of each.
const SCENARIOS = [
  { name: 'Monaco 78 laps, a one-lap window on the H, the S life ending one lap short', flag: 78, stint: { letter: 'M', from: 1, life: 44 }, sets: [{ letter: 'H', earliest: 44, latest: 44, lifeEnd: 90 }, { letter: 'S', earliest: 0, latest: 44, lifeEnd: 77 }] },
  { name: 'Silverstone 52 laps, a long window opening at L03', flag: 52, stint: { letter: 'S', from: 1, life: 24 }, sets: [{ letter: 'H', earliest: 3, latest: 24, lifeEnd: 70 }, { letter: 'M', earliest: 12, latest: 24, lifeEnd: 60 }] },
  { name: 'sprint 19 laps, a window at the flag', flag: 19, stint: { letter: 'M', from: 1, life: 17 }, sets: [{ letter: 'S', earliest: 10, latest: 17, lifeEnd: 25 }, { letter: 'H', earliest: 2, latest: 17, lifeEnd: 40 }] },
  { name: 'short race 5 laps', flag: 5, stint: { letter: 'S', from: 1, life: 4 }, sets: [{ letter: 'M', earliest: 1, latest: 4, lifeEnd: 12 }, { letter: 'H', earliest: 1, latest: 4, lifeEnd: 20 }] },
  { name: 'Spa 44 laps, life past the flag (no stop), second stint from L20', flag: 44, stint: { letter: 'H', from: 20, life: 60 }, sets: [] },
];
const sweepHtml = SCENARIOS.map((sc) => {
  for (let now = Math.max(1, sc.stint.from); now <= sc.flag; now++) chartSvg({ cols: FULL_COLS, now, flag: sc.flag, stint: sc.stint, sets: sc.sets }); // throws on overlap
  const shown = [...new Set([sc.stint.from, Math.round((sc.stint.from + sc.flag) / 3), Math.round(((sc.stint.from + sc.flag) * 2) / 3), sc.stint.life, sc.flag - 1, sc.flag].filter((l) => l >= sc.stint.from && l <= sc.flag))];
  return `<h2>${sc.name} · checked at every lap, shown at ${shown.map(FMT.lapNumber).join(', ')}</h2><div class="row">${shown.map((now) => fig(full({ now, flag: sc.flag, stint: sc.stint, sets: sc.sets }), FMT.lapNumber(now))).join('')}</div>`;
}).join('');
page('sweep.html', 'SP4.2 · pit-window-strip, layout sweep (round 5b)', `<div class="note">Every lap of five races run through the label rules; any overlap stops the generator. Lines break behind labels; a window that has no room for its two laps writes them together; the axis drops the flag or a 10-lap label before it touches now.</div>${sweepHtml}`);
console.log(SIZES.join('\n'));
