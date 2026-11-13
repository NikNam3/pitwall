// Builders and cases shared by the drivers-panel gallery and its tests (test-phase file: the implementer does not edit it).
// The sample is the approved mockup's (docs/design/2026-11-12-sp4.3b/drivers-panel.html, gen.mjs): the garage before the
// Spa race (08 Nov). Two seats, Mercedes #12 and #63, linked to the persons kuh and lin. kuh's σ lap has an override
// (0.380 s; computed 0.412 s); lin's soft wear is unknown (no soft laps). kuh excluded the Zandvoort race (a guest in #12).
// The config carries `strategy`'s real keys (its race-monte-carlo settings among them; a simulator has no config of its
// own, C50) and `battle`'s `drsRangeMs`; `config.json` set `strategy.neighbourMaxLaps` and `battle.drsRangeMs`.
import type { ConfigEffectiveValue, SessionInfo } from '@pitwall/contracts';
import { carId, feedId, known, toSessionTime, unknown } from '@pitwall/domain';
import type {
  DriversLinksValue, DriversProfilesValue, GameSettings, LinkedSession, PersonId, ProfileEntry, SessionRef, SessionState,
  UnlinkedSlot, WeekendPhase,
} from '@pitwall/domain';
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import type { widget } from './widget.ts';

/** Stored values carry no race-clock time of their own: the bridge's store writes them `at` 0. */
const k = (value: number) => known(value, toSessionTime(0));

export const MERCEDES = 0;
export const SPA = 10;
export const MONZA = 11;
export const TEXAS = 15;
export const ZANDVOORT = 26;
export const KUH: PersonId = 'kuh';
export const LIN: PersonId = 'lin';
export const FEED = feedId('feed-kuh');

/** The profile entry keys of `driver-noise` (its `PROFILE_KEYS`; the panel gets them from the topic, never from the unit, C1). */
export const key = {
  sigma: 'driverNoise.sigmaMs',
  rho: 'driverNoise.rho',
  mistakeRate: 'driverNoise.mistakeRate',
  mistakeMedian: 'driverNoise.mistakeMedianMs',
  mistakeSigmaLog: 'driverNoise.mistakeSigmaLog',
  wear: (c: 'soft' | 'medium' | 'hard') => `driverNoise.wearRatePct.${c}`,
} as const;

/**
 * A person of `drivers.profiles` with the overrides of their file: the field the panel needs to fill an override field
 * and draw the overridden value faint (requested of the supervisor, Task 16 report: `DriversProfilesValue` persons carry
 * `overrides` (`DriverPerson`'s), and an entry's `value` in the topic is the computed one, without the override). The
 * intersection stays valid once the domain type has the field.
 */
export type PersonValue = DriversProfilesValue['persons'][number] & { overrides: Record<string, number> };
/** What the panel's four data entries get. */
export type PanelData = {
  profiles: { persons: PersonValue[] };
  links: DriversLinksValue;
  session: SessionInfo | undefined;
  config: ConfigEffectiveValue | undefined;
};

const entry = (value: number | 'insufficientData', laps: number, sessions: number, newestSession: string): ProfileEntry => ({
  value: value === 'insufficientData' ? unknown(value) : k(value), laps, sessions, newestSession,
});

const phase = {
  fp2: { kind: 'practice', format: 'practice', segment: 2 },
  q1: { kind: 'qualifying', format: 'grandPrix', segment: 1 },
  race: { kind: 'race', format: 'grandPrix' },
} as const satisfies Record<string, WeekendPhase>;

/** A stored session of the feed `kuh`'s car (car 0). */
export const ref = (sessionUid: string, weekendId: string): SessionRef => ({ sessionUid, weekendId, feedCar: carId(0) });
const linked = (date: string, trackId: number, p: WeekendPhase, laps: number, session: SessionRef, excluded = false): LinkedSession => ({
  session, date, trackId, phase: p, laps, excluded,
});

