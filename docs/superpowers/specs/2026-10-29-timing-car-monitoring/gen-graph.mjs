// Generates dependency-graph.html (sub-project 3 units and their reads): node gen-graph.mjs
import { writeFileSync } from 'node:fs';

const kinds = {
  input: { label: 'engine / core topic (exists)', fill: '#24272c', stroke: '#5a606a', text: '#9aa1ab' },
  shared: { label: 'shared calculator / function', fill: '#2a3340', stroke: '#6f8fb8', text: '#dfe6ef' },
  analysis: { label: 'analysis (publishes topics)', fill: '#2d3a30', stroke: '#7fae86', text: '#e1ece2' },
  display: { label: 'display (widget)', fill: '#3a3329', stroke: '#c0a06a', text: '#efe7da' },
  kit: { label: 'UI kit piece (supervisor)', fill: '#352c3a', stroke: '#a587b8', text: '#ebe1f0' },
};

const columns = [
  { id: 'in', title: 'exists today', plan: null },
  { id: 'cc0b', title: 'W0b', plan: 'cc' },
  { id: 'cc0c', title: 'W0c', plan: 'cc' },
  { id: 'cc1', title: 'W1', plan: 'cc' },
  { id: 'cc2', title: 'W2', plan: 'cc' },
  { id: 't1', title: 'W1', plan: 't' },
  { id: 't2', title: 'W2', plan: 't' },
  { id: 't3', title: 'W3', plan: 't' },
];

const nodes = [
  ['session.info', 'input', 'in', 'session type, laps, time left, forecast'],
  ['lap history', 'input', 'in', 'LapRecord (+ lap-end wear, ERS, damage)'],
  ['car state', 'input', 'in', 'car.detail / cars.overview'],
  ['mini-sectors', 'input', 'in', '50 crossings per lap per car'],
  ['events', 'input', 'in', 'collisions, penalties, retirements'],
  ['flag phases', 'input', 'in', 'SC / VSC / red'],
  ['stints, pit stops', 'input', 'in', 'history lists'],

  ['session-remaining', 'shared', 'cc0b', 'laps or time left'],
  ['lap-classes', 'shared', 'cc0b', 'which laps count'],
  ['per-lap-rate', 'shared', 'cc0b', 'rate per lap, laps until x'],
  ['pace-delta', 'shared', 'cc0b', 'loss: pace after vs before'],
  ['pace', 'shared', 'cc0c', 'clean-lap pace per car'],

  ['fuel', 'analysis', 'cc1', 'fuel.car'],
  ['tyre-wear', 'analysis', 'cc1', 'tyreWear.car'],
  ['ers', 'analysis', 'cc1', 'ers.car'],
  ['car-bands', 'analysis', 'cc1', 'carBands.car'],
  ['damage', 'analysis', 'cc1', 'damage.car'],

  ['alarms', 'analysis', 'cc2', '→ insights (top bar alerts)'],
  ['fuel-gauge', 'display', 'cc2', 'V20'],
  ['tyre-life-bar', 'display', 'cc2', 'V21'],
  ['corner-block', 'display', 'cc2', 'V22'],
  ['ers-budget', 'display', 'cc2', 'V23'],
  ['damage-card', 'display', 'cc2', 'V31'],
  ['alarm-list', 'display', 'cc2', 'V25'],

  ['lap-times', 'analysis', 't1', 'lapTimes.board / .projection'],
  ['gaps', 'analysis', 't1', 'gaps.intervals .toCar .gapper .neighbourhood'],

  ['battle', 'analysis', 't2', 'battle.cards'],
  ['incidents', 'analysis', 't2', 'incidents.feed'],

  ['race-moment', 'analysis', 't3', 'raceMoment.current'],
  ['projected-lap', 'display', 't3', 'V10 + V11'],
  ['lap-analysis', 'display', 't3', 'V28'],
  ['timing-tower', 'display', 't3', 'V29'],
  ['gap-chart', 'display', 't3', 'V04'],
  ['battle-cards', 'display', 't3', 'V14'],
  ['incident-feed', 'display', 't3', 'V35'],
].map(([id, kind, col, sub]) => ({ id, kind, col, sub }));

