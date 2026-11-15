// The shared neutralisations (`shared/neutralised.ts`, Task 19): the readers of the old flag phases (`gaps`, `incidents`,
// `race-moment`) take the session-phase spans instead (C20, C43). `neutralisedSpans` gives the closed `neutralised`
// and `suspended` spans of the session-phase sub-machines from the projection plus the open one from the situation; a
// `neutralised` span closed with `confirmed: false` is no neutralisation (C18), an open one still waiting for its
// confirmation is one (ruling 2). `leaderLapAt` gives the leader's lap at a frame from the projection's laps (ruling 3,
// C26, C45).
import { carId, type LapRecord, type OpenSpan, type Span } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { engineView, lap, neutralisation, openNeutralisation, phaseSpans } from '../../../../test-support/builders/index.ts';
import { gapsCalculator } from '../../src/gaps/calculator.ts';
import { incidentsCalculator } from '../../src/incidents/calculator.ts';
import { raceMomentCalculator } from '../../src/race-moment/calculator.ts';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isEnding,
  lastNeutralisation,
  leaderLapAt,
  neutralisedSpans,
  openNeutralisation as openNeutralisationOf,
  timeLossExcludedOf,
} from '../../src/shared/neutralised.ts';
import { gaps } from '../gaps/race.ts';
import { incidents, LAPS, leaderLaps, location, race, viewOf } from '../incidents/race.ts';
import { HUMAN, SLOW_END, SLOW_START, timeLossCase } from './time-loss-cases.ts';

/** A closed span of `session-phase-race` of another kind (`racing`, `grid`, ...), from `start` to `end`. */
const phase = (kind: string, start: number, end: number, id: number): Span => ({
  ...neutralisation({ start, end, id }),
  kind,
  detail: undefined,
});

/** The neutralisations of a view over these closed spans and this open one. */
const of = (closed: Span[], open?: OpenSpan, weekendPhase = engineView().situation.weekendPhase) => {
  const { spans, situation } = phaseSpans(closed, open, { weekendPhase, byMachine: {} });
  const view = engineView({ history: { spans }, situation });
  return neutralisedSpans(view.history, view.situation);
};

describe('neutralisedSpans', () => {
  it('is empty without a neutralised or suspended span', () => {
    expect(of([])).toEqual([]);
    expect(of([phase('grid', 0, 10, 0), phase('racing', 10, 500_000, 1)], { ...openNeutralisation({ start: 500_000, id: 2 }), kind: 'racing', detail: undefined })).toEqual([]);
  });

  it('gives the closed neutralised and suspended spans of the race in their order, no other kind', () => {
    const sc = neutralisation({ kind: 'SC', start: 100_000, end: 200_000, id: 2 });
    const red = neutralisation({ kind: 'red', start: 300_000, end: 400_000, id: 4 });
    const vsc = neutralisation({ kind: 'VSC', start: 500_000, end: 560_000, id: 6 });
    const closed = [phase('racing', 0, 100_000, 1), sc, phase('racing', 200_000, 300_000, 3), red, phase('startLights', 400_000, 450_000, 5), vsc];
    expect(of(closed)).toEqual([sc, red, vsc]);
  });

  it('a `neutralised` span closed with `confirmed: false` is no neutralisation (C18, C43)', () => {
    const never = neutralisation({ kind: 'SC', start: 100_000, end: 103_000, confirmed: false, id: 2 });
    const vsc = neutralisation({ kind: 'VSC', start: 200_000, end: 260_000, id: 4 });
    expect(of([never])).toEqual([]);
    expect(of([never, vsc])).toEqual([vsc]);
  });

  it('adds the open neutralisation or suspension of the situation after the closed ones', () => {
    const sc = neutralisation({ kind: 'SC', start: 100_000, end: 200_000, id: 2 });
    const vsc = openNeutralisation({ kind: 'VSC', start: 300_000, id: 4 });
    const red = openNeutralisation({ kind: 'red', start: 300_000, id: 4 });
    expect(of([sc], vsc)).toEqual([sc, vsc]);
    expect(of([sc], red)).toEqual([sc, red]);
    expect(of([], vsc)).toEqual([vsc]);
  });

  it('an open neutralisation still waiting for its confirmation counts (ruling 2: the earliest reliable signal, C18)', () => {
    const pending = openNeutralisation({ kind: 'SC', start: 300_000, confirmed: false, id: 4 });
    expect(of([], pending)).toEqual([pending]);
  });

  it("covers every session-phase sub-machine: a qualifying's suspensions, closed and open", () => {
    const qualifying = { kind: 'qualifying', format: 'grandPrix', segment: 1 } as const;
    const red = neutralisation({ kind: 'red', start: 100_000, end: 400_000, id: 1, machine: 'session-phase-qualifying' });
    const again = openNeutralisation({ kind: 'red', start: 500_000, id: 3, machine: 'session-phase-qualifying' });
    expect(of([red], again, qualifying)).toEqual([red, again]);
  });

  it("and a practice's suspensions, closed and open; the other kinds of either are none", () => {
    const practice = { kind: 'practice', format: 'practice', segment: 1 } as const;
    const machine = 'session-phase-practice';
    const running = { ...neutralisation({ start: 0, end: 100_000, id: 0, machine }), kind: 'running', detail: undefined };
    const red = neutralisation({ kind: 'red', start: 100_000, end: 400_000, id: 1, machine });
    const again = openNeutralisation({ kind: 'red', start: 500_000, id: 3, machine });
    expect(of([running, red], again, practice)).toEqual([red, again]);
  });
});

