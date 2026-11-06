// Builders and cases shared by the lap-overview-grid gallery and its tests (test-phase file: the implementer does not
// edit it). Tests import the cases from here, never `gallery.ts` (C69). The samples are the approved mockups':
// `docs/design/2026-10-30-sp4a-displays/4-longrun.html` (LIN's 23 laps, VSC on L09 and L10, personal best L21; KUH's
// session best L20 in compact) and the Task 0 change `docs/design/2026-11-06-sp4.1b/changes.html` (L11 completed under
// a red flag).
import { known, toSessionTime, unknown } from '@pitwall/domain';
import type { Known, LapOverview, LapOverviewLap, LapStatus, Ms, Ratio, VisualCompound } from '@pitwall/domain';
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import type { widget } from './widget.ts';

const at = toSessionTime(2_100_000);
/** A known heat. */
export const heat = (h: Ratio): Known<Ratio> => known(h, at);
/** The heat of a lap outside its stint's pace laps. */
export const noHeat: Known<Ratio> = unknown('notApplicable');

/** One lap; the rest defaults to a green normal lap of stint 1 on softs without a best and without heat. */
export const lap = (lapNumber: number, lapTimeMs: Ms, over: Partial<Omit<LapOverviewLap, 'lapNumber' | 'lapTimeMs'>> = {}): LapOverviewLap => ({
  lapNumber,
  lapTimeMs,
  stint: 1,
  compound: 'soft',
  kind: 'normal',
  best: 'none',
  heat: noHeat,
  status: 'green',
  ...over,
});

export const overview = (laps: LapOverviewLap[]): LapOverview => ({ laps });

/** LIN's lap times in the mockups, L01 to L23 (stint 1 on softs L01–L15 with the in-lap L15, stint 2 on hards from the
 *  out-lap L16). */
const LIN_MS = [96100, 91300, 91000, 90900, 91100, 91000, 91300, 91200, 103400, 104000, 91500, 91600, 91900, 92200, 99700, 111200, 91000, 90800, 90700, 90900, 90600, 90800, 90900];

/** LIN's laps as the mockup draws them; `redLap` the lap completed under a red flag (Task 0: L11, 118.2 s). The heat is
 *  computed here for the sample only, the way the mockup does (the analysis delivers it): 0 = the stint's fastest pace
 *  lap, 1 = its slowest; L01, in, out and neutralised laps have none. */
export function linLaps(redLap?: number): LapOverviewLap[] {
  const laps = LIN_MS.map((ms, i) => {
    const n = i + 1;
    const stint = n <= 15 ? 1 : 2;
    const compound: VisualCompound = stint === 1 ? 'soft' : 'hard';
    const kind: LapOverviewLap['kind'] = n === 15 ? 'in' : n === 16 ? 'out' : 'normal';
    const status: LapStatus = n === redLap ? 'red' : n === 9 || n === 10 ? 'vsc' : 'green';
    const best: LapOverviewLap['best'] = n === 21 ? 'personal' : 'none';
    return lap(n, n === redLap ? 118_200 : ms, { stint, compound, kind, status, best });
  });
  for (const s of [1, 2]) {
    const pace = laps.filter((l) => l.stint === s && l.lapNumber !== 1 && l.kind === 'normal' && l.status === 'green');
    const lo = Math.min(...pace.map((l) => l.lapTimeMs));
    const hi = Math.max(...pace.map((l) => l.lapTimeMs));
    for (const l of pace) l.heat = heat((l.lapTimeMs - lo) / (hi - lo));
  }
  return laps;
}

/** KUH's 23 laps on mediums as the compact mockup draws them: VSC on L09 and L10, the session best L20 (heat 0). */
export function kuhLaps(): LapOverviewLap[] {
  return Array.from({ length: 23 }, (_, i) => {
    const n = i + 1;
    const status: LapStatus = n === 9 || n === 10 ? 'vsc' : 'green';
    const h = n === 1 || status !== 'green' ? undefined : n === 20 ? 0 : Math.min(1, Math.max(0.05, 0.25 + 0.03 * n + 0.25 * (0.6 * Math.sin(n * 2.3) + 0.4 * Math.sin(n * 0.7 + 1))));
    return lap(n, 91_000 + Math.round((h ?? 0.5) * 1_400), {
      compound: 'medium', status, best: n === 20 ? 'session' : 'none', heat: h === undefined ? noHeat : heat(h),
    });
  });
}

/** The gallery's synthetic cases; the tests take them from here, since only the gallery imports gallery.ts (C69). */
export const cases = {
  // The original mockup (first case: the screenshot baseline, Task 14): LIN, two stints, VSC on L09 and L10 under a
  // yellow strip, L01, in-lap L15 (i), out-lap L16 (o) and the VSC laps dim without heat, personal best L21 green.
  sample: { overview: overview(linLaps()) },
  // The Task 0 change: L11 completed under a red flag, dim without heat, a red strip under it (84×8).
  redLap: { overview: overview(linLaps(11)) },
  // KUH's compact mockup: one stint on mediums, the session best L20 purple, VSC on L09 and L10.
  sessionBest: { overview: overview(kuhLaps()) },
  // No completed lap yet.
  noLaps: { overview: overview([]) },
} satisfies NonNullable<GalleryEntry<typeof widget>['cases']>;

/** The gallery's fit sizes: the two minimums (the red-lap case drops a strip row at 84×7), the Task 0 full size 84×8,
 *  the compact edge just below full, and a larger full. */
export const fit = [
  { mode: 'compact', cols: 30, rows: 3 },
  { mode: 'compact', cols: 83, rows: 6 },
  { mode: 'full', cols: 84, rows: 7 },
  { mode: 'full', cols: 84, rows: 8 },
  { mode: 'full', cols: 100, rows: 12 },
] satisfies NonNullable<GalleryEntry<typeof widget>['fit']>;
