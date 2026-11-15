// `tyre-model` (SP4.3c spec §5.2, O1): per car, compound and corner the tyre terms every planner and forecast reads,
// each with its source; one module per tyre type (`types/`). A calculator: no topic (C42).
export * from './behaviour.ts';
export * from './config.ts';
export { tyreModelAsOf, tyreModelCalculator } from './calculator.ts';
export { TYRE_MODEL } from './id.ts';
export { wearFactorKey } from './model.ts';
export { TYRE_MODEL_PROFILES } from './profiles.ts';
export { INTER_CONFIG } from './types/inter.ts';
export type { TypeLossInput, TypeModule, TypeOffsetInput, TypeRateInput } from './types/module.ts';
export { SLICK_CONFIG } from './types/slick.ts';
export { WET_CONFIG } from './types/wet.ts';
export type { TyreModelOutput } from '@pitwall/domain';
