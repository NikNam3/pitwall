// Generates the sub-project 3 display mockups (plan Task 0): node gen.mjs
// Every display is laid out in character cells (`pre` lines), with the approved quiet theme and panel frame B.
import { writeFileSync } from 'node:fs';

const CSS = `
:root { --bg:#000; --band:#141416; --rowband:#0d0d0f; --border:#25272c; --text:#d9dbe0; --dim:#8d9199; --faint:#5c6068;
  --crit:#ff5c5c; --warn:#f0b429; --best:#b06cff; --pb:#3fcf70; --own:#fff; --grid:#1c1d21;
  --cS:#ff7a70; --cM:#f5d547; --cH:#ffffff; --font:'JetBrains Mono',monospace; --px:14px; --line:1.4; }
* { box-sizing:border-box; margin:0; padding:0; }
body { background:var(--bg); color:var(--text); font-family:var(--font); font-size:var(--px); line-height:var(--line);
  font-variant-ligatures:none; padding:24px 28px 56px; }
h1 { font-size:var(--px); font-weight:600; margin-bottom:4px; }
h2 { font-size:var(--px); font-weight:500; color:var(--dim); margin:26px 0 8px; }
.note { color:var(--dim); max-width:150ch; margin-bottom:10px; }
.note b, .note em { color:var(--text); font-weight:500; font-style:normal; }
.row { display:flex; gap:16px; align-items:flex-start; flex-wrap:wrap; }
.panel { background:var(--bg); display:inline-block; vertical-align:top; }
.ph { display:flex; gap:1ch; padding:0 1ch; background:var(--band); white-space:nowrap; color:var(--faint); }
.ph .t { color:var(--dim); } .ph .sp { flex:1; } .ph .lk { color:var(--text); } .ph .age { color:var(--dim); }
pre { font-family:inherit; font-size:inherit; line-height:inherit; padding:0 1ch; white-space:pre; }
.cap { color:var(--faint); margin:4px 0 0; }
.d { color:var(--dim); } .f { color:var(--faint); } .w { color:var(--warn); } .c { color:var(--crit); }
.b { color:var(--best); } .g { color:var(--pb); } .o { color:var(--own); font-weight:700; } .hi { color:var(--own); font-weight:700; } .m { font-weight:700; }
.t2 { color:var(--text); }
.cS { color:var(--cS); } .cM { color:var(--cM); } .cH { color:var(--cH); }
.band { background:var(--rowband); display:inline-block; width:100%; }
.me { color:var(--own); font-weight:700; box-shadow:inset 2px 0 0 var(--text); display:inline-block; width:100%; }
.inc { box-shadow:inset 2px 0 0 var(--warn); display:inline-block; width:100%; }
.tip { position:relative; text-decoration:underline dotted var(--faint); }
.legend { color:var(--dim); max-width:120ch; } .legend div { margin-bottom:4px; } .legend b { color:var(--text); font-weight:500; }
.q { border-left:2px solid var(--border); padding-left:2ch; margin:10px 0 4px; max-width:130ch; color:var(--dim); }
.q b { color:var(--text); font-weight:500; }
svg text { font-family:var(--font); font-size:12px; }
`;

const GEAR = '<svg width="14" height="14" viewBox="0 0 14 14" style="vertical-align:-2px"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="1.1" stroke-dasharray="2 1.4"/><circle cx="7" cy="7" r="2.1" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>';

/** Panel frame B: header band with title, link marker, state, gear; body as character-cell lines. */
function panel(title, { cols, link = '1 · KUH', state = '', lines }) {
  const body = lines.join('\n');
  return `<div class="panel" style="width:${cols + 2}ch"><div class="ph"><span class="t">${title}</span><span class="lk">${link}</span><span class="sp"></span><span class="age">${state}</span><span>${GEAR}</span></div><pre>${body}</pre></div>`;
}

/** Character-cell table: spec = [{ h, w, a: 'l'|'r' }], rows = [{ cls?, cells: [string | { t, c }] }]. Columns are 1 cell apart. */
function table(spec, rows) {
  const vis = (t) => t.replace(/<[^>]+>/g, '').length;
  const cell = (t, i) => (spec[i].a === 'l' ? t + ' '.repeat(Math.max(0, spec[i].w - vis(t))) : ' '.repeat(Math.max(0, spec[i].w - vis(t))) + t);
  const head = '<span class="f"> ' + spec.map((c, i) => cell(c.h, i)).join(' ') + '</span>';
  const body = rows.map((r) => {
    const line = ' ' + r.cells.map((x, i) => { const t = typeof x === 'string' ? x : x.t; const v = cell(t, i); return typeof x === 'string' || !x.c ? v : `<span class="${x.c}">${v}</span>`; }).join(' ');
    return r.cls ? `<span class="${r.cls}">${line}</span>` : line;
  });
  return [head, ...body];
}
const C = (t, c) => ({ t, c });

