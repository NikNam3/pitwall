// Declaration of the gap-chart display (spec 8.3 V04): each car's gap to a virtual car at the reference pace, per lap.
import type { GapperParams } from '@pitwall/contracts';
import { declareWidget, folded, optional, topic } from '../../kit/define-widget.ts';
import { carOption, choiceOption, numberOption } from '../../kit/options.ts';
import { gapperReference, phasesFold, REFERENCE_KINDS } from './series.ts';

export const widget = declareWidget({
  name: 'gap-chart',
  title: 'Gap chart',
  data: {
    gapper: topic('gaps.gapper', ({ link, options }): GapperParams => ({
      reference: gapperReference({
        reference: options['reference'],
        referenceCar: options['referenceCar'],
        fixedLapS: options['fixedLapS'],
      }, link.primary),
    })),
    phases: folded('flagPhases', phasesFold),
    cars: topic('cars.overview'),
    session: optional(topic('session.info')),
  },
  options: {
    reference: choiceOption(REFERENCE_KINDS, 'leaderAverage', 'Reference pace'),
    referenceCar: carOption('Reference car (car average)'),
    fixedLapS: numberOption(90, 'Fixed lap time, s', { min: 30, max: 300, step: 0.1 }),
  },
  // The mockup's 760 px panel is about 90 cells wide; a wider panel shows more laps, never thicker lines.
  sizes: { compact: { minCols: 36, minRows: 8 }, full: { minCols: 72, minRows: 14 } },
});
