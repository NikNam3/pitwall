// Builders and cases shared by the Box call gallery and its tests (test-phase file: the implementer does not edit it).
// The sample is the approved mockup's (docs/design/2026-11-16-sp4.3d/sc-card.html, gen.mjs `CALL`, `block`; KUH, Spa
// L14/44, P8 on mediums, sets left S H H I): per condition SC, VSC, GREEN the six answers stay, box S, M, H, I, W; M and
// W have no set left. E[POS], its SE, ΔPOS against stay, P(GAIN) and REJ are the topic's own numbers, as the mockup
// prints them (the display computes nothing, C65); each position pmf is gen.mjs' `placeDist` at the mockup's `mu`
// (stay 1.6/1.9, a box option 1.7/2.0), built here for the fixture only.
import type { Computed, MachineSpans } from '@pitwall/contracts';
import { carId, known, toSessionTime, unknown } from '@pitwall/domain';
import type {
  EstimateSource,
  Known,
  Ms,
  NeutralisedDetail,
  ScCallAnswer,
  ScCallBlock,
  ScCallBlocks,
  ScCallOption,
  UnknownReason,
} from '@pitwall/domain';
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import type { widget } from './widget.ts';

const at = toSessionTime(2_460_000);
export const value = <T>(v: T): Known<T> => known(v, at);

/** The field's size: one pmf entry per place. */
export const PLACES = 20;
/** Our place now (stay's rejoin, ruling R29). */
export const OUR_PLACE = 8;

/** gen.mjs `placeDist`: a skewed bell around `mu` over P1 … P20, a DNF share on the last place. */
export function placeDist(mu: number, sdL: number, sdR: number, dnf = 0.015): number[] {
  const w = Array.from({ length: PLACES }, (_, i) => {
    const d = i + 1 - mu;
    const s = d < 0 ? sdL : sdR;
    return Math.exp(-(d * d) / (2 * s * s));
  });
  const t = w.reduce((a, b) => a + b, 0);
  return w.map((x, i) => (x / t) * (1 - dnf) + (i === PLACES - 1 ? dnf : 0));
}

/** Sources as the `pit-loss` calculator decides them (C43); the Box call does not draw them. */
export const defaultSource: EstimateSource = { kind: 'default', note: 'Spa, real F1 2025 (track file)', sessionShare: 0, parts: 'track file' };

/** Stay's known values: E[pos], SE, REJ (our place now), the pmf's `mu`. */
export type StayValues = { ePos: number; se: number; rejoin: number; mu: number };
/** A box answer's known values: stay's, plus ΔPOS and P(GAIN) against stay. */
export type BoxValues = StayValues & { dPos: number; pGain: number };

/** One answer: known values, or every `Known` unknown with one reason (`noSet`: no set of that compound left). */
export function option(answer: ScCallAnswer, v: StayValues | BoxValues | UnknownReason): ScCallOption {
  if (typeof v === 'string') {
    return {
      answer, ePos: unknown(v), se: unknown(v), ePosDelta: unknown(v), pGain: unknown(v), rejoinPosition: unknown(v), positionPmf: unknown(v),
    };
  }
  const box = 'dPos' in v;
  return {
    answer,
    ePos: value(v.ePos),
    se: value(v.se),
    // stay against itself: zero places, no chance of a gain to show (the display leaves both cells empty)
    ePosDelta: value(box ? v.dPos : 0),
    pGain: box ? value(v.pGain) : unknown('notApplicable'),
    rejoinPosition: value(v.rejoin),
    positionPmf: value(box ? placeDist(v.mu, 1.7, 2.0) : placeDist(v.mu, 1.6, 1.9)),
  };
}

/** The six answers of one condition, in the order stay, S, M, H, I, W (M and W: no set). */
export type BlockValues = { stay: StayValues; S: BoxValues; H: BoxValues; I: BoxValues };

