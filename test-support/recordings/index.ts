// Synthetic session recordings for tests (SP4.3f Task 0c): a practice, qualifying or race of the builder's cars, as
// packets or as a `.pwrec.gz`, so a test needs no committed segment for a weekend's other sessions (C84).
import { PwrecWriter } from '../../apps/bridge/src/pwrec/writer.ts';
import type { Packet } from '../../packages/protocol/src/index.ts';
import { packetBytes, ScenarioBuilder } from '../../packages/engine/test/builders/index.ts';

/** The session types of the weekend structure `[1, 8, 15]`: practice, short qualifying, race. */
const SESSION_TYPE = { practice: 1, qualifying: 8, race: 15 } as const;
const WEEKEND_STRUCTURE = [1, 8, 15];
const RACE_LAPS = 56;
const FRAMES_PER_LAP = 10;

export type SyntheticSession = {
  sessionUid: bigint;
  weekendId: number;
  trackId: number;
  kind: 'practice' | 'qualifying' | 'race';
  /** The player car's slot. */
  player: number;
  cars: { teamId: number; raceNumber: number; name?: string }[];
  /** The race's samples (session type 15) every Session packet carries; default: none. Game units, as the packet holds them. */
  raceSamples?: { offsetMin: number; weather: number; rainPct: number }[];
  /** Laps the player drives (practice: one stint), default 3. */
  laps?: number;
};

/** A set as the TyreSets packet holds it: actual and visual compound codes, wear %, available, recommended session, life span, usable life, lap delta ms, fitted. */
type GameSet = [actual: number, visual: number, wear: number, available: 0 | 1, session: number, lifeSpan: number, usableLife: number, deltaMs: number, fitted: 0 | 1];
const FITTED_IDX = 5;
/**
 * The sets a short qualifying leaves (structure `[1, 8, 15]`), in the game's layout (13 dry, then 7 wet) and with its
 * flags, after the first TyreSets of `qualifying-texas-2026-end-dr`: the practice's sets returned (not available), the
 * qualifying's available (one soft used and fitted), those the game reserves for the race (session 15) not available
 * yet. The race's sets: S×3 (one used), M×2, H×1, I×4, W×3.
 */
const QUALIFYING_SETS: readonly GameSet[] = [
  ...[0, 1, 2, 3].map((): GameSet => [17, 16, 0, 0, 1, 22, 22, -133, 0]),
  [17, 16, 0, 1, 8, 22, 22, -133, 0],
  [17, 16, 6, 1, 8, 20, 22, 0, 1],
  [17, 16, 0, 0, 1, 22, 22, -133, 0],
  [17, 16, 0, 0, 15, 22, 22, -133, 0],
  [18, 17, 0, 0, 1, 31, 31, 580, 0],
  [18, 17, 0, 1, 8, 31, 31, 580, 0],
  [18, 17, 0, 0, 15, 31, 31, 580, 0],
  [19, 18, 0, 0, 1, 44, 44, 2187, 0],
  [19, 18, 0, 0, 15, 44, 44, 2187, 0],
  ...[0, 1, 2].map((): GameSet => [7, 7, 0, 1, 0, 53, 53, 5460, 0]),
  [7, 7, 0, 0, 15, 53, 53, 5460, 0],
  ...[0, 1].map((): GameSet => [8, 8, 0, 1, 0, 39, 39, 8585, 0]),
  [8, 8, 0, 0, 15, 39, 39, 8585, 0],
];
const tyreSetData = QUALIFYING_SETS.map(([actualTyreCompound, visualTyreCompound, wear, available, recommendedSession, lifeSpan, usableLife, lapDeltaTime, fitted]) => ({
  actualTyreCompound,
  visualTyreCompound,
  wear,
  available,
  recommendedSession,
  lifeSpan,
  usableLife,
  lapDeltaTime,
  fitted,
}));

/** The player's slot and its teammate's (the other slot of the player's team), if the session has one. */
const ourSlots = (s: SyntheticSession): number[] => {
  const team = s.cars[s.player]?.teamId;
  const mate = s.cars.findIndex((c, i) => i !== s.player && c.teamId === team);
  return mate < 0 ? [s.player] : [s.player, mate];
};

/**
 * The session as packets (`ScenarioBuilder`), ending with SEND. At the start of every lap the player's and its
 * teammate's TyreSets (`QUALIFYING_SETS`, whatever the session's kind), as the game repeats them.
 */
export function syntheticPackets(s: SyntheticSession): { packet: Packet; receivedAtMs: number }[] {
  const samples = s.raceSamples ?? [];
  const builder = new ScenarioBuilder({ sessionUid: s.sessionUid, cars: s.cars.length, player: s.player })
    .session({
      sessionType: SESSION_TYPE[s.kind],
      weekendStructure: WEEKEND_STRUCTURE,
      numSessionsInWeekend: WEEKEND_STRUCTURE.length,
      weekendLinkIdentifier: s.weekendId,
      trackId: s.trackId,
      totalLaps: RACE_LAPS,
      numWeatherForecastSamples: samples.length,
      weatherForecastSamples: samples.map((x) => ({ sessionType: SESSION_TYPE.race, timeOffset: x.offsetMin, weather: x.weather, rainPercentage: x.rainPct })),
    })
    .participants({
      participants: s.cars.map((c, i) => ({ teamId: c.teamId, raceNumber: c.raceNumber, name: c.name ?? `DRIVER ${i}` })),
    });
  const laps = s.laps ?? 3;
  const ours = ourSlots(s);
  builder.frames(laps * FRAMES_PER_LAP, (f, i) => {
    f.lapData.lapData[s.player]!.currentLapNum = Math.floor(i / FRAMES_PER_LAP) + 1;
    if (i % FRAMES_PER_LAP === 0) for (const carIdx of ours) f.add('tyreSets', { carIdx, tyreSetData, fittedIdx: FITTED_IDX });
  });
  return builder.event({ code: 'SEND' }).packets();
}

/** A fixed recording header: the same input writes the same bytes. */
const META = { recorderVersion: '0.1.0', startedAt: '2026-10-27T21:50:28.331Z', listenPort: 20777 };

/** Writes the session as a `.pwrec.gz` at `path` (`PwrecWriter`); its size stays under 1 MB. */
export async function writeSynthetic(path: string, s: SyntheticSession): Promise<void> {
  const packets = syntheticPackets(s);
  const writer = PwrecWriter.create(path, META);
  for (const { packet, receivedAtMs } of packets) writer.write(receivedAtMs, packetBytes(packet));
  await writer.close(packets.at(-1)!.receivedAtMs);
}
