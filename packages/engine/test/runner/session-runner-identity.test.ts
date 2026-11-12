// SessionRunner: the identity wait (C61; moved from the bridge's session processor). Frames wait for the first
// Participants, which names the player's car and so the weekend context; the runner asks the injected `contextFor`
// for it once, then applies the frames it held, in order. Without Participants it starts after IDENTITY_WAIT_FRAMES
// frames (about 10 s at 60 Hz), and at the session's end, with no weekend context.
import { describe, expect, it, vi } from 'vitest';
import { carId, type ParticipantsValues, type SessionUid } from '@pitwall/domain';
import { IDENTITY_WAIT_FRAMES, SessionRunner, type Frame, type WeekendContext } from '../../src/index.ts';
import { ScenarioBuilder } from '../builders/index.ts';
import { initFor } from '../support/run.ts';
import { applyOne, timeline } from '../support/runner.ts';

const player = { teamId: 0, raceNumber: 1 };
/** One earlier session (Task 27: its projection and the car key of each slot, C62); empty, the runner never reads it. */
const WEEKEND: WeekendContext = { weekendId: 'w', player, sessions: [{ sessionUid: '1' as SessionUid, playerCar: carId(0),
  cars: [{ carId: carId(0), carKey: player }], projection: { laps: [], stints: [], pitStops: [], crossings: [], events: [], penalties: [], decisions: [], clock: [], spans: {}, appendedAt: {} } }] };

/** The frame without its Participants packet. */
const withoutParticipants = ({ participants: _participants, ...frame }: Frame): Frame => frame;

/** `n` frames of the shared 2-car timeline (Participants in frame 0 only), Participants moved to frame `at`, or dropped. */
const framesWithParticipantsAt = (n: number, at: number | undefined): Frame[] => {
  const frames = timeline(n, []);
  const participants = frames[0]!.participants!;
  return frames.map((f, i) => (i === at ? { ...withoutParticipants(f), participants } : withoutParticipants(f)));
};

/** Applies `frames` and notes, per result handed out, its frame id, the state's frame id and its weekend context then. */
const applyNoting = (runner: SessionRunner, frames: Frame[], seen: Array<{ frameId: number; stateFrameId: number; weekend: unknown }>) => {
  for (const f of frames) runner.apply(f, (r, applied) => seen.push({ frameId: applied.frameId, stateFrameId: r.state.lastFrameId, weekend: r.state.weekend }));
};

