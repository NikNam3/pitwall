// The pit lane as a recorder sees it, the one rule for every recorder that needs it (C11: each keeps its own copy in its
// own open state; Task 17's activity spans replace it).
import type { PitStatus } from '@pitwall/domain';

/** A car's pit status on its previous LapData frame and, during a pit visit, the lap the visit began on. */
export type PitLane = { status: PitStatus; visitLap?: number };

/**
 * The car's pit lane after this frame's pit status. A visit begins where the status changes away from `none` and ends
 * where it changes back; leaving the garage (the first status seen is already not `none`) is no visit.
 */
export const pitLaneStep = (prev: PitLane | undefined, status: PitStatus, lap: number): { lane: PitLane; entered: boolean; left: boolean } => {
  const entered = prev?.status === 'none' && status !== 'none';
  const visitLap = entered ? lap : prev?.visitLap;
  const left = visitLap !== undefined && status === 'none';
  return { lane: { status, ...(visitLap !== undefined && !left && { visitLap }) }, entered, left };
};

/** The lanes with no visit in progress (the race start, spec 3.2); the statuses stay. */
export const endVisits = (lanes: Array<PitLane | undefined>): void => {
  lanes.forEach((lane, i) => {
    if (lane) lanes[i] = { status: lane.status };
  });
};
