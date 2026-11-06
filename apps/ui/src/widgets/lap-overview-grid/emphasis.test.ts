// The lap overview's emphasis (C68; mockups 4-longrun.html and the Task 0 change changes.html, README Q1 A). Contract
// assumed of `emphasis.ts`:
//  - `heatBackground(heat: Known<Ratio>): string | undefined`: the lap cell's background, the theme's `bgBand` at heat 0
//    (the stint's fastest pace lap) to `textFaint` at heat 1 (its slowest), as a CSS mix of the two roles in whole
//    percent, `color-mix(in srgb, <textFaint> P%, <bgBand>)` with P = the heat × 100 rounded; `undefined` (no background)
//    for an unknown heat;
//  - `lapRole(lap: { best, heat }): Role | undefined`: the lap time's colour: `best` for the session best, `personalBest`
//    for the car's best, both whether the lap has a heat or not; else `textDim` for a lap without heat; else none;
//  - `statusRole(status: LapStatus): Role | undefined`: the status strip's colour: `flagYellow` for VSC and SC,
//    `flagRed` for red (Task 0 Q1 A), none for green.
// Colour only to highlight: nothing else of the grid takes a role here.
import { describe, expect, it } from 'vitest';
import { role } from '../../theme/roles.ts';
import { heatBackground, lapRole, statusRole } from './emphasis.ts';
import { heat, noHeat } from './fixtures.ts';

const mix = (pct: number): string => `color-mix(in srgb, ${role('textFaint')} ${pct}%, ${role('bgBand')})`;

describe('heatBackground', () => {
  it('is the band background at heat 0: the stint\'s fastest pace lap', () => {
    expect(heatBackground(heat(0))).toBe(mix(0));
  });

  it('is the faint text colour at heat 1: the stint\'s slowest pace lap', () => {
    expect(heatBackground(heat(1))).toBe(mix(100));
  });

  it('mixes the two roles by the heat in whole percent', () => {
    expect(heatBackground(heat(0.25))).toBe(mix(25));
    expect(heatBackground(heat(1 / 3))).toBe(mix(33));
    expect(heatBackground(heat(0.666))).toBe(mix(67));
  });

  it('gives no background to a lap without heat', () => {
    expect(heatBackground(noHeat)).toBeUndefined();
  });
});

describe('lapRole', () => {
  it('colours the session best purple', () => {
    expect(lapRole({ best: 'session', heat: heat(0) })).toBe('best');
  });

  it('colours the car\'s personal best green', () => {
    expect(lapRole({ best: 'personal', heat: heat(0) })).toBe('personalBest');
  });

  it('keeps a best\'s colour on a lap without heat', () => {
    expect(lapRole({ best: 'session', heat: noHeat })).toBe('best');
    expect(lapRole({ best: 'personal', heat: noHeat })).toBe('personalBest');
  });

  it('dims a lap without heat (outside its stint\'s pace laps)', () => {
    expect(lapRole({ best: 'none', heat: noHeat })).toBe('textDim');
  });

  it('leaves a pace lap that is no best in the text colour', () => {
    expect(lapRole({ best: 'none', heat: heat(0.4) })).toBeUndefined();
  });
});

describe('statusRole', () => {
  it('marks VSC and SC yellow', () => {
    expect(statusRole('vsc')).toBe('flagYellow');
    expect(statusRole('sc')).toBe('flagYellow');
  });

  it('marks red in the red flag\'s role (Task 0 Q1 A)', () => {
    expect(statusRole('red')).toBe('flagRed');
  });

  it('leaves green unmarked', () => {
    expect(statusRole('green')).toBeUndefined();
  });
});
