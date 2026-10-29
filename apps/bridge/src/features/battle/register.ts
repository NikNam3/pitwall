import { BATTLE_CONFIG, battleCalculator, type BattleOutput } from '@pitwall/analysis';
import { bindState, defineFeature } from '../feature.ts';

/** `params.carId` must be an own integer property naming one of our cars in the output. */
const selectCard = (out: BattleOutput, params: object) => {
  if (!Object.hasOwn(params, 'carId')) return undefined;
  const { carId } = params as { carId: unknown };
  return typeof carId === 'number' && Number.isInteger(carId) && Object.hasOwn(out, carId) ? out[carId as keyof BattleOutput] : undefined;
};

/** `battle`: our cars against the car ahead and the car behind (`battle.cards`). */
export default defineFeature({
  name: 'battle',
  calculators: [battleCalculator],
  topics: [bindState('battle.cards', battleCalculator, selectCard)],
  config: [BATTLE_CONFIG],
});
