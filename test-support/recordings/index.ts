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

/** The session as packets (`ScenarioBuilder`), ending with SEND. */
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
  builder.frames(laps * FRAMES_PER_LAP, (f, i) => {
    f.lapData.lapData[s.player]!.currentLapNum = Math.floor(i / FRAMES_PER_LAP) + 1;
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