describe('leaderLapAt', () => {
  /** Car `id`'s lap `n`, completed on frame `frame`. */
  const done = (id: number, n: number, frame: number): LapRecord => lap({ carId: carId(id), lapNumber: n, completedAt: frame, frame });

  it('is lap 1 before any lap is completed', () => {
    expect(leaderLapAt([], 500)).toBe(1);
    expect(leaderLapAt([done(0, 1, 600)], 500)).toBe(1);
  });

  it('is one more than the most laps any car completed by the frame, that frame included', () => {
    const laps = [done(0, 1, 100), done(1, 1, 110), done(0, 2, 200), done(1, 2, 220), done(0, 3, 300)];
    expect(leaderLapAt(laps, 199)).toBe(2);
    expect(leaderLapAt(laps, 200)).toBe(3);
    expect(leaderLapAt(laps, 299)).toBe(3);
    expect(leaderLapAt(laps, 300)).toBe(4);
  });

  it('is the leader whichever car it is: the most laps by then, a lapped car does not lower it', () => {
    const laps = [done(3, 1, 100), done(0, 1, 120), done(3, 2, 200), done(3, 3, 300), done(0, 2, 310)];
    expect(leaderLapAt(laps, 305)).toBe(4);
  });

  it('a provisional lap and the confirmed lap that supersedes it count as one lap (C25)', () => {
    const provisional = { ...done(0, 1, 100), status: 'provisional' as const };
    const confirmed = { ...done(0, 1, 100), supersedes: { list: 'laps' as const, index: 0 } };
    expect(leaderLapAt([provisional], 100)).toBe(2);
    expect(leaderLapAt([provisional, confirmed], 100)).toBe(2);
  });
});

