// `talk-window` (spec 6.3): publishes the per-car topic `talkWindow.car`.
import type { CarId, TalkWindow } from '@pitwall/domain';

export type { TalkWindow } from '@pitwall/domain';
export * from './behaviour.ts';
export * from './config.ts';

/** The calculator id. */
export const TALK_WINDOW = 'talk-window';

/** The output: the topic's value per car; the binding's `select` picks `params.carId`. */
export type TalkWindowOutput = Record<CarId, TalkWindow>;