export const SC: BlockValues = {
  stay: { ePos: 8.03, se: 0.07, rejoin: 8, mu: 7.61 },
  S: { ePos: 8.51, se: 0.07, dPos: -0.48, pGain: 0.35, rejoin: 11, mu: 8.1 },
  H: { ePos: 7.31, se: 0.07, dPos: 0.72, pGain: 0.54, rejoin: 10, mu: 6.88 },
  I: { ePos: 12.75, se: 0.07, dPos: -4.72, pGain: 0.03, rejoin: 11, mu: 12.4 },
};
export const VSC: BlockValues = {
  stay: { ePos: 7.97, se: 0.07, rejoin: 8, mu: 7.55 },
  S: { ePos: 8.83, se: 0.07, dPos: -0.86, pGain: 0.3, rejoin: 12, mu: 8.42 },
  H: { ePos: 7.63, se: 0.07, dPos: 0.34, pGain: 0.48, rejoin: 11, mu: 7.2 },
  I: { ePos: 13.24, se: 0.07, dPos: -5.27, pGain: 0.02, rejoin: 12, mu: 12.9 },
};
export const GREEN: BlockValues = {
  stay: { ePos: 7.94, se: 0.07, rejoin: 8, mu: 7.52 },
  S: { ePos: 9.79, se: 0.07, dPos: -1.85, pGain: 0.18, rejoin: 15, mu: 9.4 },
  H: { ePos: 8.72, se: 0.07, dPos: -0.78, pGain: 0.31, rejoin: 15, mu: 8.31 },
  I: { ePos: 14.52, se: 0.07, dPos: -6.57, pGain: 0.02, rejoin: 15, mu: 14.2 },
};

/** The stop's loss per condition (gen.mjs `LOSS`). */
const LOSS_MS = { sc: 9_800, vsc: 13_500, green: 22_300 } as const satisfies Record<ScCallBlock['condition'], number>;

/** One condition's block; `lapsLeft` known only for the condition that is out. */
export function block(condition: ScCallBlock['condition'], v: BlockValues, lapsLeft: Known<number> = unknown('notApplicable')): ScCallBlock {
  return {
    condition,
    options: [
      option('stay', v.stay),
      option('S', v.S),
      option('M', 'noSet'),
      option('H', v.H),
      option('I', v.I),
      option('W', 'noSet'),
    ],
    lossMs: value<Ms>(LOSS_MS[condition]),
    lossSource: defaultSource,
    lapsLeft,
  };
}

export const call = (blocks: ScCallBlock[], out: ScCallBlocks['out'] = null): ScCallBlocks => ({ carId: carId(0), lap: 14, out, blocks });

/** The job's result as `scCall.car` publishes it (C51). */
export const computed = (c: ScCallBlocks): Computed<ScCallBlocks> => ({ computedFor: { lap: c.lap, frameId: 4_100 }, value: c });

/** `situation.sessionPhaseRace` with one open span of `kind`. */
export const phaseSpans = (kind: string, detail: unknown = undefined): MachineSpans => ({
  open: [{ machine: 'session-phase-race', id: 0, kind, start: at, confirmed: true, detail, startFrame: 4_100 }],
});
/** A `neutralised` span of the SC or the VSC, deployed. */
export const neutralised = (car: NeutralisedDetail['car']): MachineSpans =>
  phaseSpans('neutralised', { car, stages: [{ stage: 'deployed', at }] } satisfies NeutralisedDetail);
export const racing: MachineSpans = phaseSpans('racing');

/** Green running: the three blocks, each "if it came now". */
export const greenCall = (): ScCallBlocks => call([block('sc', SC), block('vsc', VSC), block('green', GREEN)]);
/** An SC out, ~4 laps left (race-hazard's 3.6): its block alone, GREEN hidden. */
export const scOutCall = (): ScCallBlocks => call([block('sc', SC, value(3.6))], 'sc');
/** A VSC out, ~2 laps left: its block alone. */
export const vscOutCall = (): ScCallBlocks => call([block('vsc', VSC, value(2))], 'vsc');

/**
 * The gallery's synthetic cases: the mockup's states (green full, SC out, VSC out; the two compact states are `green`
 * and `scOut` at the compact size), and a car the call does not apply to (`blocks: []`, ruling R29). The tests take
 * them from here, since only the gallery imports gallery.ts (C69).
 */
export const cases = {
  // Green running (first case: the screenshot baseline, Task 15): SC, VSC, GREEN.
  green: { call: computed(greenCall()), phase: racing },
  // The SC is out: its block alone, its label amber with ~4 laps.
  scOut: { call: computed(scOutCall()), phase: neutralised('SC') },
  // The VSC is out: its block alone, its label amber with ~2 laps.
  vscOut: { call: computed(vscOutCall()), phase: neutralised('VSC') },
  // The call does not apply to the car (a rival, our car in the pit lane): no block.
  notApplicable: { call: computed(call([])), phase: racing },
} satisfies NonNullable<GalleryEntry<typeof widget>['cases']>;

/** The gallery's fit sizes: the two minimums (compact 26×3, full 58×23) plus a size just inside each mode. */
export const fit = [
  { mode: 'compact', cols: 26, rows: 3 },
  { mode: 'compact', cols: 44, rows: 3 },
  { mode: 'full', cols: 58, rows: 23 },
  { mode: 'full', cols: 70, rows: 30 },
] satisfies NonNullable<GalleryEntry<typeof widget>['fit']>;