// Ruling 4 (Task 19): the three readers name one source, `neutralisedSpans`, so they agree on what was neutralised (C43).
describe('gaps, incidents and race-moment read the same neutralisations', () => {
  const sc = neutralisation({ kind: 'SC', start: 100_000, end: 160_000, id: 2 });
  const never = neutralisation({ kind: 'SC', start: 300_000, end: 303_000, confirmed: false, id: 4 });
  const pending = openNeutralisation({ kind: 'VSC', start: 600_000, confirmed: false, id: 6 });
  const view = viewOf({ miniSectors: race(), phases: [sc, never], open: pending, laps: leaderLaps(LAPS) });

  it('each declares the spans of the three session-phase sub-machines that neutralisedSpans reads (C41)', () => {
    for (const unit of [gapsCalculator, incidentsCalculator]) {
      expect(unit.reads, unit.id).toEqual(expect.arrayContaining(['spans:session-phase-race', 'spans:session-phase-qualifying', 'spans:session-phase-practice']));
    }
    // race-moment is race only (C14, C46): it reads the weekend phase and the race's session phase
    expect(raceMomentCalculator.reads).toEqual(expect.arrayContaining(['spans:weekend-phase', 'spans:session-phase-race']));
  });

  it('the confirmed SC and the pending VSC; the SC never confirmed in none of them', () => {
    expect(gaps.output(gaps.init(view)).phases.map((p) => p.kind)).toEqual(['SC', 'VSC']);
    const feed = incidents.output(incidents.init(view)).feed;
    expect(feed.filter((e) => e.kind === 'neutralised').map((e) => e.at)).toEqual([600_000, 100_000]);
    const racing: OpenSpan = { machine: 'weekend-phase', id: 0, kind: 'race', start: 0, confirmed: true, detail: { format: 'grandPrix' }, startFrame: 1 };
    const raceView = { ...view, situation: { ...view.situation, byMachine: { ...view.situation.byMachine, 'weekend-phase': [racing] } } };
    expect(raceMomentCalculator.compute(raceView)).toMatchObject({ known: true, value: { moment: 'neutralised', cause: { params: { kind: 'VSC' } }, since: { value: 600_000 } } });
  });
});

// SP4.3c Task 4 (spec §5.3 O6; C18, C26, C43): `shared/neutralised.ts` owns what a neutralisation is. The open one and
// its kind, the last one (confirmed only), whether it is ending, and the time-loss exclusion every unit passes to
// `timeLossEvents` (from the projection module's membership, never its own frame comparison).
describe('openNeutralisation (Task 4)', () => {
  const viewWith = (open?: OpenSpan, closed: Span[] = []) => {
    const { spans, situation } = phaseSpans(closed, open);
    return engineView({ history: { spans }, situation });
  };

  it('an open SC span → kind SC, with that span; a VSC → VSC; a suspension → red', () => {
    const sc = openNeutralisation({ kind: 'SC', start: 300_000, id: 4 });
    expect(openNeutralisationOf(viewWith(sc))).toEqual({ kind: 'SC', span: sc });
    const vsc = openNeutralisation({ kind: 'VSC', start: 300_000, id: 4 });
    expect(openNeutralisationOf(viewWith(vsc))).toEqual({ kind: 'VSC', span: vsc });
    const red = openNeutralisation({ kind: 'red', start: 300_000, id: 4 });
    expect(openNeutralisationOf(viewWith(red))).toEqual({ kind: 'red', span: red });
  });

  it('an open SC still waiting for its confirmation is one (its earliest reliable signal, C18)', () => {
    const pending = openNeutralisation({ kind: 'SC', start: 300_000, confirmed: false, id: 4 });
    expect(openNeutralisationOf(viewWith(pending))).toEqual({ kind: 'SC', span: pending });
  });

  it('none open → null, a closed SC before it notwithstanding; another open kind → null', () => {
    const closedSc = neutralisation({ kind: 'SC', start: 100_000, end: 200_000, id: 2 });
    expect(openNeutralisationOf(viewWith(undefined, [closedSc]))).toBeNull();
    const racing: OpenSpan = { ...openNeutralisation({ start: 200_000, id: 3 }), kind: 'racing', detail: undefined };
    expect(openNeutralisationOf(viewWith(racing, [closedSc]))).toBeNull();
  });

  it("a qualifying's open suspension → red", () => {
    const qualifying = { kind: 'qualifying', format: 'grandPrix', segment: 1 } as const;
    const red = openNeutralisation({ kind: 'red', start: 500_000, id: 3, machine: 'session-phase-qualifying' });
    const { spans, situation } = phaseSpans([], red, { weekendPhase: qualifying, byMachine: {} });
    expect(openNeutralisationOf(engineView({ history: { spans }, situation }))).toEqual({ kind: 'red', span: red });
  });
});