// [from, to] means "to reads from"; a third element 'runtime' marks a data flow that is not a build dependency.
const edges = [
  ['lap history', 'lap-classes'],
  ['session.info', 'session-remaining'], ['car state', 'session-remaining'],
  ['lap-classes', 'pace'], ['lap history', 'pace'],

  ['per-lap-rate', 'tyre-wear'], ['lap history', 'tyre-wear'], ['car state', 'tyre-wear'],
  ['per-lap-rate', 'fuel'], ['session-remaining', 'fuel'], ['lap history', 'fuel'], ['car state', 'fuel'],
  ['per-lap-rate', 'ers'], ['lap history', 'ers'], ['car state', 'ers'],
  ['car state', 'car-bands'],
  ['pace', 'damage'], ['pace-delta', 'damage'], ['car state', 'damage'], ['lap history', 'damage'],

  ['tyre-wear', 'alarms'], ['fuel', 'alarms'], ['ers', 'alarms'], ['car-bands', 'alarms'], ['damage', 'alarms'], ['car state', 'alarms'],
  ['car-bands', 'corner-block'], ['tyre-wear', 'corner-block'], ['car state', 'corner-block'],
  ['tyre-wear', 'tyre-life-bar'], ['car state', 'tyre-life-bar'],
  ['fuel', 'fuel-gauge'],
  ['ers', 'ers-budget'],
  ['damage', 'damage-card'],
  ['alarms', 'alarm-list', 'runtime'],

  ['mini-sectors', 'gaps'], ['car state', 'gaps'],
  ['lap-classes', 'lap-times'], ['pace', 'lap-times'], ['lap history', 'lap-times'], ['mini-sectors', 'lap-times'], ['session.info', 'lap-times'],

  ['gaps', 'battle'], ['pace', 'battle'], ['per-lap-rate', 'battle'], ['car state', 'battle'],
  ['gaps', 'incidents'], ['damage', 'incidents'], ['pace-delta', 'incidents'], ['events', 'incidents'], ['flag phases', 'incidents'], ['mini-sectors', 'incidents'],

  ['flag phases', 'race-moment'], ['incidents', 'race-moment'], ['battle', 'race-moment'], ['alarms', 'race-moment'], ['session.info', 'race-moment'],
  ['gaps', 'timing-tower'], ['lap-times', 'timing-tower'], ['car state', 'timing-tower'], ['stints, pit stops', 'timing-tower'],
  ['gaps', 'gap-chart'], ['flag phases', 'gap-chart'],
  ['lap-times', 'lap-analysis'],
  ['lap-times', 'projected-lap'], ['session.info', 'projected-lap'],
  ['battle', 'battle-cards'],
  ['incidents', 'incident-feed'],

  ['race-moment', 'ers-budget', 'runtime'], ['race-moment', 'timing-tower', 'runtime'],
  ['race-moment', 'battle-cards', 'runtime'], ['race-moment', 'incident-feed', 'runtime'],
];

