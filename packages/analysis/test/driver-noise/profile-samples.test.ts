// `driver-noise`'s profile samples (SP4.3c Task 8, B2; C26, C28, C43, C62c): how many laps of a linked stored session a
// person's profile rests on is the unit's declaration (`DRIVER_NOISE_PROFILES.samples`, as a priors entry declares its
// `samples`), not the bridge's count: the linked car's current laps (C25) whose described frame the projection module's
// membership (`membershipOf`, C26) puts in one of the car's `human` car-driver spans. The bridge only shows the number.
import { carDriverSpans, carId, known, unknown, type LapRecord, type SessionUid, type Span } from '@pitwall/domain';
import type { ProfileCtx, StoredDriverSession } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { DRIVER_NOISE_PROFILES } from '../../src/driver-noise/profiles.ts';
import { history, lap } from '../../../../test-support/builders/index.ts';
import { RACE } from '../situated.ts';

const CAR_DRIVER = carDriverSpans.machine;
const ctx: ProfileCtx = { config: {}, overrides: {} };

/** A closed car-driver span of car `c` over frames `[startFrame, endFrame)` (C26). */
const driverSpan = (c: number, kind: 'human' | 'ai', id: number, startFrame: number, endFrame: number): Span => ({
  machine: CAR_DRIVER, id, kind, carId: carId(c), start: startFrame * 100, end: endFrame * 100, confirmed: true, detail: {}, startFrame, endFrame,
});

/** Car `c`'s confirmed lap `n`, describing frame `frame` (its crossing, C26). */
const lapOf = (c: number, n: number, frame: number, over: Partial<LapRecord> = {}): LapRecord =>
  lap({ carId: carId(c), lapNumber: n, frame, status: 'confirmed', ...over });

/** A stored session of linked car `c` with the given laps and car-driver spans (all closed, C18). */
const stored = (c: number, laps: LapRecord[], spans: Span[], humanSpans: StoredDriverSession['humanSpans'] = []): StoredDriverSession => ({
  session: { sessionUid: '1' as SessionUid, weekendId: 'w1', feedCar: carId(0) },
  carId: carId(c),
  startedAt: '2026-11-05T19:00:00Z',
  phase: RACE,
  aiDifficulty: known(90, 0),
  totalLaps: known(10, 0),
  projection: history({ laps, spans: { [CAR_DRIVER]: spans } }),
  cars: [],
  humanSpans,
  track: unknown('notApplicable'),
});

/** The unit's declared count over one session; fails the test if the unit declares none. */
const samplesOf = (session: StoredDriverSession): number => {
  const samples = DRIVER_NOISE_PROFILES.samples;
  if (samples === undefined) throw new Error('driver-noise declares its profile samples');
  return samples(session, ctx);
};

describe('driver-noise profile samples (B2)', () => {
  it('driver-noise declares its profile samples', () => {
    expect(typeof DRIVER_NOISE_PROFILES.samples).toBe('function');
  });

  it('counts only the linked car`s laps whose frame lies in one of its human spans', () => {
    // Car 2: human over frames [0, 35), the AI over [35, 70): laps 1–3 (frames 10, 20, 30) human, laps 4–6 the AI's.
    // Car 3 is human throughout: its laps are another car's and never count for car 2.
    const laps = [1, 2, 3, 4, 5, 6].flatMap((n) => [lapOf(2, n, n * 10), lapOf(3, n, n * 10 + 1)]);
    const spans = [driverSpan(2, 'human', 0, 0, 35), driverSpan(2, 'ai', 1, 35, 70), driverSpan(3, 'human', 0, 0, 70)];
    expect(samplesOf(stored(2, laps, spans))).toBe(3);
    expect(samplesOf(stored(3, laps, spans))).toBe(6);
  });

  it('a span covers its start frame and not its end frame (C26)', () => {
    // Lap 1 describes frame 35, the human span's end and the AI span's start: the AI's. Lap 2 at frame 0, the start: human.
    const laps = [lapOf(2, 1, 0), lapOf(2, 2, 34), lapOf(2, 3, 35)];
    const spans = [driverSpan(2, 'human', 0, 0, 35), driverSpan(2, 'ai', 1, 35, 70)];
    expect(samplesOf(stored(2, laps, spans))).toBe(2);
  });

  it('a lap the AI drove all session gives no sample; a later human stint does', () => {
    const laps = [1, 2, 3, 4].map((n) => lapOf(2, n, n * 10));
    expect(samplesOf(stored(2, laps, [driverSpan(2, 'ai', 0, 0, 50)]))).toBe(0);
    // AI, then the human takes over from frame 25: laps 3 and 4.
    expect(samplesOf(stored(2, laps, [driverSpan(2, 'ai', 0, 0, 25), driverSpan(2, 'human', 1, 25, 50)]))).toBe(2);
  });

  it('counts each lap once: the confirmed record and the provisional it supersedes are one lap (C25)', () => {
    const laps = [
      lapOf(2, 1, 10, { status: 'provisional' }),
      lapOf(2, 1, 10),
      lapOf(2, 2, 20, { status: 'provisional' }),
    ];
    expect(samplesOf(stored(2, laps, [driverSpan(2, 'human', 0, 0, 50)]))).toBe(2);
  });

  it('reads the car-driver spans of the projection, not the session`s `humanSpans` copy (C26, C28)', () => {
    // `humanSpans` claims every frame human; the projection's spans say the AI drove from frame 25. Membership decides.
    const laps = [1, 2, 3, 4].map((n) => lapOf(2, n, n * 10));
    const spans = [driverSpan(2, 'human', 0, 0, 25), driverSpan(2, 'ai', 1, 25, 50)];
    expect(samplesOf(stored(2, laps, spans, [{ startFrame: 0, endFrame: 50 }]))).toBe(2);
  });

  it('a session without car-driver spans or laps gives 0', () => {
    expect(samplesOf(stored(2, [], []))).toBe(0);
    expect(samplesOf(stored(2, [lapOf(2, 1, 10)], []))).toBe(0);
  });
});