describe('lastNeutralisation (Task 4, B7)', () => {
  const last = (closed: Span[]) => {
    const { spans, situation } = phaseSpans(closed, { ...openNeutralisation({ start: 900_000, id: 9 }), kind: 'racing', detail: undefined });
    const view = engineView({ history: { spans }, situation });
    return lastNeutralisation(view.history, view.situation);
  };

  it('the newest closed neutralisation of the projection', () => {
    const sc = neutralisation({ kind: 'SC', start: 100_000, end: 200_000, id: 2 });
    const vsc = neutralisation({ kind: 'VSC', start: 500_000, end: 560_000, id: 4 });
    expect(last([sc, phase('racing', 200_000, 500_000, 3), vsc])).toEqual(vsc);
  });

  it('skips a span closed with `confirmed: false` (C18): the confirmed one before it, else null', () => {
    const sc = neutralisation({ kind: 'SC', start: 100_000, end: 200_000, id: 2 });
    const never = neutralisation({ kind: 'SC', start: 600_000, end: 603_000, confirmed: false, id: 4 });
    expect(last([sc, never])).toEqual(sc);
    expect(last([never])).toBeNull();
    expect(last([])).toBeNull();
  });

  it('a confirmed suspension is one', () => {
    const red = neutralisation({ kind: 'red', start: 300_000, end: 400_000, id: 4 });
    expect(last([red])).toEqual(red);
  });
});

describe('isEnding (Task 4)', () => {
  const withStages = (...stages: Array<'deployed' | 'returning'>) => {
    const span = openNeutralisation({ kind: 'SC', start: 300_000, id: 4 });
    return { ...span, detail: { car: 'SC' as const, stages: stages.map((stage, i) => ({ stage, at: 300_000 + i * 1_000 })) } };
  };

  it('an SC only deployed is not ending; one that reached `returning` is', () => {
    expect(isEnding(withStages('deployed'))).toBe(false);
    expect(isEnding(withStages('deployed', 'returning'))).toBe(true);
  });

  it('a suspension is not ending', () => {
    expect(isEnding(openNeutralisation({ kind: 'red', start: 300_000, id: 4 }))).toBe(false);
  });
});