const page = (file, title, body) =>
  writeFileSync(new URL(file, import.meta.url), `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>${CSS}</style></head><body><h1>${title}</h1>${body}</body></html>`);
const cap = (t) => `<div class="cap">${t}</div>`;
const fig = (p, c) => `<div>${p}${cap(c)}</div>`;
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - s.replace(/<[^>]+>/g, '').length));
const lpad = (s, n) => ' '.repeat(Math.max(0, n - s.replace(/<[^>]+>/g, '').length)) + s;

// ---------------------------------------------------------------- 0: colour questions
{
  const rows = (compound, pbMode) => {
    // pbMode: 'all' every car purple+green; 'ownGreen' purple for all, green only our cars; 'own' both only our cars
    const sec = (v, kind, ours) => {
      if (kind === 'b') return pbMode === 'own' && !ours ? v : `<span class="b">${v}</span>`;
      if (kind === 'g') return pbMode === 'all' || ours ? `<span class="g">${v}</span>` : v;
      return v;
    };
    const cm = (l) => (compound ? `<span class="c${l}">${l}</span>` : l);
    const head = '<span class="f">P  DRV   LAST       S1     S2     S3  T AGE</span>';
    return [
      head,
      ` 1 VER ${sec('1:44.912', '')} ${sec('28.104', 'b')} ${sec('41.311', 'g')} 35.497  ${cm('M')}  14`,
      `<span class="band"> 2 NOR 1:45.031 28.211 ${sec('41.402', 'g')} 35.418  ${cm('M')}  14</span>`,
      ` 3 LEC 1:45.208 28.240 41.630 ${sec('35.338', 'b')}  ${cm('H')}  23`,
      `<span class="me"> 4 KUH ${sec('1:44.876', 'g', true)} 28.150 ${sec('41.288', 'b', true)} ${sec('35.438', 'g', true)}  ${cm('M')}  12</span>`,
      ` 5 HAM 1:45.660 28.402 41.771 35.487  ${cm('S')}   3`,
    ];
  };
  const p = (t, c, m) => panel('Timing', { cols: 44, state: 'L23/62', lines: rows(c, m) });
  page('0-compound-and-sectors.html', '0 · Two open colour questions', `
<div class="note">The UI shell left two colour questions to the first timing displays (spec 8.5). Both become theme variants, so they can be switched later. Purple = session best, green = personal best. KUH (white, bar) is our car.</div>
<h2>Question A: compound as a letter, or letter plus colour?</h2>
<div class="row">${fig(p('', false, 'ownGreen'), 'A1 · letter only (grey)')}${fig(p('', true, 'ownGreen'), 'A2 · letter plus colour (S red-ish, M yellow, H white)')}</div>
<div class="q"><b>Recommendation: A1, letter only.</b> In A2 three of five rows carry a hue that is neither a highlight nor needed to tell rows apart: the letter already says it. The red-ish soft also competes with the critical red.</div>
<h2>Question B: which purple and green sectors light up?</h2>
<div class="row">${fig(p('', false, 'all'), 'B1 · purple and green for every car')}${fig(p('', false, 'ownGreen'), 'B2 · purple for every car, green only for our cars')}${fig(p('', false, 'own'), 'B3 · both only for our cars')}</div>
<div class="q"><b>Recommendation: B2.</b> A session best is news whoever sets it (it moves the reference). A rival's personal best is not: in B1 the table fills with green that asks for attention it doesn't deserve. B3 hides who just went purple.</div>`);
}

