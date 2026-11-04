// The segment helpers of the qualifying and practice car-activity tests (contract C84, C85): a committed segment
// replayed through a `SessionRunner` (`replaySegment`), what each frame showed of the cars (their signals and lap
// distance) and the spans a machine produced per car, with the frames they cover.
import type { DriverStatus, PitStatus, ResultStatus } from '@pitwall/domain';
import type { StepResult } from '../../../src/index.ts';
import { replaySegment, type SegmentRun } from '../../support/segment-run.ts';

/** What a frame showed of one car. */
export type CarSeen = { ds: DriverStatus; ps: PitStatus; rs: ResultStatus; d: number; lap: number };
export type Seen = SegmentRun<readonly CarSeen[]>;

const observe = (state: StepResult['state']): readonly CarSeen[] =>
  state.signals.cars.map((c, index) => {
    const timing = state.cars[index]!.timing;
    return { ds: c.driverStatus, ps: c.pitStatus, rs: c.resultStatus, d: timing.lapDistanceM, lap: timing.lap };
  });

/** Replays the segment `file` of `fixtures/segments/`. */
export const replayCars = (file: string): Promise<Seen> => replaySegment(file, observe);

/** The spans of `machine` for car `index`: kind, joined, the frames each covers. */
export const spansOf = (seg: Seen, machine: string, index: number) =>
  seg.spans(machine).filter((s) => s.carId === index).map((s) => ({ kind: s.kind, joinedAt: s.joinedAt, startFrame: s.startFrame, endFrame: s.endFrame }));

/** The frame number of the first frame whose view of car `index` satisfies `test`. */
export const firstFrame = (seg: Seen, index: number, test: (c: CarSeen) => boolean): number => {
  const found = seg.frames.find((f) => test(f.value[index]!));
  if (found === undefined) throw new Error(`no frame of car ${index} satisfies the test`);
  return found.frameNumber;
};

/** The frame number after the segment's last frame: where the session's end closes the open spans. */
export const afterLast = (seg: Seen): number => seg.frames.at(-1)!.frameNumber + 1;
