import { talkWindowCalculator, TALK_WINDOW_CONFIG } from '@pitwall/analysis';
import { bindState, defineFeature, selectCar } from '../feature.ts';

/** `talk-window`: whether now is a good moment to talk to the driver, per car of ours (`talkWindow.car`). */
export default defineFeature({
  name: 'talk-window',
  calculators: [talkWindowCalculator],
  topics: [bindState('talkWindow.car', talkWindowCalculator, selectCar)],
  config: [TALK_WINDOW_CONFIG],
});