// ---------------------------------------------------------------- 1: car care
{
  const corner = panel('Corners', {
    cols: 44,
    lines: [
      '<span class="f">     SURF  CARC   PSI  BRAKE  WEAR</span>',
      ' FL    98   101  23.1    812   18%',
      `<span class="band"> FR   104   <span class="w">109</span>  23.4   <span class="c">1043</span>   21%</span>`,
      ' RL    95    99  22.6    534   15%',
      `<span class="band"> RR    97   102  22.8    561   17%</span>`,
      '',
      ' ENG  112 °C',
    ],
  });
  const cornerCompact = panel('Corners', {
    cols: 26,
    lines: [' FL  98° 18%  FR <span class="w">104°</span> 21%', ' RL  95° 15%  RR  97° 17%', ' BRK <span class="c">FR 1043</span>  ENG 112'],
  });
  const bar = (fill, limitAt, gameAt, cols = 20) => {
    let s = '';
    for (let i = 0; i < cols; i++) s += i === limitAt ? '<span class="d">|</span>' : i === gameAt ? '<span class="d">:</span>' : i < fill ? '█' : '<span class="f">░</span>';
    return s;
  };
  const lifeSpec = [{ h: '', w: 2, a: 'l' }, { h: 'WEAR', w: 20, a: 'l' }, { h: 'NOW', w: 4, a: 'r' }, { h: '%/LAP', w: 5, a: 'r' }, { h: 'LAPS TO 70%', w: 11, a: 'r' }];
  const life = panel('Tyre life', {
    cols: 47,
    state: 'M · 12 laps old',
    lines: [
      ...table(lifeSpec, [
        { cells: ['FL', bar(5, 14, 11), '18%', '1.4', '37'] },
        { cls: 'band', cells: ['FR', bar(6, 14, 11), '21%', '1.7', '29'] },
        { cells: ['RL', bar(4, 14, 11), '15%', '1.2', '46'] },
        { cls: 'band', cells: ['RR', bar(5, 14, 11), '17%', '1.3', '41'] },
      ]),
    ],
  });
  const lifeNear = panel('Tyre life', {
    cols: 47,
    state: 'M · 31 laps old',
    lines: [
      ...table(lifeSpec, [
        { cells: ['FL', bar(12, 14, 11), '61%', '1.9', '4'] },
        { cls: 'band', cells: ['FR', bar(13, 14, 11), '66%', '2.0', C('2', 'c')] },
        { cells: ['RL', bar(11, 14, 11), '57%', '1.6', '8'] },
        { cls: 'band', cells: ['RR', bar(12, 14, 11), '60%', '1.7', '5'] },
      ]),
    ],
  });
  const fuSpec = [{ h: '', w: 6, a: 'l' }, { h: '', w: 5, a: 'r' }, { h: '', w: 15, a: 'l' }];
  const kv = (rows) => table(fuSpec, rows).slice(1);
  const fuel = panel('Fuel', {
    cols: 30,
    lines: kv([
      { cells: ['MARGIN', C('+1.8', 'm'), C('laps', 'm')] },
      { cells: ['LASTS', '19.4', 'laps (31.4 kg)'] },
      { cells: ['TO GO', '17.6', 'laps'] },
      { cells: ['BURN', '1.62', 'kg/lap'] },
      { cells: ['SAVE', '', ''] },
      { cls: 'f', cells: ['GAME', '+1.6', 'laps margin'] },
    ]),
  });
  const fuelShort = panel('Fuel', {
    cols: 30,
    lines: kv([
      { cells: ['MARGIN', C('−0.7', 'c m'), C('laps', 'c m')] },
      { cells: ['LASTS', '15.3', 'laps (26.2 kg)'] },
      { cells: ['TO GO', '16.0', 'laps'] },
      { cells: ['BURN', '1.71', 'kg/lap'] },
      { cells: ['SAVE', '0.07', 'kg/lap'] },
      { cls: 'f', cells: ['GAME', '−0.4', 'laps margin'] },
    ]),
  });
  const ersBar = (fill, attackAt, cols = 20) => {
    let s = '';
    for (let i = 0; i < cols; i++) s += i === attackAt ? '<span class="d">|</span>' : i < fill ? '█' : '<span class="f">░</span>';
    return s;
  };
  const erSpec = [{ h: '', w: 7, a: 'l' }, { h: '', w: 20, a: 'l' }, { h: '', w: 4, a: 'r' }, { h: '', w: 14, a: 'l' }];
  const ers = (hi, ready, flow) => panel('ERS', {
    cols: 50,
    lines: table(erSpec, [
      { cells: ['STORE', ersBar(ready ? 14 : 9, 12), hi ? C(ready ? '2.9' : '1.9', 'hi') : ready ? '2.9' : '1.9', hi ? C('MJ  ' + flow, 'hi') : 'MJ  ' + flow] },
      { cells: ['DEPLOY', 'this lap', '2.1', 'MJ, limit 4.0'] },
      { cells: ['HARVEST', 'this lap', '1.3', 'MJ'] },
      { cells: ['TREND', 'per lap', ready ? '−0.3' : '+0.4', ready ? (hi ? '<span class="hi">MJ, attack ready</span>' : 'MJ, attack ready') : 'MJ, attack in 2 laps'] },
    ]).slice(1),
  });
  const damage = panel('Damage', {
    cols: 44,
    lines: [
      '<span class="f">        L    R    REAR</span>',
      ' WING  <span class="c">12%</span>   0%    0%',
      ' FLOOR  4%  DIFF 0%  SIDEPOD 2%',
      ' GBX    8%  ENG 11%',
      '<span class="f">        TYRE  BRAKE      TYRE  BRAKE</span>',
      ' FL      3%    0%   FR    1%    0%',
      ' RL      0%    0%   RR    0%    0%',
      ' <span class="c">L14 FL wing +12 %   loss: measuring</span>',
      ' <span class="f">L09 floor +4 %      loss +0.12 s/lap</span>',
    ],
  });
  const alarms = panel('Alarms', {
    cols: 62,
    link: '',
    lines: [
      ' <span class="c">CRIT</span>  L23  KUH  FR brake out of band a full lap  1043 °C',
      ' <span class="c">CRIT</span>  L23  KUH  fuel short  −0.7 laps',
      ' <span class="w">ADV </span>  L23  KUH  FR carcass above band  109 °C',
      ' <span class="w">ADV </span>  L21  KUH  one warning left before a penalty  2/3',
      ' <span class="f">CRIT  L14  KUH  damage: FL wing +12 %        acknowledged</span>',
      ' <span class="f">muted: energy (1)</span>',
    ],
  });
  page('1-car-care.html', '1 · Car care displays (milestone "car")', `
<div class="note">Every value is grey unless it is wrong or very important (UI shell rule). <b>Amber</b> = out of band or advisory, <b>red</b> = out for a full lap, a critical alarm, a negative margin. <b>White bold</b> = relevant in the current race moment (no hue: the moment brightens, it doesn't colour). The main number of a card is bold, in normal grey. Empty cells have a reason on hover. All sizes are in character cells; the widths shown are the minimum of each mode.</div>
<h2>Corner block (V22): full 44×7, compact 26×3</h2>
<div class="row">${fig(corner, 'full · FR carcass out of band (amber), FR brake out for a full lap (red)')}${fig(cornerCompact, 'compact · surface temp and wear; the worst brake and the engine')}</div>
<h2>Tyre life (V21): 47×5</h2>
<div class="row">${fig(life, 'early stint · LAPS TO 70% = laps until the wear reaches the 70 % limit at this rate · | = limit, : = the game\'s life span')}${fig(lifeNear, 'late stint · FR 2 laps to the limit (red: below the alarm threshold of 3 laps)')}</div>
<h2>Fuel (V20): 30×6</h2>
<div class="row">${fig(fuel, 'margin positive: save target empty (not applicable)')}${fig(fuelShort, 'margin negative (red): save target shown')}</div>
<div class="note">MARGIN = LASTS − TO GO: how many laps the fuel lasts at this burn, minus the laps still to race. The game's own figure is dim: its meaning (absolute laps or surplus) is unverified. Numbers are right-aligned in a fixed field, so the decimal points line up.</div>
<h2>ERS budget (V23): 50×4</h2>
<div class="row">${fig(ers(false, false, '▲ harvesting'), 'below the attack level (the | in the bar), rising; harvesting now')}${fig(ers(false, true, '▼ deploying'), 'above the attack level; deploying now')}${fig(ers(true, true, '▼ deploying'), 'battle moment: store, flow and "attack ready" white bold')}</div>
<div class="note">The attack level is the | in the bar; its value is in the panel's settings and on hover. When the store is falling and below the level, the attack text is empty. The flow (▼ deploying, ▲ harvesting, or nothing when idle) is live, from the MGU-K power. The deploy mode (none, medium, hotlap, overtake) is dropped here: the driver sets it every corner, so it says little at a glance.</div>
<h2>Damage card (V31): 44×9</h2>
<div class="row">${fig(damage, 'a new jump stays red while its lap-time loss is still being measured (two clean laps)')}</div>
<h2>Alarm list (V25): 62×6</h2>
<div class="row">${fig(alarms, 'critical first, then advisory; acknowledged ones stay, dim; muted groups as a count')}</div>`);
}