describe('SessionRunner: the identity wait', () => {
  it('waits IDENTITY_WAIT_FRAMES = 600 frames at most', () => {
    expect(IDENTITY_WAIT_FRAMES).toBe(600);
  });

  it('frames before the first Participants are held and applied after `contextFor` returns, in order', () => {
    const frames = framesWithParticipantsAt(10, 5);
    const seen: Array<{ frameId: number; stateFrameId: number; weekend: unknown }> = [];
    const asked: Array<{ participants: ParticipantsValues | undefined; resultsBefore: number }> = [];
    const runner = new SessionRunner(initFor(frames), {
      contextFor: (participants) => {
        asked.push({ participants, resultsBefore: seen.length });
        return WEEKEND;
      },
    });
    applyNoting(runner, frames.slice(0, 5), seen);
    expect([seen, asked]).toEqual([[], []]);
    applyNoting(runner, frames.slice(5, 6), seen);
    // asked once, before any frame was applied, with the player's slot and the car key (team, race number) of every slot
    // the Participants packet carries: no signal (numActiveCars) caps the list (M5 review B1, C13); car-status decides
    // who is in the session
    const slots = frames[5]!.participants!.participants.length;
    expect(asked).toHaveLength(1);
    expect(asked[0]!.resultsBefore).toBe(0);
    expect(asked[0]!.participants!.playerCar).toBe(carId(0));
    expect(asked[0]!.participants!.cars.map((c) => c.carId)).toEqual(Array.from({ length: slots }, (_, i) => carId(i)));
    // the shared timeline has 2 cars; the slots after them carry what the packet carries
    expect(asked[0]!.participants!.cars.slice(0, 2)).toEqual([
      { carId: carId(0), carKey: { teamId: 0, raceNumber: 1 } },
      { carId: carId(1), carKey: { teamId: 0, raceNumber: 2 } },
    ]);
    // then every held frame and the Participants frame, in order, each on its own state and with the weekend context
    expect(seen).toEqual([0, 1, 2, 3, 4, 5].map((id) => ({ frameId: id, stateFrameId: id, weekend: WEEKEND })));
    expect(runner.state.weekend).toBe(WEEKEND);
    // from then on every frame is applied at once, and the context is not asked again
    applyNoting(runner, frames.slice(6), seen);
    expect(seen.map((s) => s.frameId)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(asked).toHaveLength(1);
  });

  // M5 review B1 (C13): the car list is every slot the Participants packet carries, so the player's car is in it
  // wherever its slot is; which cars are in the session stays car-status's (C43)
  it('a player in a slot at or above numActiveCars gets its weekend context', () => {
    const frames = new ScenarioBuilder({ cars: 4, player: 3 }).participants({ numActiveCars: 2 }).frames(3, () => {}).build();
    // as the bridge looks the weekend up: by the player's car key in the list
    const contextFor = (participants: ParticipantsValues | undefined): WeekendContext | undefined =>
      participants?.cars.some((c) => c.carId === participants.playerCar) === true ? WEEKEND : undefined;
    const runner = new SessionRunner(initFor(frames), { contextFor });
    for (const f of frames) runner.apply(f);
    expect([frames[0]!.participants!.numActiveCars, frames[0]!.playerCarIndex]).toEqual([2, 3]);
    expect(runner.state.weekend).toBe(WEEKEND);
  });

  it('a session whose first frame carries Participants starts at once', () => {
    const frames = timeline(3, []);
    const contextFor = vi.fn(() => WEEKEND);
    const runner = new SessionRunner(initFor(frames), { contextFor });
    expect(applyOne(runner, frames[0]!).state.weekend).toBe(WEEKEND);
    expect(contextFor).toHaveBeenCalledTimes(1);
  });

  it('without Participants the runner starts after 600 frames with no weekend context', () => {
    const frames = framesWithParticipantsAt(605, 602);
    const seen: Array<{ frameId: number; stateFrameId: number; weekend: unknown }> = [];
    const contextFor = vi.fn((participants: ParticipantsValues | undefined) => (participants === undefined ? undefined : WEEKEND));
    const runner = new SessionRunner(initFor(frames), { contextFor });
    applyNoting(runner, frames.slice(0, 599), seen);
    expect(seen).toEqual([]);
    expect(contextFor).not.toHaveBeenCalled();
    applyNoting(runner, frames.slice(599, 600), seen);
    expect(contextFor.mock.calls).toEqual([[undefined]]);
    expect(seen).toEqual(Array.from({ length: 600 }, (_, id) => ({ frameId: id, stateFrameId: id, weekend: undefined })));
    // a Participants packet later changes nothing: the session runs on without a weekend context
    applyNoting(runner, frames.slice(600), seen);
    expect(seen.map((s) => s.frameId)).toEqual(Array.from({ length: 605 }, (_, id) => id));
    expect(contextFor).toHaveBeenCalledTimes(1);
    expect(runner.state.weekend).toBeUndefined();
  });

  // Review F2 of Task 3: an exception on a frame skips that frame (the bridge reports it, naming `applying`), also in the
  // release of the held frames; the frames after it stay held and the next call applies them first.
  describe('a step that throws while held frames are released', () => {
    /** Frames 0..9, Participants in frame 5, and frame 2 one that `step` cannot take (lap data without its cars). */
    const withBrokenFrame = () =>
      framesWithParticipantsAt(10, 5).map((f) => (f.frameId === 2 ? { ...f, lapData: { ...f.lapData!, lapData: null as never } } : f));
    const releaseThrowing = () => {
      const frames = withBrokenFrame();
      const seen: Array<{ frameId: number; stateFrameId: number; weekend: unknown }> = [];
      const contextFor = vi.fn(() => WEEKEND);
      const runner = new SessionRunner(initFor(frames), { contextFor });
      applyNoting(runner, frames.slice(0, 5), seen);
      expect(() => applyNoting(runner, frames.slice(5, 6), seen)).toThrow(TypeError);
      return { frames, seen, contextFor, runner };
    };

    it('a step that throws while held frames are released skips only that frame; the rest are applied', () => {
      const { frames, seen, contextFor, runner } = releaseThrowing();
      // the frame that threw is the one being applied, for the report; the frames before it were applied
      expect(runner.applying?.frameId).toBe(2);
      expect(seen.map((s) => s.frameId)).toEqual([0, 1]);
      // the next call applies the frames still held first, each on its own state, then its own frame
      applyNoting(runner, frames.slice(6), seen);
      expect(seen).toEqual([0, 1, 3, 4, 5, 6, 7, 8, 9].map((id) => ({ frameId: id, stateFrameId: id, weekend: WEEKEND })));
      expect(contextFor).toHaveBeenCalledTimes(1);
    });
    it('`end()` applies the frames still held after the throw', () => {
      const { seen, runner } = releaseThrowing();
      runner.end((r, applied) => seen.push({ frameId: applied.frameId, stateFrameId: r.state.lastFrameId, weekend: r.state.weekend }));
      expect(seen.map((s) => s.frameId)).toEqual([0, 1, 3, 4, 5]);
    });
  });

  it('frames still held when the session ends are applied by `end()`, with no weekend context', () => {
    const frames = framesWithParticipantsAt(10, undefined);
    const seen: Array<{ frameId: number; stateFrameId: number; weekend: unknown }> = [];
    const contextFor = vi.fn((participants: ParticipantsValues | undefined) => (participants === undefined ? undefined : WEEKEND));
    const runner = new SessionRunner(initFor(frames), { contextFor });
    applyNoting(runner, frames, seen);
    expect(seen).toEqual([]);
    runner.end((r, applied) => seen.push({ frameId: applied.frameId, stateFrameId: r.state.lastFrameId, weekend: r.state.weekend }));
    expect(contextFor.mock.calls).toEqual([[undefined]]);
    expect(seen).toEqual(Array.from({ length: 10 }, (_, id) => ({ frameId: id, stateFrameId: id, weekend: undefined })));
    // nothing is held any more: a second `end()` applies nothing
    runner.end(() => seen.push({ frameId: -1, stateFrameId: -1, weekend: undefined }));
    expect(seen).toHaveLength(10);
  });
});