describe('timeLossExcludedOf (Task 4, B6): membership from the projection module (C26)', () => {
  /** Car 7's slow mini-sector, from its start crossing's frame to its end crossing's. */
  const slow = (view: Parameters<typeof timeLossExcludedOf>[0], id: number = HUMAN) => timeLossExcludedOf(view)(carId(id), SLOW_START, SLOW_END);

  it('under green nothing is excluded', () => {
    expect(slow(timeLossCase('green'))).toBe(false);
  });

  it('inside a confirmed SC span every car is excluded', () => {
    expect(slow(timeLossCase('sc'))).toBe(true);
    expect(slow(timeLossCase('sc'), 3)).toBe(true);
  });

  it("inside the car's pit visit that car is excluded, another car is not", () => {
    expect(slow(timeLossCase('pitVisit'))).toBe(true);
    expect(slow(timeLossCase('pitVisit'), 6)).toBe(false);
  });

  it("inside the car's garage spell that car is excluded (incidents' `noTimeLoss` rows: pit lane and garage)", () => {
    const miniSectors = race();
    const garage = location(7, [{ kind: 'garage', at: SLOW_START + 1_000 }, { kind: 'track', at: SLOW_START + 20_000 }]);
    expect(slow(viewOf({ miniSectors, spans: garage }))).toBe(true);
  });

  it('inside an open neutralisation, also one pending its confirmation, every car is excluded', () => {
    const miniSectors = race();
    expect(slow(viewOf({ miniSectors, open: openNeutralisation({ kind: 'VSC', start: SLOW_START - 1_000 }) }))).toBe(true);
    expect(slow(viewOf({ miniSectors, open: openNeutralisation({ kind: 'SC', start: SLOW_START - 1_000, confirmed: false }) }))).toBe(true);
  });

  it('a span closed with `confirmed: false` excludes nothing (C18)', () => {
    const never = neutralisation({ kind: 'SC', start: SLOW_START - 1_000, end: SLOW_START + 30_000, confirmed: false });
    expect(slow(viewOf({ miniSectors: race(), phases: [never] }))).toBe(false);
  });

  it("a neutralisation that ended before the mini-sector's start frame excludes nothing", () => {
    const before = neutralisation({ kind: 'SC', start: SLOW_START - 60_000, end: SLOW_START - 10_000 });
    expect(slow(viewOf({ miniSectors: race(), phases: [before] }))).toBe(false);
  });

  // SP4.3c Task 4c (C26): any shared frame excludes, by the projection module's span-range query. A span lying wholly
  // inside one mini-sector covers neither its first nor its last frame, and is excluded all the same.
  it('a neutralisation lying wholly inside the mini-sector (opened after its start frame, closed before its end frame) excludes every car', () => {
    const inside = neutralisation({ kind: 'VSC', start: SLOW_START + 1_000, end: SLOW_START + 2_000 });
    const view = viewOf({ miniSectors: race(), phases: [inside] });
    expect(slow(view)).toBe(true);
    expect(slow(view, 3)).toBe(true);
  });

  it("a pit visit lying wholly inside the car's mini-sector excludes that car, not another", () => {
    const visit = location(7, [{ kind: 'pitLane', at: SLOW_START + 1_000 }, { kind: 'track', at: SLOW_START + 2_000 }]);
    const view = viewOf({ miniSectors: race(), spans: visit });
    expect(slow(view)).toBe(true);
    expect(slow(view, 6)).toBe(false);
  });

  it("a span closing on the mini-sector's start frame, or opening on its end frame, shares no frame with it", () => {
    const before = neutralisation({ kind: 'SC', start: SLOW_START - 30_000, end: SLOW_START });
    expect(slow(viewOf({ miniSectors: race(), phases: [before] }))).toBe(false);
    const after = neutralisation({ kind: 'SC', start: SLOW_END, end: SLOW_END + 30_000 });
    expect(slow(viewOf({ miniSectors: race(), phases: [after] }))).toBe(false);
  });
});

