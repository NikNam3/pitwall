// Generates the SP4.2 mockup of the new pit-window-strip display (brainstorm 2026-11-07): node gen.mjs
// Same method as the 2026-10-30 and 2026-11-06 sets: every display is laid out in character cells, with the real theme
// (imported from apps/ui/src/theme) and the SP3 panel frame B. FMT mirrors kit/values/format.ts, TEXT is the wording.
// The generator throws when a line is wider than its panel or a cell wider than its column, so a misfit cannot ship.
import { writeFileSync } from 'node:fs';
import { DEFAULT_THEME, FONT_FAMILY } from '../../../apps/ui/src/theme/themes.ts';

// ---------------------------------------------------------------- theme (the real one)
const R = DEFAULT_THEME.roles;
const FONT_PX = DEFAULT_THEME.fontPx;
const LINE = DEFAULT_THEME.density.lineHeight;
const GAP = DEFAULT_THEME.density.columnGapCols;
const CELL_H = FONT_PX * LINE;

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
  head: { tyre: 'TYRE', window: 'WINDOW' },
  fitted: 'now',
  fresh: 'new',
  twoStops: '2 stops',
  twoStopsLong: (laps) => `lasts ${laps} laps: not to the flag`,
  noStop: 'no stop needed · compound rule met',
  over: 'over',
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
//   current: the fitted set and its latest lap (tyre-life reaches its limit), or `over` once that lap has passed;
//   next[]: per available dry set that meets the compound rule, earliest (the first lap from which it reaches the flag)
//           and latest (= current.latest), or `twoStops` with the laps it lasts.
// The scale runs from now to the flag, one cell per lap when it fits, else laps per cell rounded (the display formats only:
// the cell of a lap is layout, no arithmetic on values).
const SCALE = 30;
const TYRE_W = 6;
const WIN_W = 7;
const FULL_COLS = 1 + TYRE_W + GAP + SCALE + GAP + WIN_W;

// Cell c shows lap `lapAt(c)`; with fewer laps than cells a lap spans several cells.
const lapAt = (c, now, flag) => now + Math.floor((c * (flag - now + 1)) / SCALE);
const cellOf = (lap, now, flag) => Math.ceil(((lap - now) * SCALE) / (flag - now + 1));

function scaleHead(now, flag) {
  const cells = Array(SCALE).fill(' ');
  const free = (c, n) => c >= 0 && c + n <= SCALE && cells.slice(Math.max(0, c - 1), c + n + 1).every((x) => x === ' ');
  const put = (c, t) => { if (!free(c, t.length)) return; for (let i = 0; i < t.length; i++) cells[c + i] = t[i]; };
  const end = FMT.lapNumber(flag);
  put(0, FMT.lapNumber(now));
  put(SCALE - end.length, end);
  for (let l = Math.ceil((now + 1) / 10) * 10; l < flag; l += 10) put(cellOf(l, now, flag), FMT.lapNumber(l));
  return cells.join('');
}

/** One bar on the scale: `━` on the laps in [from, to], `┤` on the last cell of `to` when it is a limit, `·` elsewhere. */
function bar(now, flag, from, to, { cls = '', limit = false } = {}) {
  let out = '';
  for (let c = 0; c < SCALE; c++) {
    const lap = lapAt(c, now, flag);
    const inside = lap >= from && lap <= to;
    const isLimit = limit && lap === to && (c === SCALE - 1 || lapAt(c + 1, now, flag) > to);
    out += isLimit ? span(cls, '┤') : inside ? span(cls, '━') : span('f', '·');
  }
  return out;
}

const tyreCell = (letter, label) => `${span('d', letter)} ${padR(label, TYRE_W - 2)}`;

