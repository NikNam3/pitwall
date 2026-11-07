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

/** One new set; `state` overrides the analysis' rule for this set alone (a case that shows the display maps the topic). */
export type SetSpec = { compound: VisualCompound; lifeLaps: number; sameType?: boolean; state?: PitWindowState };
export type RaceSpec = {
  car?: number;
  flag: number;
  now: number;
  stint: { compound: VisualCompound; fromLap: number; latest: number | UnknownReason };
  sets: SetSpec[];
  /** The fitted set at its limit (tyre-life's `lapsToLimit` below 1): `pastLimit`, every window closed. */
  atLimit?: boolean;
  /** A box stop since the stint start: every window closed, not past the limit. */
  stopped?: boolean;
  /** Whether a stop is needed (default true; false: the rule met and the fitted set reaches the flag). */
  stopNeeded?: boolean;
};

/** What every set's state depends on besides the set: the lap now and whether the windows are closed. */
type Ctx = { flag: number; fromLap: number; latest: number | UnknownReason; now: number; closed: boolean };

/** One set as the analysis gives it for a known (or unknown) latest stop lap; its window and state by the analysis' rules. */
export function pwSet(spec: SetSpec, ctx: Ctx): PitWindowSet {
  const { flag, fromLap, latest, now, closed } = ctx;
  const sameType = spec.sameType ?? true;
  const earliest = Math.max(fromLap, flag - spec.lifeLaps);
  const base = { compound: spec.compound, sameType, lifeLaps: k(spec.lifeLaps), earliest: k(earliest) };
  if (typeof latest !== 'number') {
    return { ...base, lifeEnd: unknown(latest), reaches: unknown(latest), windowLaps: unknown(latest), state: unknown(latest) };
  }
  const lifeEnd = latest + spec.lifeLaps;
  const has = lifeEnd >= flag && earliest <= latest;
  const rule: PitWindowState = !has ? 'none' : closed ? 'closed' : now >= earliest ? 'open' : now >= earliest - LEAD ? 'lead' : 'before';
  return {
    ...base, lifeEnd: k(lifeEnd), reaches: k(lifeEnd >= flag),
    windowLaps: has ? k({ from: earliest, to: latest }) : unknown('notApplicable'),
    state: k(spec.state ?? rule),
  };
}

/** A whole `PitWindow` value from a race description; `window` is the state of the first same-type set with a window. */
export function race(spec: RaceSpec): PitWindow {
  const { flag, now, stint } = spec;
  const latest = stint.latest;
  const pastLimit = (spec.atLimit ?? false) || (typeof latest === 'number' && now > latest);
  const ctx: Ctx = { flag, fromLap: stint.fromLap, latest, now, closed: pastLimit || (spec.stopped ?? false) };
  const sets = spec.sets.map((s) => pwSet(s, ctx));
  const base = { carId: carId(spec.car ?? KUH), flag, currentLap: now, sets };
  if (typeof latest !== 'number') {
    return {
      ...base, stint: { compound: stint.compound, fromLap: stint.fromLap, latest: unknown(latest), stopNeeded: unknown(latest), pastLimit },
      window: unknown(latest), windowCompound: unknown(latest),
    };
  }
  const first = sets.find((s) => s.sameType && s.windowLaps.known);
  return {
    ...base,
    stint: { compound: stint.compound, fromLap: stint.fromLap, latest: k(latest), stopNeeded: k(spec.stopNeeded ?? true), pastLimit },
    window: first === undefined ? k('none') : first.state,
    windowCompound: first === undefined ? unknown('notApplicable') : k(first.compound),
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
export const NOSTOP = race({ car: LIN, flag: 52, now: 41, stint: { compound: 'hard', fromLap: 16, latest: 51 }, sets: [], stopNeeded: false });

/** The mockup at L23 with a second H-type set S (life 30: L22–31) the topic closes alone while H is open: the display
 *  maps each set's `state`, its laps would look open by the current lap. */
export const SET_CLOSED = race({
  flag: 52, now: 23, stint: MOCKUP_STINT,
  sets: [{ compound: 'hard', lifeLaps: 29 }, { compound: 'soft', lifeLaps: 30, state: 'closed' }],
});
/** `stopNeeded` false with a set still in the topic: drawn as no stop all the same (the display reads the field). */
export const NOSTOP_WITH_SET = race({
  car: LIN, flag: 52, now: 41, stint: { compound: 'hard', fromLap: 16, latest: 51 }, sets: [{ compound: 'medium', lifeLaps: 20 }], stopNeeded: false,
});
/** Five visible sets (`otherType` on): three of the fitted type (H, S, SS), two of the other (I, W); the topic lists
 *  an other-type set first. */
export const FIVE_SETS = race({
  flag: 52, now: 23, stint: MOCKUP_STINT,
  sets: [
    { compound: 'inter', lifeLaps: 25, sameType: false },
    { compound: 'hard', lifeLaps: 29 },
    { compound: 'soft', lifeLaps: 15 },
    { compound: 'wet', lifeLaps: 25, sameType: false },
    { compound: 'superSoft', lifeLaps: 10 },
  ],
});
/** L31, the mediums at their limit on their last lap (latest = now): `pastLimit`, the H window closed. */
export const AT_LIMIT = race({ flag: 52, now: 31, stint: MOCKUP_STINT, sets: MOCKUP_SETS, atLimit: true });
/** L25 after a box stop with the mediums still good (latest L31): the H window closed, not past the limit. */
export const STOPPED = race({ flag: 52, now: 25, stint: MOCKUP_STINT, sets: MOCKUP_SETS, stopped: true });
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
