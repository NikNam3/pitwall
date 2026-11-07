// Declaration of the gap-chart display (spec 8.3 V04): each car's gap to a virtual car at the reference pace, per lap.
import type { GapperParams } from '@pitwall/contracts';
import { declareWidget, optional, topic } from '../../kit/define-widget.ts';
import { carOption, choiceOption, numberOption } from '../../kit/options.ts';
import type { ParamContext } from '../../kit/types.ts';
import { gapperReference, REFERENCE_KINDS } from './series.ts';

/** The gapper's params from the panel's options: the ghost lines are asked for in the same reference. */
const gapperParams = ({ link, options }: ParamContext): GapperParams => ({
  reference: gapperReference({
    reference: options['reference'],
    referenceCar: options['referenceCar'],
    fixedLapS: options['fixedLapS'],
  }, link.primary),
});

export const widget = declareWidget({
  name: 'gap-chart',
  title: 'Gap chart',
  data: {
    gapper: topic('gaps.gapper', gapperParams),
    cars: topic('cars.overview'),
    session: optional(topic('session.info')),
    // The rejoin ghost (SP4.2 spec 4): the primary car's lines, and its losses for the header.
    ghosts: optional(topic('rejoin.ghostLines', gapperParams)),
    rejoin: optional(topic('rejoin.car', ({ link }) => ({ carId: link.primary }))),
  },
  options: {
    reference: choiceOption(REFERENCE_KINDS, 'leaderAverage', 'Reference pace'),
    referenceCar: carOption('Reference car (car average)'),
    fixedLapS: numberOption(90, 'Fixed lap time, s', { min: 30, max: 300, step: 0.1 }),
  },
  // The mockup's 760 px panel is about 90 cells wide; a wider panel shows more laps, never thicker lines.
  sizes: { compact: { minCols: 36, minRows: 8 }, full: { minCols: 72, minRows: 14 } },
});
