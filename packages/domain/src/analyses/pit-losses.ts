// Value type of the `pit-losses` analysis (spec 4.3, 5): the pit loss per condition and this session's stops, for the pit-loss table.
import type { EstimateSource } from '../estimates.ts';
import type { CarId } from '../ids.ts';
import type { Known } from '../known.ts';
import type { PitStopRecord } from '../records.ts';
import type { Ms } from '../units.ts';

/** The track condition of a stop: its record's flag (green, VSC, SC). */
export type PitCondition = PitStopRecord['flag'];

/**
 * The pit loss of one condition: the blend of the session's stops and the prior (spec 4.3), the median stationary time
 * of the session's stops, how many stops of the session it rests on, and its source with the blend's parts.
 */
export type PitLossEstimate = { lossMs: Known<Ms>; stationaryMedianMs: Known<Ms>; sessionStops: number; source: EstimateSource };

/** One stop of the session: its loss, its stationary time, and whether it counts (`noReference`: no clean reference laps). */
export type PitLossStop = { carId: CarId; lap: number; condition: PitCondition; lossMs: Known<Ms>; stationaryMs: Ms; use: 'used' | 'noReference' };

/** `pitLosses.track`: per condition the loss, and this session's stops in lap order. */
export type PitLosses = { conditions: Record<PitCondition, PitLossEstimate>; stops: PitLossStop[] };