/** The stored sessions of the sample. */
export const SESSIONS = {
  spaQ1: ref('spa-q1', 'spa-2026'),
  spaFp2: ref('spa-fp2', 'spa-2026'),
  monzaRace: ref('monza-race', 'monza-2026'),
  monzaFp2: ref('monza-fp2', 'monza-2026'),
  zandvoortRace: ref('zandvoort-race', 'zandvoort-2026'),
  texasRace: ref('texas-race', 'texas-2026'),
} as const;

/** kuh's linked sessions, newest first, the Zandvoort race excluded (5 kept, 214 laps). */
export const kuhSessions: LinkedSession[] = [
  linked('2026-11-08', SPA, phase.q1, 18, SESSIONS.spaQ1),
  linked('2026-11-07', SPA, phase.fp2, 31, SESSIONS.spaFp2),
  linked('2026-11-01', MONZA, phase.race, 51, SESSIONS.monzaRace),
  linked('2026-10-31', MONZA, phase.fp2, 28, SESSIONS.monzaFp2),
  linked('2026-10-25', ZANDVOORT, phase.race, 70, SESSIONS.zandvoortRace, true),
  linked('2026-10-18', TEXAS, phase.race, 86, SESSIONS.texasRace),
];
/** lin's linked sessions, newest first, none excluded (4 kept, 166 laps). */
export const linSessions: LinkedSession[] = [
  linked('2026-11-08', SPA, phase.q1, 18, SESSIONS.spaQ1),
  linked('2026-11-07', SPA, phase.fp2, 26, SESSIONS.spaFp2),
  linked('2026-11-01', MONZA, phase.race, 51, SESSIONS.monzaRace),
  linked('2026-10-25', ZANDVOORT, phase.race, 71, SESSIONS.zandvoortRace),
];

/** kuh's entries; σ lap is the computed 412 ms (the override 380 ms is in `overrides`). */
export const kuhEntries: Record<string, ProfileEntry> = {
  [key.sigma]: entry(412, 214, 5, '2026-11-08'),
  [key.rho]: entry(0.31, 214, 5, '2026-11-08'),
  [key.mistakeRate]: entry(0.024, 214, 5, '2026-11-08'),
  [key.mistakeMedian]: entry(1_900, 214, 5, '2026-11-08'),
  [key.mistakeSigmaLog]: entry(0.55, 214, 5, '2026-11-08'),
  [key.wear('soft')]: entry(3.1, 22, 2, '2026-11-07'),
  [key.wear('medium')]: entry(2.2, 118, 4, '2026-11-08'),
  [key.wear('hard')]: entry(1.6, 74, 3, '2026-11-01'),
};
/** lin's entries; soft wear unknown (no soft laps). */
export const linEntries: Record<string, ProfileEntry> = {
  [key.sigma]: entry(447, 166, 4, '2026-11-08'),
  [key.rho]: entry(0.28, 166, 4, '2026-11-08'),
  [key.mistakeRate]: entry(0.031, 166, 4, '2026-11-08'),
  [key.mistakeMedian]: entry(2_300, 166, 4, '2026-11-08'),
  [key.mistakeSigmaLog]: entry(0.61, 166, 4, '2026-11-08'),
  [key.wear('soft')]: entry('insufficientData', 0, 0, ''),
  [key.wear('medium')]: entry(2.4, 96, 3, '2026-11-08'),
  [key.wear('hard')]: entry(1.7, 61, 3, '2026-11-01'),
};

const person = (
  id: PersonId, raceNumber: number, entries: Record<string, ProfileEntry>, sessions: LinkedSession[], overrides: Record<string, number> = {},
): PersonValue => {
  const kept = sessions.filter((s) => !s.excluded);
  return {
    person: id, displayName: id, entries, links: [{ team: MERCEDES, raceNumber }],
    excluded: sessions.filter((s) => s.excluded).map((s) => s.session), sessions,
    kept: { sessions: kept.length, laps: kept.reduce((n, s) => n + s.laps, 0) }, overrides,
  };
};

export const kuh = person(KUH, 12, kuhEntries, kuhSessions, { [key.sigma]: 380 });
export const lin = person(LIN, 63, linEntries, linSessions);
export const profiles = (...persons: PersonValue[]): PanelData['profiles'] => ({ persons });