const kitNodes = [
  ['CornerGrid', 'cc'], ['Bar', 'cc'], ['unit formats', 'cc'], ['insight line', 'cc'], ['CompoundMark', 'cc'],
  ['CarLabel', 't'], ['position mark', 't'], ['phase bands', 't'], ['our-cars highlight', 't'], ['sector emphasis', 't'],
];
const kitEdges = [
  ['CornerGrid', 'corner-block'], ['CornerGrid', 'tyre-life-bar'], ['CornerGrid', 'damage-card'],
  ['Bar', 'tyre-life-bar'], ['Bar', 'fuel-gauge'], ['Bar', 'ers-budget'],
  ['unit formats', 'corner-block'], ['unit formats', 'tyre-life-bar'], ['unit formats', 'fuel-gauge'],
  ['unit formats', 'ers-budget'], ['unit formats', 'damage-card'], ['unit formats', 'alarm-list'],
  ['insight line', 'alarm-list'],
  ['CompoundMark', 'tyre-life-bar'], ['CompoundMark', 'timing-tower'], ['CompoundMark', 'lap-analysis'], ['CompoundMark', 'battle-cards'],
  ['CarLabel', 'timing-tower'], ['CarLabel', 'gap-chart'], ['CarLabel', 'lap-analysis'], ['CarLabel', 'projected-lap'],
  ['CarLabel', 'battle-cards'], ['CarLabel', 'incident-feed'],
  ['position mark', 'timing-tower'], ['position mark', 'incident-feed'],
  ['phase bands', 'gap-chart'],
  ['our-cars highlight', 'timing-tower'], ['our-cars highlight', 'gap-chart'], ['our-cars highlight', 'lap-analysis'],
  ['sector emphasis', 'timing-tower'], ['sector emphasis', 'lap-analysis'], ['sector emphasis', 'projected-lap'],
];

// ---- layout ----
const NW = 236, NH = 60, COLW = 292, ROWH = 76, LEFT = 30, TOP = 110;