function fullLines({ now, flag, current, next }) {
  const lines = [span('f', ` ${padR(TEXT.head.tyre, TYRE_W)}${sp(GAP)}${scaleHead(now, flag)}${sp(GAP)}${padL(TEXT.head.window, WIN_W)}`)];
  if (current.unknown) {
    lines.push(` ${tyreCell(current.letter, TEXT.fitted)}${sp(GAP)}${span('tip', sp(SCALE), TEXT.unknown[current.unknown])}${sp(GAP)}${span('tip', sp(WIN_W), TEXT.unknown[current.unknown])}`);
  } else {
    const over = now > current.latest;
    const cls = over ? 'w' : 'd';
    lines.push(` ${tyreCell(current.letter, TEXT.fitted)}${sp(GAP)}${bar(now, flag, now, current.latest, { cls, limit: !over })}${sp(GAP)}${span(cls, padL(over ? TEXT.over : `≤${FMT.lapNumber(current.latest)}`, WIN_W))}`);
  }
  if (next.unknown) {
    lines.push(` ${span('tip', sp(TYRE_W + GAP + SCALE + GAP + WIN_W), TEXT.unknown[next.unknown])}`);
    return lines;
  }
  next.forEach((s, i) => {
    const label = s.wear === 0 ? TEXT.fresh : FMT.pct(s.wear);
    let body;
    if (s.twoStops) {
      body = `${span('d', padR(TEXT.twoStopsLong(s.lasts), SCALE))}${sp(GAP)}${span('d', padL(TEXT.twoStops, WIN_W))}`;
    } else {
      const open = now >= s.earliest && now <= s.latest;
      const cls = open ? 'hi' : '';
      body = `${bar(now, flag, Math.max(now, s.earliest), s.latest, { cls })}${sp(GAP)}${span(cls, padL(FMT.lapRange(s.earliest, s.latest).replace(/–L/, '–'), WIN_W))}`;
    }
    const line = ` ${tyreCell(s.letter, label)}${sp(GAP)}${body}`;
    lines.push(i % 2 === 0 ? span('band', line) : line);
  });
  return lines;
}

function compactLines({ now, current, next }) {
  const lines = [];
  if (current.unknown) lines.push(` ${tyreCell(current.letter, TEXT.fitted)} ${span('tip', sp(WIN_W), TEXT.unknown[current.unknown])}`);
  else {
    const over = now > current.latest;
    lines.push(` ${tyreCell(current.letter, TEXT.fitted)} ${span(over ? 'w' : 'd', padL(over ? TEXT.over : `≤${FMT.lapNumber(current.latest)}`, WIN_W))}`);
  }
  if (next.unknown) return [...lines, ` ${span('tip', sp(TYRE_W + 1 + WIN_W), TEXT.unknown[next.unknown])}`];
  for (const s of next) {
    const label = s.wear === 0 ? TEXT.fresh : FMT.pct(s.wear);
    if (s.twoStops) { lines.push(` ${tyreCell(s.letter, label)} ${span('d', padL(TEXT.twoStops, WIN_W))}`); continue; }
    const open = now >= s.earliest && now <= s.latest;
    lines.push(` ${tyreCell(s.letter, label)} ${span(open ? 'hi' : '', padL(FMT.lapRange(s.earliest, s.latest).replace(/–L/, '–'), WIN_W))}`);
  }
  return lines;
}

const full = (w, opts = {}) => panel(TEXT.title, { cols: FULL_COLS, rows: 5, state: `${FMT.lapNumber(w.now)}/${w.flag}`, lines: fullLines(w), ...opts });
const compact = (w, opts = {}) => panel(TEXT.title, { cols: 22, rows: 4, state: '', lines: compactLines(w), ...opts });

