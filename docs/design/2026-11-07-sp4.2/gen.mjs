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

function chartSvg({ cols, now, flag, stint, sets, unknownLife }) {
  const W = (cols + 2) * CELL_W;
  const rows = 1 + sets.length;
  const H = rows * ROW_H + ROW_H; // + the axis row
  const x0 = (LABEL_W + 1) * CELL_W, x1 = W - (RANGE_W + 2) * CELL_W;
  const X = (lap) => x0 + ((x1 - x0) * (lap - 1)) / (flag - 1);   // the start of lap `lap`
  const Xe = (lap) => x0 + ((x1 - x0) * lap) / flag;               // the end of lap `lap`
  const Xs = (lap) => x0 + ((x1 - x0) * (lap - 1)) / flag;
  const yMid = (r) => r * ROW_H + ROW_H / 2;
  let s = `<svg width="${W}" height="${H}">`;
  const text = (x, y, t, fill, anchor = 'start', bold = false) => `<text x="${x}" y="${y + 4}" fill="${fill}" text-anchor="${anchor}"${bold ? ' font-weight="700"' : ''}>${t}</text>`;
  // the flag line and the axis
  const axisY = rows * ROW_H + ROW_H / 2;
  s += `<line x1="${Xe(flag)}" x2="${Xe(flag)}" y1="2" y2="${rows * ROW_H}" stroke="${R.textDim}" stroke-width="1"/>`;
  for (let l = 10; l < flag - 2; l += 10) if (Math.abs(l - now) > 8) s += text(Xs(l) + (Xe(l) - Xs(l)) / 2, axisY, FMT.lapNumber(l), R.textFaint, 'middle');
  s += text(Xe(flag), axisY, FMT.lapNumber(flag), R.textDim, 'middle');
  // the fitted set: done laps solid, the rest of its life hollow, past its life amber
  const r0 = yMid(0);
  s += text(CELL_W, r0, stint.letter, R.textDim);
  s += `<rect x="${Xs(stint.from)}" y="${r0 - BAR / 2}" width="${Xe(now) - Xs(stint.from)}" height="${BAR}" fill="${R.text}"/>`;
  if (!unknownLife) {
    if (now < stint.life) s += `<rect x="${Xe(now) + 0.5}" y="${r0 - BAR / 2 + 0.5}" width="${Xe(Math.min(stint.life, flag)) - Xe(now) - 1}" height="${BAR - 1}" fill="none" stroke="${R.textDim}"/>`;
    else s += `<rect x="${Xe(stint.life)}" y="${r0 - BAR / 2}" width="${Xe(now) - Xe(stint.life)}" height="${BAR}" fill="${R.warning}"/>`;
    s += text(W - CELL_W, r0, FMT.lapNumber(stint.life), now > stint.life ? R.warning : R.text, 'end', now > stint.life);
  } else {
    s += `<rect x="${W - (RANGE_W + 1) * CELL_W}" y="${r0 - ROW_H / 2 + 2}" width="${RANGE_W * CELL_W}" height="${ROW_H - 4}" fill="transparent"><title>${TEXT.unknown[unknownLife]}</title></rect>`;
    s += `<line x1="${W - (RANGE_W + 1) * CELL_W}" x2="${W - CELL_W}" y1="${r0 + 7}" y2="${r0 + 7}" stroke="${R.textFaint}" stroke-dasharray="1 2"/>`;
  }
  // the next sets: the window as a solid band, then the set's life from the latest as a thin line to where it ends
  sets.forEach((set, i) => {
    const y = yMid(i + 1);
    if (i % 2 === 0) s += `<rect x="0" y="${(i + 1) * ROW_H}" width="${W}" height="${ROW_H}" fill="${R.bgRowBand}"/>`;
    s += text(CELL_W, y, set.letter, R.textDim);
    const reaches = set.lifeEnd >= flag;
    if (reaches) {
      const open = now >= set.earliest && now <= set.latest;
      const from = Math.max(set.earliest, now + 1);
      if (from <= set.latest) s += `<rect x="${Xs(from)}" y="${y - BAR / 2}" width="${Xe(set.latest) - Xs(from)}" height="${BAR}" fill="${open ? R.ownCar : R.textDim}"/>`;
      s += `<line x1="${Xe(set.latest)}" x2="${Xe(flag)}" y1="${y}" y2="${y}" stroke="${R.textFaint}" stroke-width="1"/>`;
      s += text(W - CELL_W, y, FMT.lapRange(set.earliest, set.latest).replace(/–L/, '–'), open ? R.ownCar : now > set.latest ? R.textFaint : R.text, 'end', open);
    } else {
      s += `<line x1="${Xe(set.latest)}" x2="${Xe(set.lifeEnd)}" y1="${y}" y2="${y}" stroke="${R.textFaint}" stroke-width="1"/>`;
      s += `<line x1="${Xe(set.lifeEnd)}" x2="${Xe(set.lifeEnd)}" y1="${y - 4}" y2="${y + 4}" stroke="${R.textFaint}" stroke-width="1"/>`;
    }
  });
  // now: a white line through every row, its lap on the axis
  s += `<line x1="${Xe(now)}" x2="${Xe(now)}" y1="2" y2="${rows * ROW_H}" stroke="${R.ownCar}" stroke-width="1"/>`;
  s += text(Xe(now), axisY, FMT.lapNumber(now), R.ownCar, 'middle', true);
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

page('pit-window.html', 'SP4.2 · pit-window-strip, round 3', `
<div class="note">Lap axis = the whole race, the flag a vertical line, <b>now</b> the white line. Top row: the fitted set, done laps solid, the rest of its life hollow. Below: one row per compound we still have a new set of (compound rule applied), its window solid (white when open now), then its life as a thin line. A line that stops short of the flag is a set that does not make it. No words in the panel.</div>
<h2>Full ${FULL_COLS}×4</h2>
<div class="row">${fig(full(OPEN, { size: 'full' }), 'L23, H new open')}${fig(full(AHEAD), 'L15')}</div>
<div class="row" style="margin-top:12px">${fig(full(OVER), 'L33, mediums past their life')}${fig(full({ ...NOSTOP }, { link: '1 · LIN' }), 'LIN L41, tyres reach the flag, rule met')}${fig(full(EARLY), 'L02, life still unknown, sets not received')}</div>
<h2>Compact 22×3</h2>
<div class="row">${fig(compact(OPEN, { size: 'compact' }), 'L23')}${fig(compact(OVER), 'L33')}</div>`);
console.log(SIZES.join('\n'));
