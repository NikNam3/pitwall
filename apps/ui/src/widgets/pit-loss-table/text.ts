// Wording of the pit-loss-table display; text shared with the kit lives in kit/text.ts.
import type { EstimateSource, PitCondition, PitLossStop } from '@pitwall/domain';

/** Headers of the condition table by column key. */
export const conditionHeaders = { cond: 'COND', loss: 'LOSS', stat: 'STAT', n: 'N', source: 'SOURCE' } as const;
/** Headers of the stop table by column key. */
export const stopHeaders = { lap: 'LAP', drv: 'DRV', cond: 'COND', loss: 'LOSS', stat: 'STAT' } as const;
/** A track condition's name. */
export const conditions = { green: 'green', vsc: 'VSC', sc: 'SC' } as const satisfies Record<PitCondition, string>;
/** The SOURCE column's word per source kind. */
export const sourceWord = {
  session: 'session',
  calibration: 'calibration',
  default: 'default',
} as const satisfies Record<EstimateSource['kind'], string>;
/** Title above this session's stops. */
export const stopsTitle = 'THIS SESSION, NEWEST FIRST';
/** Hover of a stop that does not count, by why. */
export const unused = {
  noReference: 'not counted: no clean reference laps around the stop',
  penalty: 'not counted: the stop served a penalty',
} as const satisfies Record<Exclude<PitLossStop['use'], 'used'>, string>;
