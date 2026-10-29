// The analyses (spec 4–7): one folder per unit; each folder's index exports its calculator id, output type and config.
export * from './alarms/index.ts';
export * from './battle/index.ts';
export * from './car-bands/index.ts';
export * from './damage/index.ts';
export * from './ers/index.ts';
export * from './fuel/index.ts';
export * from './gaps/index.ts';
export * from './incidents/index.ts';
export * from './lap-classes/index.ts';
export * from './lap-times/index.ts';
export * from './pace/index.ts';
export * from './pace-delta/index.ts';
export * from './per-lap-rate/index.ts';
export * from './race-moment/index.ts';
export * from './session-remaining/index.ts';
export { sessionRemainingCalculator } from './session-remaining/calculator.ts';
export { ersCalculator } from './ers/calculator.ts';
export * from './tyre-wear/index.ts';