// ================================================================ the sample: Silverstone L23/52, KUH on mediums, 23 laps old
// Sets: H new (life 30 laps, earliest L23 = 52 − 30 + 1), H 12 % (life 27, earliest L26), S 31 % (lasts 9 laps: two stops).
// The second M set is left out: KUH started on M, the compound rule needs another dry compound.
const NEXT = [
  { letter: 'H', wear: 0, earliest: 23, latest: 31 },
  { letter: 'H', wear: 12, earliest: 26, latest: 31 },
  { letter: 'S', wear: 31, twoStops: true, lasts: 9 },
];
const OPEN = { now: 23, flag: 52, current: { letter: 'M', latest: 31 }, next: NEXT };
const AHEAD = { now: 15, flag: 52, current: { letter: 'M', latest: 31 }, next: NEXT };
const OVER = { now: 33, flag: 52, current: { letter: 'M', latest: 31 }, next: [
  { letter: 'H', wear: 0, earliest: 23, latest: 31 },
  { letter: 'H', wear: 12, earliest: 26, latest: 31 },
  { letter: 'S', wear: 31, twoStops: true, lasts: 9 },
] };
const EARLY = { now: 2, flag: 52, current: { letter: 'M', unknown: 'insufficientData' }, next: { unknown: 'notReceived' } };

const noStop = panel(TEXT.title, { cols: FULL_COLS, rows: 5, link: '1 · LIN', state: 'L41/52', lines: [
  span('f', ` ${padR(TEXT.head.tyre, TYRE_W)}${sp(GAP)}${scaleHead(41, 52)}${sp(GAP)}${padL(TEXT.head.window, WIN_W)}`),
  ` ${tyreCell('H', TEXT.fitted)}${sp(GAP)}${bar(41, 52, 41, 52, { cls: 'd' })}${sp(GAP)}${span('d', padL('flag', WIN_W))}`,
  span('d', ` ${TEXT.noStop}`),
] });

page('pit-window.html', 'SP4.2 · pit-window-strip (new display, pitWindow.car)', `
<div class="note">The pit window of one of our cars, from now to the flag. Sample: Silverstone, 52 laps, KUH on mediums. <b>now</b> = the fitted set and the lap it reaches its life (tyre-life). Below it one row per available dry set that meets the compound rule (KUH started on M, so the second M set is left out): the window from its <b>earliest</b> lap (the first lap from which that set reaches the flag) to the fitted set's <b>latest</b>. A set that cannot reach the flag even from the latest lap says <b>two stops</b>; choosing between one stop and two is 4.3's. Numbers only, no verdict. Colour: white bold = the window is open now; amber = the fitted set is past its life. Compound letters grey (SP3).</div>
<h2>Full ${FULL_COLS}×5 · window open (L23)</h2>
<div class="row">${fig(full(OPEN, { size: 'full' }), 'L23 · H new: window L23–31, open now (white bold) · H 12%: opens L26 · S 31%: lasts 9 laps, not to the flag from L31 · the scale is now to the flag; lap labels every 10 laps')}</div>
<h2>Before the window (L15) · past the fitted set's life (L33)</h2>
<div class="row">${fig(full(AHEAD), 'L15 · both H windows ahead, plain text · the scale squeezes 38 laps into 30 cells')}${fig(full(OVER), 'L33 · the mediums are past L31: "over" in amber; every window has closed (all of it lies behind now), so the bars are empty and the ranges stay as text')}</div>
<h2>No stop needed · early laps</h2>
<div class="row">${fig(noStop, 'LIN, L41, on H since L15, the compound rule met: these tyres reach the flag · one line, no set rows')}${fig(full(EARLY), 'L02 · fewer than 3 laps on these tyres: the latest lap is unknown (dotted underline, reason on hover) · the sets have not arrived yet: one empty row with its reason')}</div>
<h2>Compact 22×4</h2>
<div class="row">${fig(compact(OPEN, { size: 'compact' }), 'compact · no scale: the fitted set\'s latest lap, then one line per set · same emphasis')}${fig(compact(OVER), 'L33 · over in amber')}</div>
<div class="note">Topic <code>pitWindow.car</code> (params: our car). The <code>window</code> moment of <code>race-moment</code> is active from <code>earliest − windowLeadLaps</code> (2) until we stop or the window closes; this display does not show the moment, the shell's switch rules may use it (C67).</div>`);
console.log(SIZES.join('\n'));