function layout(cols, ns, es) {
  const byCol = new Map(cols.map((c) => [c.id, ns.filter((n) => n.col === c.id)]));
  const pos = new Map();
  const place = () => {
    for (const [ci, c] of cols.entries()) byCol.get(c.id).forEach((n, i) => pos.set(n.id, { x: LEFT + ci * COLW, y: TOP + i * ROWH }));
  };
  place();
  // A few barycentre sweeps to reduce crossings; the input column stays in its given order.
  for (let sweep = 0; sweep < 6; sweep++) {
    for (const c of cols.slice(1)) {
      const list = byCol.get(c.id);
      const bary = (n) => {
        const ys = es.filter((e) => e[1] === n.id && e[2] !== 'runtime').map((e) => pos.get(e[0]).y);
        return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : pos.get(n.id).y;
      };
      const scored = list.map((n) => [n, bary(n)]);
      scored.sort((a, b) => a[1] - b[1]);
      byCol.set(c.id, scored.map(([n]) => n));
      place();
    }
  }
  return pos;
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function edgePath(a, b, w = NW, h = NH) {
  const x1 = a.x + w, y1 = a.y + h / 2, x2 = b.x, y2 = b.y + h / 2;
  if (x2 <= x1) {
    // same column (runtime edge inside a wave) or backwards: loop out to the right
    const dx = 40;
    return `M${x1},${y1} C${x1 + dx},${y1} ${b.x + w + dx},${y2} ${b.x + w},${y2}`;
  }
  const c = Math.max(40, (x2 - x1) * 0.45);
  return `M${x1},${y1} C${x1 + c},${y1} ${x2 - c},${y2} ${x2},${y2}`;
}

// Engine inputs and runtime-only reads become a text line in the node; only unit-to-unit build edges are drawn.
const kindOf = new Map(nodes.map((n) => [n.id, n.kind]));
for (const n of nodes) {
  const ins = edges.filter((e) => e[1] === n.id && kindOf.get(e[0]) === 'input').map((e) => e[0]);
  const rt = edges.filter((e) => e[1] === n.id && e[2] === 'runtime').map((e) => (e[0] === 'alarms' ? 'insights (from alarms)' : `${e[0]} (optional)`));
  n.reads = [...ins, ...rt].join(', ');
}
const drawn = edges.filter((e) => kindOf.get(e[0]) !== 'input' && e[2] !== 'runtime');

function svgMain() {
  const columns2 = columns.slice(1);
  const units = nodes.filter((n) => n.kind !== 'input');
  const pos = layout(columns2, units, drawn);
  return svgFrom(columns2, units, drawn, pos);
}

function svgFrom(columns, nodes, edges, pos) {
  const maxRows = Math.max(...columns.map((c) => nodes.filter((n) => n.col === c.id).length));
  const W = LEFT * 2 + (columns.length - 1) * COLW + NW + 40, H = TOP + maxRows * ROWH + 20;
  const x = (ci) => LEFT + ci * COLW;
  const plans = [
    { id: 'cc', title: 'Car care plan', from: 0, to: 3 },
    { id: 't', title: 'Timing plan', from: 4, to: 6 },
  ];
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  for (const p of plans) {
    s += `<rect x="${x(p.from) - 14}" y="20" width="${x(p.to) - x(p.from) + NW + 28}" height="${H - 30}" rx="8" class="band"/>`;
    s += `<text x="${x(p.from) - 2}" y="44" class="plan">${p.title}</text>`;
  }
  columns.forEach((c, ci) => (s += `<text x="${x(ci) + NW / 2}" y="${p0(c)}" class="col" text-anchor="middle">${c.title}</text>`));
  function p0() { return 80; }
  for (const [from, to, kind] of edges) {
    s += `<path d="${edgePath(pos.get(from), pos.get(to))}" class="edge ${kind ?? ''}" data-from="${esc(from)}" data-to="${esc(to)}"/>`;
  }
  for (const n of nodes) s += nodeSvg(n, pos.get(n.id));
  return s + '</svg>';
}

function nodeSvg(n, p) {
  const k = kinds[n.kind];
  return `<g class="node" data-id="${esc(n.id)}" transform="translate(${p.x},${p.y})">` +
    `<rect width="${NW}" height="${NH}" rx="6" fill="${k.fill}" stroke="${k.stroke}"/>` +
    `<text x="10" y="19" class="name" fill="${k.text}">${esc(n.id)}</text>` +
    `<text x="10" y="35" class="sub">${esc(fit(n.sub))}</text>` +
    (n.reads ? `<text x="10" y="51" class="reads">${esc(fit('in: ' + n.reads))}</text><title>${esc('reads: ' + n.reads)}</title>` : '') +
    `</g>`;
}

function fit(t) {
  const max = Math.floor((NW - 16) / 6.1);
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

function svgKit() {
  const displays = nodes.filter((n) => n.kind === 'display');
  const kn = kitNodes.map(([id, plan]) => ({ id, kind: 'kit', col: 'k', sub: plan === 'cc' ? 'car care plan W0a' : 'timing plan W0' }));
  const dn = displays.map((d) => ({ ...d, col: 'd', reads: '' }));
  const cols = [{ id: 'k' }, { id: 'd' }];
  const KCOLW = 420;
  const pos = new Map();
  kn.forEach((n, i) => pos.set(n.id, { x: LEFT, y: 30 + i * ROWH }));
  // order displays by barycentre of their kit pieces
  const bary = (d) => { const ys = kitEdges.filter((e) => e[1] === d.id).map((e) => pos.get(e[0]).y); return ys.reduce((a, b) => a + b, 0) / ys.length; };
  dn.sort((a, b) => bary(a) - bary(b)).forEach((n, i) => pos.set(n.id, { x: LEFT + KCOLW, y: 30 + i * (ROWH * kn.length / dn.length) }));
  const W = LEFT * 2 + KCOLW + NW + 20, H = 30 + kn.length * ROWH + 10;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  for (const [from, to] of kitEdges) s += `<path d="${edgePath(pos.get(from), pos.get(to))}" class="edge" data-from="${esc(from)}" data-to="${esc(to)}"/>`;
  for (const n of [...kn, ...dn]) s += nodeSvg(n, pos.get(n.id));
  void cols;
  return s + '</svg>';
}

const legend = Object.entries(kinds).filter(([k]) => k !== 'input').map(([, k]) => k).map((k) => `<span class="lg"><i style="background:${k.fill};border-color:${k.stroke}"></i>${k.label}</span>`).join('') +
  '<span class="lg"><b class="solid"></b>is read by (build dependency)</span><span class="lg"><span class="rd">in: …</span>engine data and optional topics the unit reads</span>';

const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Sub-project 3: dependency graph</title>
<style>
  body { margin: 0; padding: 24px 32px; background: #17191c; color: #c9ced6; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 13px; }
  h1 { font-size: 17px; font-weight: 600; margin: 0 0 4px; color: #e6e9ee; }
  h2 { font-size: 14px; font-weight: 600; margin: 34px 0 6px; color: #e6e9ee; }
  p { margin: 4px 0 10px; color: #9aa1ab; max-width: 1100px; line-height: 1.5; }
  .legend { display: flex; flex-wrap: wrap; gap: 6px 20px; margin: 10px 0 6px; }
  .lg { display: inline-flex; align-items: center; gap: 7px; color: #9aa1ab; }
  .lg i { width: 18px; height: 12px; border: 1px solid; border-radius: 3px; display: inline-block; }
  .lg b { width: 26px; height: 0; border-top: 1.6px solid #7d8590; display: inline-block; }
  .lg b.dash { border-top-style: dashed; }
  svg { display: block; overflow: visible; }
  svg text { font-family: inherit; }
  .band { fill: #1c1f23; stroke: #2c3036; }
  .plan { fill: #c9ced6; font-size: 13px; font-weight: 600; }
  .col { fill: #7d8590; font-size: 12px; }
  .name { font-size: 13px; font-weight: 600; }
  .reads { font-size: 10px; fill: #6f7680; }
  .rd { color: #6f7680; font-size: 11px; }
  .sub { font-size: 10.5px; fill: #8a919b; }
  .edge { fill: none; stroke: #5d646e; stroke-width: 1.3; opacity: .55; transition: opacity .1s; }
  .edge.runtime { stroke-dasharray: 5 4; }
  .node { cursor: default; }
  .node rect { stroke-width: 1.3; }
  svg.focus .edge { opacity: .08; }
  svg.focus .edge.on { opacity: 1; stroke: #e6e9ee; stroke-width: 1.8; }
  svg.focus .node { opacity: .35; }
  svg.focus .node.on { opacity: 1; }
</style></head><body>
<h1>Sub-project 3 (timing + car monitoring): dependency graph</h1>
<p>Left to right is build order: waves of the car care plan, then the timing plan. A line runs from a unit to the units that read it. Units in the same column never read each other. The third line in a box lists what it reads from the engine (car state, lap history, mini-sectors, events, flag phases, session info, stints and pit stops) and the optional topics it reads at runtime; those exist before the run and are not build dependencies. Supervisor W0 work (rename, contracts, LapRecord fields, test builders, mockups) comes before every column. <b>Hover a node</b> to highlight what it reads and who reads it.</p>
<div class="legend">${legend}</div>
${svgMain()}
<h2>UI kit pieces → displays</h2>
<p>Built by the supervisor in each plan's W0, before any display agent starts. CompoundMark moved to the car care plan because tyre-life-bar uses it.</p>
${svgKit()}
<script>
  for (const svg of document.querySelectorAll('svg')) {
    const edges = [...svg.querySelectorAll('.edge')], nodes = [...svg.querySelectorAll('.node')];
    for (const n of nodes) {
      n.addEventListener('mouseenter', () => {
        const id = n.dataset.id, on = new Set([id]);
        svg.classList.add('focus');
        for (const e of edges) if (e.dataset.from === id || e.dataset.to === id) { e.classList.add('on'); on.add(e.dataset.from); on.add(e.dataset.to); }
        for (const m of nodes) if (on.has(m.dataset.id)) m.classList.add('on');
      });
      n.addEventListener('mouseleave', () => { svg.classList.remove('focus'); for (const el of svg.querySelectorAll('.on')) el.classList.remove('on'); });
    }
  }
</script>
</body></html>`;

writeFileSync(new URL('./dependency-graph.html', import.meta.url), html);
console.log('written');