// ---------------------------------------------------------------- 2: timing
{
  const towerSpec = [{ h: 'P', w: 2, a: 'r' }, { h: '', w: 2, a: 'l' }, { h: 'DRV', w: 3, a: 'l' }, { h: 'GAP', w: 7, a: 'r' }, { h: 'INT', w: 6, a: 'r' }, { h: 'TO US', w: 6, a: 'r' }, { h: 'LAST', w: 8, a: 'r' }, { h: 'S1', w: 6, a: 'r' }, { h: 'S2', w: 6, a: 'r' }, { h: 'S3', w: 6, a: 'r' }, { h: 'T', w: 1, a: 'l' }, { h: 'AGE', w: 3, a: 'r' }, { h: 'ST', w: 2, a: 'r' }, { h: 'PEN', w: 3, a: 'r' }, { h: 'PIT', w: 3, a: 'l' }];
  const tower = panel('Timing', {
    cols: 84,
    state: 'L23/62',
    lines: [
      ...table(towerSpec, [
        { cells: ['1', '', 'VER', '', '', '−9.102', '1:44.912', C('28.104', 'b'), '41.311', '35.497', 'M', '14', '1', '', ''] },
        { cls: 'band', cells: ['2', '▲1', 'NOR', '+2.184', '+2.184', '−6.918', '1:45.031', '28.211', '41.402', '35.418', 'M', '14', '1', '', ''] },
        { cells: ['3', '▼1', 'LEC', '+5.903', '+3.719', '−3.199', '1:45.208', '28.240', '41.630', C('35.338', 'b'), 'H', '23', '0', C('5s', 'w'), ''] },
        { cls: 'me', cells: ['4', '', 'KUH', '+9.102', '+3.199', '', C('1:44.876', 'g'), '28.150', C('41.288', 'b'), C('35.438', 'g'), 'M', '12', '1', '', ''] },
        { cls: 'band', cells: ['5', '▲2', 'ALB', '+14.880', '+5.778', '+5.778', '', '28.320', '', '', 'H', '1', '1', '', 'OUT'] },
        { cells: ['6', '▼1', 'PIA', '+16.025', '+1.145', '+6.923', '1:45.660', '28.402', '41.771', '35.487', 'M', '15', '1', '', ''] },
        { cls: 'inc', cells: ['7', '', 'SAR', '+1 lap', '', '', '1:46.902', '28.771', '42.004', '36.127', 'H', '30', '0', '', ''] },
        { cls: 'f', cells: ['–', '', 'OCO', 'DNF', '', '', '', '', '', '', '', '', '', '', ''] },
      ]).map((l, i) => (i === 8 ? l.replace(/DNF\s+/, 'DNF · L23 · collision ') : l)),
    ],
  });
  const tcSpec = [towerSpec[0], towerSpec[1], towerSpec[2], towerSpec[4], towerSpec[6]];
  const towerCompact = panel('Timing', {
    cols: 30,
    state: 'L23',
    lines: [
      ...table(tcSpec, [
        { cells: ['1', '', 'VER', '', '1:44.912'] },
        { cls: 'band', cells: ['2', '▲1', 'NOR', '+2.184', '1:45.031'] },
        { cells: ['3', '▼1', 'LEC', '+3.719', '1:45.208'] },
        { cls: 'me', cells: ['4', '', 'KUH', '+3.199', C('1:44.876', 'g')] },
        { cls: 'band', cells: ['5', '▲2', 'ALB', '+5.778', ''] },
      ]),
    ],
  });
  const laSpec = [{ h: 'DRV', w: 3, a: 'l' }, { h: 'BEST', w: 8, a: 'r' }, { h: 'S1', w: 6, a: 'r' }, { h: 'S2', w: 6, a: 'r' }, { h: 'S3', w: 6, a: 'r' }, { h: 'THEO', w: 8, a: 'r' }];
  const lapAnalysis = panel('Lap analysis', {
    cols: 44,
    state: 'ref KUH',
    lines: table(laSpec, [
      { cls: 'me', cells: ['KUH', '1:44.876', '28.150', C('41.288', 'b'), '35.438', '1:44.876'] },
      { cells: ['VER', C('−0.756', 'b'), C('−0.046', 'b'), '+0.023', '+0.059', '−0.571'] },
      { cls: 'band', cells: ['NOR', '−0.574', '+0.061', '+0.114', '−0.020', '−0.433'] },
      { cells: ['LEC', '−0.278', '+0.090', '+0.342', C('−0.100', 'b'), '−0.106'] },
      { cls: 'band', cells: ['PIA', '−0.175', '+0.252', '+0.483', '+0.049', '+0.196'] },
    ]),
  });
  const pjSpec = [{ h: '', w: 7, a: 'l' }, { h: 'TIME', w: 8, a: 'r' }, { h: 'POS', w: 3, a: 'r' }, { h: 'Δ', w: 7, a: 'r' }, { h: '', w: 12, a: 'l' }];
  const projQ = panel('Projected lap', {
    cols: 42,
    state: 'Q1 · 3:12 left',
    lines: table(pjSpec, [
      { cells: ['PROJ', '1:23.412', 'P6', C('−0.118', 'g'), 'to best'] },
      { cells: ['CUT-OFF', '1:24.006', 'P15', '+0.594', 'margin'] },
      { cells: ['FINISH', '', '', '38.2 s', 'left at line'] },
    ]),
  });
  const projOut = panel('Projected lap', {
    cols: 42,
    state: 'Q1 · 1:58 left',
    lines: table(pjSpec, [
      { cells: ['PROJ', '1:24.311', 'P17', '+0.781', 'to best'] },
      { cells: ['CUT-OFF', '1:24.006', 'P15', C('−0.305', 'c'), 'margin'] },
      { cells: ['FINISH', '', '', '21.4 s', 'left at line'] },
    ]),
  });
  const projOutLap = panel('Projected lap', {
    cols: 42,
    state: 'Q2 · 1:31 left',
    lines: table(pjSpec, [
      { cells: ['PROJ', '', '', '', C('out lap', 'f')] },
      { cells: ['CUT-OFF', '1:23.870', 'P10', '', ''] },
      { cells: ['FINISH', '', '', '3.9 s', 'left at line'] },
    ]),
  });
  const btSpec = [{ h: '', w: 6, a: 'l' }, { h: 'DRV', w: 3, a: 'l' }, { h: 'GAP', w: 6, a: 'r' }, { h: 'CLOSING', w: 10, a: 'r' }, { h: 'TO DRS', w: 8, a: 'r' }, { h: 'PACE Δ', w: 6, a: 'r' }, { h: 'MARGIN', w: 6, a: 'r' }, { h: 'TYRES', w: 7, a: 'l' }, { h: 'ERS', w: 6, a: 'r' }];
  const battle = (hi) => panel('Battle', {
    cols: 70,
    lines: table(btSpec, [
      { cells: ['AHEAD', 'LEC', '+3.199', '0.31 s/lap', '7.1 laps', '+0.29', '−0.71', 'M12 H23', '3.1 MJ'] },
      { cls: 'band', cells: ['BEHIND', hi ? C('ALB', 'hi') : 'ALB', hi ? C('−0.841', 'hi') : '−0.841', '0.22 s/lap', hi ? C('in DRS', 'hi') : 'in DRS', '−0.42', '−1.42', 'M12 H1', ''] },
    ]),
  });
  const feed = (hi) => panel('Incidents', {
    cols: 70,
    link: '',
    lines: [
      ` ${hi ? '<span class="w">' : ''}L23  OCO SAR  collision           lost 4.2 s  us P5→P4, OCO +4.1→DNF${hi ? '</span>' : ''}`,
      ' L22  ALB      time loss (T7)      lost 6.1 s  us —, ALB −1.9→+5.8',
      '<span class="f"> L21  PIA      warning 2/3</span>',
      '<span class="f"> L19  SC       safety car deployed</span>',
      ' L14  KUH      damage FL wing +12  lost <span class="tip">      </span>',
    ],
  });
  page('2-timing.html', '2 · Timing displays (milestone "race")', `
<div class="note">Same colour rules as page 1, with A1 (letter-only compounds) and B2 (purple for everyone, green only for our cars) applied. <b>L23 is always a lap number; a count of laps always says "laps".</b> <b>Amber left bar</b> in the tower = a car involved in a major incident in the incident moment (here SAR, after its collision with OCO). Gaps come from our own mini-sector timing, the same numbers in every display.</div>
<h2>Timing tower (V29): full 84×9, compact 30×6</h2>
<div class="row">${fig(tower, 'full · ▲▼ position change since the start · TO US = gap to our car · SAR one lap down · OCO retired, dim, at the bottom')}</div>
<div class="row" style="margin-top:12px">${fig(towerCompact, 'compact · drops GAP, TO US, sectors, tyre, stops, penalties first')}</div>
<h2>Lap analysis (V28): 44×6</h2>
<div class="row">${fig(lapAnalysis, 'deltas to the reference car (our car, in absolute times); purple = session best; THEO = theoretical best')}</div>
<h2>Projected lap (V10 + V11): 42×4</h2>
<div class="note">Δ in the PROJ row = to our best lap (green: a new personal best); in the CUT-OFF row = our margin to the cut-off (negative = outside). FINISH = time left on the clock when we cross the line: positive means another lap can still start.</div>
<div class="row">${fig(projQ, 'Q1 push lap, inside the cut-off')}${fig(projOut, 'projection outside the cut-off (red)')}${fig(projOutLap, 'out lap: no projection yet')}</div>
<h2>Battle cards (V14): 70×3</h2>
<div class="row">${fig(battle(false), 'one row per neighbour · PACE Δ positive = we are faster · MARGIN = pace delta minus the overtaking threshold (1.0 s) · TYRES ours then theirs · empty ERS = hidden by realism')}${fig(battle(true), 'battle moment: the row in DRS range (ALB, behind) turns white bold')}</div>
<h2>Incident feed (V35): 70×5</h2>
<div class="row">${fig(feed(false), 'minor entries (warnings, SC start) dim · an unresolved time loss is empty')}${fig(feed(true), 'incident moment: the newest major entry in amber')}</div>`);
}

