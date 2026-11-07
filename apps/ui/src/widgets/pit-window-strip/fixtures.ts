// Builders and cases shared by the pit-window-strip gallery and its tests (test-phase file: the implementer does not edit it).
// The sample is the mockup's (docs/design/2026-11-07-sp4.2/pit-window.html, gen.mjs): Silverstone, 52 laps, KUH on
// mediums since L1, their latest stop lap L31; a new H set (fitted at L31 it lasts to L60: window L23–31) and a new S
// set (fitted at L31 it lasts to L46: it does not reach the flag, no window). Values are written by hand from the
// `PitWindow` type (SP4.2 spec 3.4), with the analysis' own formulas: earliest = max(stint start, flag − life),
// lifeEnd = latest + life, reaches = lifeEnd ≥ flag.
import { carId, known, toSessionTime, unknown } from '@pitwall/domain';
import type { Known, PitWindow, PitWindowSet, PitWindowState, UnknownReason, VisualCompound } from '@pitwall/domain';
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import type { widget } from './widget.ts';

const at = toSessionTime(1_380_000);
const k = <T>(v: T): Known<T> => known(v, at);

/** The theme's cell (default theme: 14 px font, line height 1.4; JetBrains Mono's advance 8 px). */
export const CELL = { w: 8, h: 14 * 1.4 } as const;

/** `windowLeadLaps` of `pit-window` (spec §7). */
const LEAD = 2;

export type SetSpec = { compound: VisualCompound; lifeLaps: number; sameType?: boolean };
export type RaceSpec = {
  car?: number;
  flag: number;
  now: number;
  stint: { compound: VisualCompound; fromLap: number; latest: number | UnknownReason };
  sets: SetSpec[];
};

/** One set as the analysis gives it for a known (or unknown) latest stop lap. */
export function pwSet(spec: SetSpec, flag: number, fromLap: number, latest: number | UnknownReason): PitWindowSet {
  const sameType = spec.sameType ?? true;
  if (typeof latest !== 'number') {
    return { compound: spec.compound, sameType, lifeLaps: k(spec.lifeLaps), earliest: k(Math.max(fromLap, flag - spec.lifeLaps)), lifeEnd: unknown(latest), reaches: unknown(latest) };
  }
  const lifeEnd = latest + spec.lifeLaps;
  return {
    compound: spec.compound, sameType, lifeLaps: k(spec.lifeLaps),
    earliest: k(Math.max(fromLap, flag - spec.lifeLaps)), lifeEnd: k(lifeEnd), reaches: k(lifeEnd >= flag),
  };
}

/** The window state of the analysis: from the first same-type compound that reaches the flag. */
export function windowState(now: number, latest: number, sets: PitWindowSet[]): { state: PitWindowState; compound?: VisualCompound } {
  const first = sets.find((s) => s.sameType && s.reaches.known && s.reaches.value);
  if (first === undefined || !first.earliest.known) return { state: 'none' };
  const earliest = first.earliest.value;
  const state: PitWindowState = now > latest ? 'closed' : now >= earliest ? 'open' : now >= earliest - LEAD ? 'lead' : 'before';
  return { state, compound: first.compound };
}

/** A whole `PitWindow` value from a race description. */
export function race(spec: RaceSpec): PitWindow {
  const { flag, now, stint } = spec;
  const sets = spec.sets.map((s) => pwSet(s, flag, stint.fromLap, stint.latest));
  const base = { carId: carId(spec.car ?? KUH), flag, currentLap: now, sets };
  if (typeof stint.latest !== 'number') {
    return {
      ...base, stint: { compound: stint.compound, fromLap: stint.fromLap, latest: unknown(stint.latest) },
      window: unknown(stint.latest), windowCompound: unknown(stint.latest),
    };
  }
  const w = windowState(now, stint.latest, sets);
  return {
    ...base, stint: { compound: stint.compound, fromLap: stint.fromLap, latest: k(stint.latest) },
    window: k(w.state), windowCompound: w.compound === undefined ? unknown('notApplicable') : k(w.compound),
  };
}

/** Car ids: KUH the player, LIN the teammate. */
export const KUH = 0;
export const LIN = 1;

/** The mockup's sets: H (life 29: earliest L23, to L60) and S (life 15: to L46, short of the flag). */
export const MOCKUP_SETS: SetSpec[] = [{ compound: 'hard', lifeLaps: 29 }, { compound: 'soft', lifeLaps: 15 }];
const MOCKUP_STINT = { compound: 'medium', fromLap: 1, latest: 31 } as const;
const mockup = (now: number): PitWindow => race({ flag: 52, now, stint: MOCKUP_STINT, sets: MOCKUP_SETS });

/** The mockup's five states. */
export const OPEN = mockup(23); // L23: the H window open now
export const AHEAD = mockup(15); // L15: before the window
export const OVER = mockup(33); // L33: the mediums past their life, the window closed
/** LIN at L41 on hards since L16: the tyres reach the flag, the rule met, nothing to plan (latest capped at flag − 1). */
export const NOSTOP = race({ car: LIN, flag: 52, now: 41, stint: { compound: 'hard', fromLap: 16, latest: 51 }, sets: [] });
/** L02: too few laps on these tyres for a life (tyre-life's `minLaps`), no set planned yet. */
export const EARLY = race({ flag: 52, now: 2, stint: { compound: 'medium', fromLap: 1, latest: 'insufficientData' }, sets: [] });

/** On inters since L12 (rain from L11): a new inter set (life 25: window L27–30) of the fitted type, a new medium set
 *  of the other type (life 28: L24–30), listed first in the topic; at L26 the inter window is in its lead. */
export const INTER = race({
  flag: 52, now: 26, stint: { compound: 'inter', fromLap: 12, latest: 30 },
  sets: [{ compound: 'medium', lifeLaps: 28, sameType: false }, { compound: 'inter', lifeLaps: 25 }],
});

/** The gallery's synthetic cases; the tests take them from here, since only the gallery imports gallery.ts (C69). */
export const cases = {
  // The mockup (first case: the screenshot baseline): L23, the H window open (white bold), S short of the flag.
  open: { window: k(OPEN) },
  // L15: the window ahead, its laps in the text colour.
  ahead: { window: k(AHEAD) },
  // L33: the mediums past their life (amber overrun from L31, the last lap amber), the H window faint.
  overrun: { window: k(OVER) },
  // LIN at L41: the hards reach the flag, no set to plan.
  noStop: { window: k(NOSTOP) },
  // L02: the life still unknown (empty, the reason on hover), no set yet.
  early: { window: k(EARLY) },
  // On inters with `otherType` on: the inter row, then the medium row below it.
  interOther: { window: k(INTER) },
} satisfies NonNullable<GalleryEntry<typeof widget>['cases']>;

/** Per case, the panel options over the declaration's defaults. */
export const caseOptions = { interOther: { otherType: true } } satisfies NonNullable<GalleryEntry<typeof widget>['caseOptions']>;

/** The gallery's fit sizes: the two minimums (compact 22×3, full 46×4) plus sizes just inside each mode. */
export const fit = [
  { mode: 'compact', cols: 22, rows: 3 },
  { mode: 'compact', cols: 45, rows: 6 },
  { mode: 'full', cols: 46, rows: 4 },
  { mode: 'full', cols: 70, rows: 8 },
] satisfies NonNullable<GalleryEntry<typeof widget>['fit']>;