/** Both seats linked; nothing unlinked. */
export const linkedBoth: DriversLinksValue = {
  links: [{ team: MERCEDES, raceNumber: 12, person: KUH }, { team: MERCEDES, raceNumber: 63, person: LIN }],
  unlinked: [],
  unlinkedSeats: [],
};
/** #63 without a link, a human seat of our running feed (the teammate, car 1). */
export const linUnlinkedLive: DriversLinksValue = {
  links: [{ team: MERCEDES, raceNumber: 12, person: KUH }],
  unlinked: [],
  unlinkedSeats: [{ feedId: FEED, carId: carId(1), team: MERCEDES, raceNumber: 63 }],
};

/** A stored session's human slot of seat Mercedes #63 without a link. */
export const unlinkedSlot = (session: SessionRef, date: string, trackId: number): UnlinkedSlot => ({
  session, date, trackId, carId: carId(1), teamId: MERCEDES, raceNumber: 63, name: null,
});
/** No session running: #12 linked; #63 only in two stored sessions' unlinked human slots (one seat). */
export const linUnlinkedStored: DriversLinksValue = {
  links: [{ team: MERCEDES, raceNumber: 12, person: KUH }],
  unlinked: [unlinkedSlot(SESSIONS.spaQ1, '2026-11-08', SPA), unlinkedSlot(SESSIONS.spaFp2, '2026-11-07', SPA)],
  unlinkedSeats: [],
};

/** The lobby of the Spa race: the mockup's settings. */
export const settings: GameSettings = {
  safetyCar: 'standard',
  redFlags: 'standard',
  carDamage: 'standard',
  carDamageRate: 'standard',
  tyreTemperature: 'surfaceAndCarcass',
  lowFuelMode: 'hard',
  recoveryMode: 'none',
  flashbackLimit: 'low',
  surfaceType: 'realistic',
  collisions: 'on',
  pitLaneTyreSim: true,
  parcFerme: true,
} as GameSettings;

/** `session.info` of the running feed: only the lobby settings matter to the panel. */
export const sessionInfo = (s: GameSettings = settings): SessionInfo => ({
  feedId: FEED, sessionUid: 'spa-race', playerCar: carId(0), teammateCar: carId(1), realism: false,
  session: { trackId: SPA, settings: s } as SessionState,
});

/** The feed's effective config: `strategy`'s neighbour and rival keys and `battle`'s DRS range. */
export const config: ConfigEffectiveValue = {
  values: {
    strategy: { neighbourMinLaps: 1, neighbourMaxLaps: 2, rivalScBoxChance: 0.88, rivalScMinTyreAge: 4, rivalReactionLaps: 0 },
    battle: { drsRangeMs: 1_200 },
  },
  overridden: { strategy: ['neighbourMaxLaps'], battle: ['drsRangeMs'] },
};

/** The gallery's synthetic cases; the tests take them from here, since only the gallery imports gallery.ts (C69). */
export const cases = {
  // The mockup's full and compact figures (first case: the screenshot baselines, Task 18): both seats linked.
  twoSeats: { profiles: profiles(kuh, lin), links: linkedBoth, session: sessionInfo(), config },
  // The mockup's second compact figure: #63 a human seat of our feed without a link.
  unlinkedSeat: { profiles: profiles(kuh, lin), links: linUnlinkedLive, session: sessionInfo(), config },
  // No session running (Review Focus 1): the seats from the links and the stored unlinked slots; LOBBY and CONFIG unknown.
  noSession: { profiles: profiles(kuh, lin), links: linUnlinkedStored, session: undefined, config: undefined },
} satisfies Record<string, PanelData> & NonNullable<GalleryEntry<typeof widget>['cases']>;

/** The gallery's fit sizes: the two minimums plus a larger size of each mode. */
export const fit = [
  { mode: 'compact', cols: 30, rows: 3 },
  { mode: 'compact', cols: 40, rows: 4 },
  { mode: 'full', cols: 92, rows: 36 },
  { mode: 'full', cols: 110, rows: 44 },
] satisfies NonNullable<GalleryEntry<typeof widget>['fit']>;