// ---------------------------------------------------------------- 3: gap chart
{
  const W = 760, H = 320, L = 54, T = 16, R = 70, B = 34, laps = 23, gMin = -2, gMax = 26;
  const x = (lap) => L + ((W - L - R) * (lap - 1)) / (laps - 1);
  const y = (g) => T + ((H - T - B) * (g - gMin)) / (gMax - gMin); // behind the reference = lower
  // slower = s/lap slower than the reference pace (the leader's average); loss = one-off time loss on a lap
  const cars = [
    { n: 'VER', c: '#cfb2ff', slower: 0.0 },
    { n: 'NOR', c: '#febf84', slower: 0.12 },
    { n: 'LEC', c: '#c13b43', slower: 0.26 },
    { n: 'KUH', c: '#ffffff', slower: 0.36, own: true },
    { n: 'PIA', c: '#febf84', slower: 0.47, d: true },
    { n: 'ALB', c: '#3b6bd4', slower: 0.58, loss: { 22: 6 } },
    { n: 'SAR', c: '#3b6bd4', slower: 0.92, d: true },
  ];
  let svg = `<svg width="${W}" height="${H}" style="background:#000">`;
  svg += `<rect x="${x(17)}" y="${T}" width="${x(19) - x(17)}" height="${H - T - B}" fill="#141416"/><text x="${x(17) + 4}" y="${H - B - 6}" fill="#5c6068">SC</text>`;
  for (let g = 0; g <= 25; g += 5) svg += `<line x1="${L}" x2="${W - R}" y1="${y(g)}" y2="${y(g)}" stroke="#1c1d21"/><text x="${L - 6}" y="${y(g) + 4}" fill="#5c6068" text-anchor="end">${g === 0 ? '0' : '+' + g}</text>`;
  for (let l = 1; l <= laps; l += 2) svg += `<line y1="${T}" y2="${H - B}" x1="${x(l)}" x2="${x(l)}" stroke="#1c1d21"/><text x="${x(l)}" y="${H - B + 14}" fill="#5c6068" text-anchor="middle">${l}</text>`;
  svg += `<text x="${(L + W - R) / 2}" y="${H - 4}" fill="#8d9199" text-anchor="middle">lap</text><text x="14" y="${(T + H - B) / 2}" fill="#8d9199" transform="rotate(-90 14 ${(T + H - B) / 2})" text-anchor="middle">behind reference, s</text>`;
  const ends = [];
  cars.forEach((car, i) => {
    const pts = [];
    let g = 0;
    for (let l = 1; l <= laps; l++) {
      g += car.slower + (car.loss?.[l] ?? 0) + Math.sin(l * 1.7 + i) * 0.08;
      if (l === 18) g = i * 0.9; // the SC bunches the field: about 0.9 s per place
      pts.push([x(l), y(g)]);
    }
    svg += `<polyline points="${pts.map(([a, b]) => a.toFixed(1) + ',' + b.toFixed(1)).join(' ')}" fill="none" stroke="${car.c}" stroke-width="${car.own ? 3 : 1.5}" ${car.d ? 'stroke-dasharray="6 4"' : ''}/>`;
    ends.push({ car, y: pts.at(-1)[1] });
  });
  ends.sort((p, q) => p.y - q.y);
  for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 13); // labels never overlap
  for (const e of ends) svg += `<text x="${W - R + 6}" y="${e.y + 4}" fill="${e.car.c}" ${e.car.own ? 'font-weight="700"' : ''}>${e.car.n}</text>`;
  svg += '</svg>';
  const chart = `<div class="panel" style="width:${W}px"><div class="ph"><span class="t">Gap chart</span><span class="lk">1 · KUH</span><span class="sp"></span><span class="age">ref leader avg 1:45.12</span><span>${GEAR}</span></div>${svg}</div>`;
  page('3-gap-chart.html', '3 · Gap chart (V04)', `
<div class="note">The gapper (race history chart): each car's gap to a virtual car running the reference pace, per lap. Flat = on reference pace, a line that drops = losing time to it, rising = gaining. ALB's step on lap 22 is its time loss. <b>Our car is the only white line</b> (thicker); every other car has its team colour, teammates dashed (UI shell rule). The SC phase is a band; the field bunches behind it. The reference is in the header and can be switched to another car's average or a fixed lap time (a topic param). Axes are always labelled; a wider panel shows more laps, never thicker lines.</div>
${chart}`);
}

