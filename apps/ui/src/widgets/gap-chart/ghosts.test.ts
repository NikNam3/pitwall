// The gap chart's ghost lines (SP4.2 spec 4, Task 13; K9; mockup docs/design/2026-10-30-sp4a-displays/1-ghost-views.html).
// Contract of the pure helpers the display draws from (C65: the display adds nothing to the topic's points):
//  - `ghostSeries(ghosts, primary)` in `series.ts`: from `rejoin.ghostLines`, the lines of `primary` only (the car of
//    the panel's `rejoin.car`), one series per condition in the order green, VSC, SC, a condition without points left
//    out; x as the topic gives it, y = -gap / 1000 like every gapper line; label `ghostLetter(c)` (`G`, `VSC`, `SC`);
//    `colour: { colour: role(GHOST_ROLE), dashed: false, ownCar: false }`, `dash: GHOST_DASH[c]`, `widthPx: 1`,
//    `labelRank: 1`; no ghosts or no primary gives `[]`;
//  - the kit chart (a supervisor change this task requests): `ChartSeries` gains `dash` (the line's own dash, px),
//    `widthPx` (its own width) and `labelRank`; `endLabels` gives each label `rank` (`labelRank`, else 0 for an own
//    car and 2 for every other line); `placeLabels`' fourth argument is the ranks: when not all fit, the lowest rank
//    keeps its label first, ties by distance to the nearest rank-0 end;
//  - `ghostLosses(rejoin)` in `text.ts`: per condition, in the order green, VSC, SC, `{ condition, letter, loss, source }`
//    with `loss` the loss in seconds to tenths as a kit cell part (an unknown loss its unknown part) and `source` the
//    loss's source for the badge; `text.pit` is the header's word before them; no `rejoin.car` gives `[]`.
import { describe, expect, it } from 'vitest';
import type { CarOverview, SessionInfo } from '@pitwall/contracts';
import { carId, unknown } from '@pitwall/domain';
import type { GapperLines, GhostLines } from '@pitwall/domain';
import { ourCars } from '../../kit/car/our-cars.ts';
import { endLabels, placeLabels } from '../../kit/chart/labels.ts';
import { GHOST_DASH, GHOST_ROLE } from '../../kit/ghost/ghost.ts';
import { unknownPart } from '../../kit/grid/grid.ts';
import { sourceMark } from '../../kit/text.ts';
import { role } from '../../theme/index.ts';
import { ghostLinesOf, KUH, LOSS_SOURCE, rejoinOf, ZHO } from './fixtures.ts';
import { gapSeries, ghostSeries } from './series.ts';
import * as text from './text.ts';
import { ghostLosses } from './text.ts';

const ghostLook = { colour: role(GHOST_ROLE), dashed: false, ownCar: false };

describe('ghostSeries: the primary car', () => {
  // KUH 800 ms a lap behind the reference, ZHO 1200, over laps 18 to 23 (the last `ghostLaps` = 6 laps)
  const ghosts = ghostLinesOf([KUH, ZHO], [800, 1200], 18, 23);

  it("draws the primary car's three ghost lines, labelled G, VSC, SC in that order", () => {
    expect(ghostSeries(ghosts, KUH).map((s) => s.label)).toEqual(['G', 'VSC', 'SC']);
  });

  it("plots the topic's points as they are: x the lap, y = -gap / 1000 (the loss is already in the gap)", () => {
    const [g, vsc, sc] = ghostSeries(ghosts, KUH);
    expect(g?.points).toEqual([[18, -34.7], [19, -35.5], [20, -36.3], [21, -37.1], [22, -37.9], [23, -38.7]]);
    expect(vsc?.points.at(-1)).toEqual([23, -31.5]);
    expect(sc?.points.at(-1)).toEqual([23, -28.2]);
  });

  it('draws every ghost line in GHOST_ROLE, 1 px, dashed by condition with GHOST_DASH, never as our car', () => {
    const [g, vsc, sc] = ghostSeries(ghosts, KUH);
    expect(g).toMatchObject({ colour: ghostLook, dash: GHOST_DASH.green, widthPx: 1 });
    expect(vsc).toMatchObject({ colour: ghostLook, dash: GHOST_DASH.vsc, widthPx: 1 });
    expect(sc).toMatchObject({ colour: ghostLook, dash: GHOST_DASH.sc, widthPx: 1 });
  });

  it('has no live end: a ghost line is the topic\'s points only', () => {
    for (const s of ghostSeries(ghosts, KUH)) expect(s).not.toMatchObject({ liveEnd: true });
  });

  it('ranks the ghost labels after our cars and before the field (labelRank 1)', () => {
    expect(ghostSeries(ghosts, KUH).map((s) => s.labelRank)).toEqual([1, 1, 1]);
  });

  it('names the conditions in the order G, VSC, SC whatever the order of the topic', () => {
    const shuffled: GhostLines = { lines: [...ghosts.lines].reverse() };
    expect(ghostSeries(shuffled, KUH).map((s) => s.label)).toEqual(['G', 'VSC', 'SC']);
  });

  it('leaves out a condition without points', () => {
    const noVsc: GhostLines = { lines: ghosts.lines.map((l) => (l.carId === KUH && l.condition === 'vsc' ? { ...l, points: [] } : l)) };
    expect(ghostSeries(noVsc, KUH).map((s) => s.label)).toEqual(['G', 'SC']);
  });
});

