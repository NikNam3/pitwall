// Builders and cases shared by the sc-card gallery and its tests (test-phase file: the implementer does not edit it).
// The sample is the mockup's (docs/design/2026-11-07-sp4.2/sc-card.html): SC rejoin P9, loss 9.8 s (the track file's
// default), gain +10.5 s; VSC rejoin P10, loss 13.1 s (the set `league`), gain +7.2 s; our car KUH (car 0).
import type { MachineSpans } from '@pitwall/contracts';
import { carId, known, toSessionTime, unknown } from '@pitwall/domain';
import type { EstimateSource, Known, Ms, NeutralisedDetail, ScCall, ScCallRow, UnknownReason } from '@pitwall/domain';
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import type { widget } from './widget.ts';

const at = toSessionTime(2_460_000);
export const value = <T>(v: T): Known<T> => known(v, at);

/** Sources as the `pit-loss` calculator decides them (C43): the display only maps the kind to its badge. */
export const sessionSource: EstimateSource = { kind: 'session', sessionShare: 1, parts: '2 stops this session' };
export const calibrationSource: EstimateSource = {
  kind: 'calibration', setName: 'league', sources: 4, sessionShare: 0, parts: '4 stops (race 15 Oct) · 0 stops this session',
};
export const defaultSource: EstimateSource = {
  kind: 'default', note: 'Silverstone, real F1 2025 (track file)', sessionShare: 0, parts: 'track file',
};

/** One condition's row; a number is the known value, a reason the unknown. */
export const row = (
  condition: ScCallRow['condition'],
  rejoin: number | UnknownReason,
  lossMs: number | UnknownReason,
  gainMs: number | UnknownReason,
  lossSource: EstimateSource,
): ScCallRow => ({
  condition,
  rejoinPosition: typeof rejoin === 'number' ? value(rejoin) : unknown(rejoin),
  lossMs: typeof lossMs === 'number' ? value<Ms>(lossMs) : unknown(lossMs),
  gainMs: typeof gainMs === 'number' ? value<Ms>(gainMs) : unknown(gainMs),
  lossSource,
});

/** The mockup's rows: SC from the default, VSC from the calibration. */
export const mockupSc = row('sc', 9, 9_800, 10_500, defaultSource);
export const mockupVsc = row('vsc', 10, 13_100, 7_200, calibrationSource);

export const call = (sc: ScCallRow = mockupSc, vsc: ScCallRow = mockupVsc): ScCall => ({ carId: carId(0), rows: [sc, vsc] });

/** `situation.sessionPhaseRace` with one open span of `kind`. */
export const phaseSpans = (kind: string, detail: unknown = undefined): MachineSpans => ({
  open: [{ machine: 'session-phase-race', id: 0, kind, start: at, confirmed: true, detail, startFrame: 4_100 }],
});
/** A `neutralised` span of the SC or the VSC, deployed. */
export const neutralised = (car: NeutralisedDetail['car']): MachineSpans =>
  phaseSpans('neutralised', { car, stages: [{ stage: 'deployed', at }] } satisfies NeutralisedDetail);
export const racing: MachineSpans = phaseSpans('racing');

/** The gallery's synthetic cases; the tests take them from here, since only the gallery imports gallery.ts (C69). */
export const cases = {
  // The mockup, green running (first case: the screenshot baseline, Task 15): SC from the default (ᵈ), VSC from the
  // calibration (ᶜ), nothing out.
  green: { call: call(), phase: racing },
  // The SC is out: SC named in the header in the warning role, the SC row white bold.
  scOut: { call: call(), phase: neutralised('SC') },
  // The VSC is out: VSC named in the header, the VSC row white bold.
  vscOut: { call: call(), phase: neutralised('VSC') },
  // No loss and no gaps yet: every value cell the unknown's mark, the reason on hover, no badge.
  unknown: {
    call: call(row('sc', 'insufficientData', 'insufficientData', 'insufficientData', defaultSource), row('vsc', 'insufficientData', 'insufficientData', 'insufficientData', calibrationSource)),
    phase: racing,
  },
  // Both losses measured this session: no badge mark, the columns stay aligned.
  measured: { call: call(row('sc', 9, 9_800, 10_500, sessionSource), row('vsc', 10, 13_100, 7_200, sessionSource)), phase: racing },
  // The session phase not received yet: the sheet without a condition out.
  noPhase: { call: call(), phase: undefined },
} satisfies NonNullable<GalleryEntry<typeof widget>['cases']>;

/** The gallery's fit sizes: the two minimums plus sizes just inside each mode (compact one column short of full, full
 *  wider and taller than its minimum). */
export const fit = [
  { mode: 'compact', cols: 26, rows: 2 },
  { mode: 'compact', cols: 29, rows: 2 },
  { mode: 'full', cols: 30, rows: 3 },
  { mode: 'full', cols: 40, rows: 6 },
] satisfies NonNullable<GalleryEntry<typeof widget>['fit']>;