// ---------------------------------------------------------------- 4: layouts
{
  // 1920×1080 at 14 px: 1920 / 8.4 ≈ 228 columns, (1080 − top bar) / 19.6 ≈ 53 rows.
  const screen = (name, w, h, boxes) => {
    let s = `<div style="position:relative;width:${w}px;height:${h}px;background:#000;border:1px solid #25272c;display:inline-block;margin-right:20px;vertical-align:top">`;
    s += `<div style="position:absolute;left:0;top:0;right:0;height:18px;background:#141416;color:#8d9199;font-size:11px;padding:0 6px;line-height:18px">top bar</div>`;
    for (const [label, gx, gy, gw, gh, note] of boxes) {
      s += `<div style="position:absolute;left:${gx * w + 3}px;top:${18 + gy * (h - 18) + 3}px;width:${gw * w - 6}px;height:${gh * (h - 18) - 6}px;border:1px solid #25272c;background:#0d0d0f;font-size:11px;line-height:1.3;padding:3px 5px;overflow:hidden"><span style="color:#d9dbe0">${label}</span><br><span style="color:#5c6068">${note ?? ''}</span></div>`;
    }
    return s + `</div>`;
  };
  const W24 = 576, H24 = 324, W14 = 400, H14 = 225; // 1920×1080 each, drawn at 0.3 and ~0.21
  const careSide = [
    ['corner-block', 0, 0, 0.5, 0.45, 'full'],
    ['tyre-life-bar', 0.5, 0, 0.5, 0.45, ''],
    ['fuel-gauge', 0, 0.45, 0.25, 0.3, ''],
    ['ers-budget', 0.25, 0.45, 0.45, 0.3, ''],
    ['damage-card', 0.7, 0.45, 0.3, 0.3, 'compact'],
    ['alarm-list', 0, 0.75, 1, 0.25, ''],
  ];
  const car24 = [
    ['corner-block', 0, 0, 0.4, 0.5, 'full'],
    ['tyre-life-bar', 0.4, 0, 0.35, 0.5, ''],
    ['fuel-gauge', 0.75, 0, 0.25, 0.5, ''],
    ['ers-budget', 0, 0.5, 0.4, 0.25, ''],
    ['damage-card', 0.4, 0.5, 0.35, 0.5, ''],
    ['alarm-list', 0, 0.75, 0.4, 0.25, ''],
    ['(free)', 0.75, 0.5, 0.25, 0.5, 'lap-analysis later'],
  ];
  const quali24 = [
    ['timing-tower', 0, 0, 0.55, 1, 'full, 20 rows'],
    ['lap-analysis', 0.55, 0, 0.45, 0.6, 'ref: our car'],
    ['projected-lap', 0.55, 0.6, 0.45, 0.4, ''],
  ];
  const race24 = [
    ['timing-tower', 0, 0, 0.45, 1, 'full, 20 rows'],
    ['gap-chart', 0.45, 0, 0.55, 0.55, 'ref leader avg'],
    ['battle-cards', 0.45, 0.55, 0.27, 0.45, ''],
    ['incident-feed', 0.72, 0.55, 0.28, 0.45, ''],
  ];
  page('4-layouts.html', '4 · Default workbooks (spec 9)', `
<div class="note">Proportions on a 1920×1080 screen each; the 24" main monitor left, the 14" side monitor right. At 14 px a 24" window holds about 228 × 53 character cells. The 14" window will likely get a different font size (Ctrl+= / Ctrl+-, saved per window). The layouts are starting points: panels can be dragged and resized, and the workbook saves it.</div>
<h2>car (milestone "car"; training): one monitor</h2>
<div>${screen('car', W24, H24, car24)}</div>
<h2>quali (practice and qualifying)</h2>
<div>${screen('quali main', W24, H24, quali24)}${screen('quali side', W14, H14, careSide)}</div>
<h2>race</h2>
<div>${screen('race main', W24, H24, race24)}${screen('race side', W14, H14, careSide)}</div>
<div class="q"><b>Main = race awareness and timing, side = car care</b> in both quali and race, so your eyes learn one place per job. Car care is the job that always runs, but it is mostly grey until something goes wrong, which suits the side screen: a highlight there still catches the eye.</div>`);
}
console.log('written');