// Guard row (spec §5.8, Task 4): judgement "neutralisation kind", owner `shared/neutralised.ts`. `owners.guard.test.ts`
// (Task 2) is not on this base, so the row lives here: no unit matches the span kinds of `NEUTRALISATION_MACHINES`
// itself. A source line of a unit fails when it names a session-phase span detail type (`NeutralisedDetail`,
// `SuspendedDetail`), tests a detail's neutralising car (`.car === 'SC'`), or compares a span's kind to `'neutralised'`
// or `'suspended'` on a line that reads spans (`byMachine`, `spans`, `span`, `closed`, `neutralisedSpans`,
// `neutralisations`). A trigger's or an incident entry's kind `'neutralised'` is no span kind and passes.
describe('guard: neutralisation kind has one owner (shared/neutralised.ts)', () => {
  const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
  const OWNER = 'shared/neutralised.ts';
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []));
  const DETAIL = /\b(NeutralisedDetail|SuspendedDetail)\b/;
  const CAR = /\.car\s*[!=]==\s*'(SC|VSC)'/;
  const KIND = /\bkind\s*[!=]==\s*'(neutralised|suspended)'/;
  const SPANS = /byMachine|\bspans\b|\bspan\b|\bclosed\b|neutralisedSpans|neutralisations/;

  it('no unit outside the owner matches the span kinds of a neutralisation itself', () => {
    const offending: string[] = [];
    for (const file of files(SRC)) {
      const name = relative(SRC, file).split('\\').join('/');
      if (name === OWNER) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (DETAIL.test(line) || CAR.test(line) || (KIND.test(line) && SPANS.test(line))) offending.push(`${name}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(offending).toEqual([]);
  });
});

// Guard (SP4.3c Task 4b, C26, C28): membership is the projection module's (`situationAt`, `membershipOf`). No unit of
// analysis judges whether a span covers a frame range itself: a source line (comments left out) fails when it compares
// both a `startFrame` and an `endFrame` (`<`, `<=`, `>`, `>=`), the two-sided "this range shares a frame with this span"
// test. `shared/neutralised.ts` asks the projection module (`timeLossExcludedOf`) and passes. `damage`, whose samples
// the exclusion decides, reads no span frame at all: neither `startFrame` nor `endFrame` appears in its code.
describe('guard: no unit judges span coverage from frame numbers itself (Task 4b, C26)', () => {
  const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []));
  /** `text` without its comments, line breaks kept so line numbers stay. */
  const codeOf = (text: string): string =>
    text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, '')).replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  /** A comparison with a span bound on either side; `=>` and `->` are no comparison. */
  const compares = (bound: string): RegExp => new RegExp(`(?<![=-])[<>]=?\\s*[\\w.?!]*\\b${bound}\\b|\\b${bound}\\s*[<>]=?(?!>)`);
  const START = compares('startFrame');
  const END = compares('endFrame');
  const covers = (line: string): boolean => START.test(line) && END.test(line);
  const offendersIn = (file: string): string[] => {
    const name = relative(SRC, file).split('\\').join('/');
    return codeOf(readFileSync(file, 'utf8'))
      .split('\n')
      .flatMap((line, i) => (covers(line) ? [`${name}:${i + 1}: ${line.trim()}`] : []));
  };
  /**
   * Units found with the same own coverage test (reported for their own task): each must still offend, so the list only
   * shrinks; once fixed, its entry goes. Empty since SP4.3c Task 4c: battle, forecast-score's experiments and sc-call ask
   * the projection module's span-range query (`spansOverlapping`).
   */
  const PENDING: readonly string[] = [];

  it('the pattern finds a two-sided bound comparison, never an arrow, a field copy or a one-sided test', () => {
    expect(covers('if (skips.some((s) => from.frame < s.endFrame && to.frame > s.startFrame)) return;')).toBe(true);
    expect(covers('span.startFrame <= to && (!isClosed(span) || span.endFrame > from);')).toBe(true);
    expect(covers('push({ startFrame: span.startFrame, endFrame: span.endFrame });')).toBe(false);
    expect(covers('.map((s) => ({ from: s.startFrame, to: s.endFrame }))')).toBe(false);
    expect(covers('.filter((s) => !isClosed(s) || s.endFrame > frame)')).toBe(false);
    expect(codeOf('/** a.startFrame < b && c.endFrame > d */\nconst x = 1;')).toBe('\nconst x = 1;');
  });

  it('no unit of analysis compares a frame range with both bounds of a span', () => {
    const offending = files(SRC).flatMap(offendersIn).filter((o) => !PENDING.some((p) => o.startsWith(`${p}:`)));
    expect(offending).toEqual([]);
  });

  it('the pending units still offend (remove an entry once its unit asks the projection module)', () => {
    for (const p of PENDING) expect(offendersIn(join(SRC, p)), p).not.toEqual([]);
  });

  it('battle and sc-call compare no span bound at all, one-sided included: the open-span cuts go too (Task 4c)', () => {
    const oneSided = files(SRC)
      .filter((file) => ['battle/', 'sc-call/'].some((dir) => relative(SRC, file).split('\\').join('/').startsWith(dir)))
      .flatMap((file) =>
        codeOf(readFileSync(file, 'utf8'))
          .split('\n')
          .flatMap((line, i) => (START.test(line) || END.test(line) ? [`${relative(SRC, file)}:${i + 1}: ${line.trim()}`] : [])),
      );
    expect(oneSided).toEqual([]);
  });

  it('damage reads no span frame: its exclusion is the shared rule over the projection module', () => {
    const named = files(join(SRC, 'damage')).flatMap((file) =>
      codeOf(readFileSync(file, 'utf8'))
        .split('\n')
        .flatMap((line, i) => (/\b(startFrame|endFrame)\b/.test(line) ? [`damage/${relative(join(SRC, 'damage'), file)}:${i + 1}: ${line.trim()}`] : [])),
    );
    expect(named).toEqual([]);
  });
});