describe('ghostSeries: the other car', () => {
  const ghosts = ghostLinesOf([KUH, ZHO], [800, 1200], 18, 23);

  it("draws none of the other car's ghost lines", () => {
    const drawn = ghostSeries(ghosts, KUH).flatMap((s) => s.points);
    expect(drawn).not.toContainEqual([23, -(1200 * 23 + 20_300) / 1000]);
    expect(ghostSeries(ghosts, KUH)).toHaveLength(3);
  });

  it("draws the teammate's ghost lines only when the teammate is the panel's car", () => {
    const [g] = ghostSeries(ghosts, ZHO);
    expect(g?.points.at(-1)).toEqual([23, -(1200 * 23 + 20_300) / 1000]);
    expect(ghostSeries(ghosts, ZHO)).toHaveLength(3);
  });

  it('draws nothing for a car without ghost lines (a rival: rejoin covers our cars only)', () => {
    expect(ghostSeries(ghosts, carId(5))).toEqual([]);
  });
});

describe('ghostSeries: no ghost topic', () => {
  it('draws no ghost line without `rejoin.ghostLines`', () => {
    expect(ghostSeries(undefined, KUH)).toEqual([]);
  });

  it('draws no ghost line without `rejoin.car` (no primary car of ours)', () => {
    expect(ghostSeries(ghostLinesOf([KUH], [800], 18, 23), undefined)).toEqual([]);
  });
});

describe('ghost labels through placeLabels', () => {
  const cars = [
    { id: carId(0), identity: { name: 'Kuhnlein', teamId: 7, raceNumber: 44 } },
    { id: carId(2), identity: { name: 'Verstappen', teamId: 2, raceNumber: 1 } },
    { id: carId(3), identity: { name: 'Norris', teamId: 8, raceNumber: 4 } },
    { id: carId(4), identity: { name: 'Piastri', teamId: 8, raceNumber: 81 } },
  ] as unknown as CarOverview[];
  const ours = ourCars({ playerCar: KUH } as SessionInfo);
  const pts = (step: number) => [18, 19, 20, 21, 22, 23].map((lap) => ({ lap, gapMs: step * lap }));
  const lines: GapperLines = {
    reference: { kind: 'leaderAverage', carId: unknown('notApplicable') },
    referenceLapMs: unknown('insufficientData'),
    cars: [
      { carId: carId(2), points: pts(0), now: unknown('notApplicable') },
      { carId: carId(3), points: pts(100), now: unknown('notApplicable') },
      { carId: KUH, points: pts(800), now: unknown('notApplicable') },
      { carId: carId(4), points: pts(1000), now: unknown('notApplicable') },
    ],
    phases: [],
  };
  /** The end labels of the field's lines and then KUH's ghost lines. */
  const labelsOf = () => endLabels([...gapSeries(lines, cars, ours), ...ghostSeries(ghostLinesOf([KUH], [800], 18, 23), KUH)], [18, 23]);

  it('gives our car rank 0, the ghosts rank 1 and the field rank 2', () => {
    const labels = labelsOf();
    expect(labels.map((l) => [l.text, l.rank])).toEqual([['VER', 2], ['NOR', 2], ['KUH', 0], ['PIA', 2], ['G', 1], ['VSC', 1], ['SC', 1]]);
  });

  it('keeps our label, then the ghosts\', before any of the field when not all fit', () => {
    // seven labels, room for four: KUH, G, VSC, SC keep theirs; the field's are dropped (their lines stay)
    const labels = labelsOf();
    const ends = labels.map((l) => 200 - 4 * l.value);
    const placed = placeLabels(ends, 13, 52, labels.map((l) => l.rank));
    expect(labels.filter((_, i) => placed[i] !== undefined).map((l) => l.text)).toEqual(['KUH', 'G', 'VSC', 'SC']);
  });

  it('keeps every label when all fit', () => {
    const labels = labelsOf();
    const ends = labels.map((l) => 200 - 4 * l.value);
    expect(placeLabels(ends, 13, 400, labels.map((l) => l.rank)).every((y) => y !== undefined)).toBe(true);
  });
});

describe('ghostLosses: the header', () => {
  /** The header as the display shows it: `pit`, then per condition its letter and loss with the badge mark. */
  const header = (parts: ReturnType<typeof ghostLosses>): string =>
    [text.pit, ...parts.map((p) => `${p.letter} ${p.loss.reason === undefined ? p.loss.text : `[${p.loss.reason}]`}${sourceMark[p.source.kind]}`)].join(' ');

  it("names rejoin.car's losses per condition with their source badges: pit G 20.3 VSC 13.1ᶜ SC 9.8ᵈ", () => {
    expect(header(ghostLosses(rejoinOf(KUH)))).toBe('pit G 20.3 VSC 13.1ᶜ SC 9.8ᵈ');
  });

  it("gives each loss its own source for the badge's hover", () => {
    expect(ghostLosses(rejoinOf(KUH)).map((p) => [p.condition, p.source])).toEqual([
      ['green', LOSS_SOURCE.green],
      ['vsc', LOSS_SOURCE.vsc],
      ['sc', LOSS_SOURCE.sc],
    ]);
  });

  it('puts an unknown loss as its unknown part where the loss goes', () => {
    const parts = ghostLosses(rejoinOf(KUH, { vsc: unknown('insufficientData') }));
    expect(parts[1]?.loss).toStrictEqual(unknownPart('insufficientData'));
    expect(header(parts)).toBe('pit G 20.3 VSC [insufficientData]ᶜ SC 9.8ᵈ');
  });

  it('is empty without rejoin.car: the header as today', () => {
    expect(ghostLosses(undefined)).toEqual([]);
  });
});
