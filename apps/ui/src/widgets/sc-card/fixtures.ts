// Builders and cases shared by the sc-card gallery and its tests (test-phase file: the implementer does not edit it).
// The sample is the approved mockup's (docs/design/2026-11-12-sp4.3b/sc-card.html, gen.mjs `scRow`; KUH, Spa L14/44, P8):
// green: SC +1.4 75% P9 9.8ᵈ L12–24 (loss from the track file's default), VSC +0.6 53% P10 13.1ᶜ L15–24 (the set
// `league`); SC out: SC +1.8 84%, VSC notApplicable (Q5 B); VSC out: VSC +0.9 62%, SC notApplicable. The bins are gen.mjs'
// `wholeBins(mu, 1.3, 4)` to three decimals, the tails folded into the first bin so each row sums to 1 (the ends hold the
// tails, `SC_CALL_GAIN_BINS`); ΔPOS and P(GAIN) are the topic's own numbers (the display computes nothing, C65).
import type { Computed, MachineSpans } from '@pitwall/contracts';
import { carId, known, toSessionTime, unknown } from '@pitwall/domain';
import type { EstimateSource, Known, Ms, NeutralisedDetail, ScCall, ScCallRow, UnknownReason } from '@pitwall/domain';
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import type { widget } from './widget.ts';

const at = toSessionTime(2_460_000);
export const value = <T>(v: T): Known<T> => known(v, at);

/** Sources as the `pit-loss` calculator decides them (C43): the display only maps the kind to its badge. */
export const sessionSource: EstimateSource = { kind: 'session', sessionShare: 1, parts: '2 stops this session' };
export const calibrationSource: EstimateSource = {
  kind: 'calibration', setName: 'league', sources: 3, sessionShare: 0, parts: '3 stops (race 15 Oct) · 0 stops this session',
};
export const defaultSource: EstimateSource = {
  kind: 'default', note: 'Spa, real F1 2025 (track file)', sessionShare: 0, parts: 'track file',
};

/** One condition's known values, as `scCall.car` carries them. */
export type RowValues = {
  ePosDelta: number;
  pGain: number;
  /** 9 shares, places gained −4 … +4. */
  gainBins: number[];
  rejoin: number;
  lossMs: number;
  range: [number, number];
};

/** One condition's row: known values, or every `Known` unknown with one reason (as the job gives a row that does not apply). */
export function row(condition: ScCallRow['condition'], v: RowValues | UnknownReason, lossSource: EstimateSource): ScCallRow {
  if (typeof v === 'string') {
    return {
      condition, ePosDelta: unknown(v), pGain: unknown(v), gainBins: unknown(v), rejoinPosition: unknown(v), lossMs: unknown(v),
      lossSource, range: unknown(v),
    };
  }
  return {
    condition,
    ePosDelta: value(v.ePosDelta),
    pGain: value(v.pGain),
    gainBins: value(v.gainBins),
    rejoinPosition: value(v.rejoin),
    lossMs: value<Ms>(v.lossMs),
    lossSource,
    range: value({ fromLap: v.range[0], toLap: v.range[1] }),
  };
}

/** The mockup's rows (gen.mjs `SC_GREEN`, `SC_OUT`, `VSC_OUT`). */
export const scGreen: RowValues = {
  ePosDelta: 1.362, pGain: 0.748, gainBins: [0.009, 0.001, 0.011, 0.059, 0.172, 0.286, 0.271, 0.146, 0.045],
  rejoin: 9, lossMs: 9_800, range: [12, 24],
};
export const vscGreen: RowValues = {
  ePosDelta: 0.587, pGain: 0.528, gainBins: [0.002, 0.008, 0.045, 0.146, 0.271, 0.286, 0.172, 0.059, 0.011],
  rejoin: 10, lossMs: 13_100, range: [15, 24],
};
export const scOut: RowValues = {
  ePosDelta: 1.783, pGain: 0.836, gainBins: [0.024, 0, 0.004, 0.028, 0.108, 0.238, 0.299, 0.213, 0.086],
  rejoin: 9, lossMs: 9_800, range: [12, 24],
};
export const vscOut: RowValues = {
  ePosDelta: 0.887, pGain: 0.618, gainBins: [0.004, 0.004, 0.028, 0.108, 0.238, 0.299, 0.213, 0.086, 0.02],
  rejoin: 10, lossMs: 13_100, range: [15, 24],
};

export const call = (
  sc: ScCallRow = row('sc', scGreen, defaultSource),
  vsc: ScCallRow = row('vsc', vscGreen, calibrationSource),
): ScCall => ({ carId: carId(0), lap: 14, rows: [sc, vsc] });

/** The job's result as `scCall.car` publishes it (C51). */
export const computed = (c: ScCall = call()): Computed<ScCall> => ({ computedFor: { lap: c.lap, frameId: 4_100 }, value: c });

/** `situation.sessionPhaseRace` with one open span of `kind`. */
export const phaseSpans = (kind: string, detail: unknown = undefined): MachineSpans => ({
  open: [{ machine: 'session-phase-race', id: 0, kind, start: at, confirmed: true, detail, startFrame: 4_100 }],
});
/** A `neutralised` span of the SC or the VSC, deployed. */
export const neutralised = (car: NeutralisedDetail['car']): MachineSpans =>
  phaseSpans('neutralised', { car, stages: [{ stage: 'deployed', at }] } satisfies NeutralisedDetail);
export const racing: MachineSpans = phaseSpans('racing');

/**
 * The gallery's synthetic cases, the mockup's four states (the 4.2 cases replaced); its two compact states are the
 * `green` and `scOut` cases at the compact size. The tests take them from here, since only the gallery imports
 * gallery.ts (C69).
 */
export const cases = {
  // Green running (first case: the screenshot baseline, Task 18): nothing out, both rows "if one came now".
  green: { call: computed(), phase: racing },
  // The SC is out: its row the real SC; the VSC row notApplicable in every value (Q5 B, spec §9.3).
  scOut: { call: computed(call(row('sc', scOut, defaultSource), row('vsc', 'notApplicable', calibrationSource))), phase: neutralised('SC') },
  // The VSC is out: its row the real VSC; the SC row notApplicable.
  vscOut: { call: computed(call(row('sc', 'notApplicable', defaultSource), row('vsc', vscOut, calibrationSource))), phase: neutralised('VSC') },
  // Too few laps yet: every value the kit's pending mark, the reason on hover, no badge.
  unknown: {
    call: computed(call(row('sc', 'insufficientData', defaultSource), row('vsc', 'insufficientData', calibrationSource))),
    phase: racing,
  },
} satisfies NonNullable<GalleryEntry<typeof widget>['cases']>;

/** The gallery's fit sizes: the two minimums (compact 26×2, full 45×3) plus a size just inside each mode. */
export const fit = [
  { mode: 'compact', cols: 26, rows: 2 },
  { mode: 'compact', cols: 44, rows: 2 },
  { mode: 'full', cols: 45, rows: 3 },
  { mode: 'full', cols: 60, rows: 6 },
] satisfies NonNullable<GalleryEntry<typeof widget>['fit']>;
