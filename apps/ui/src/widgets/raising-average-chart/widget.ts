// Declaration of the raising-average-chart display (spec 4; approved mockup docs/design/2026-11-06-sp4.1b/changes.html,
// part a): per car the mean of its best X laps over X; our cars always, up to three rivals the options name.
import { declareWidget, optional, topic } from '../../kit/define-widget.ts';
import { carOption } from '../../kit/options.ts';
import * as text from './text.ts';

export const widget = declareWidget({
  name: 'raising-average-chart',
  title: text.title,
  data: {
    // Every car's curve in one value.
    analysis: topic('raisingAverage.field'),
    // Codes and teams of the drawn cars.
    cars: topic('cars.overview'),
    // Our cars (the player, then the teammate).
    session: optional(topic('session.info')),
  },
  options: {
    rival1: carOption(text.rivalLabel(1), { unset: 'none' }),
    rival2: carOption(text.rivalLabel(2), { unset: 'none' }),
    rival3: carOption(text.rivalLabel(3), { unset: 'none' }),
  },
  sizes: { compact: { minCols: 36, minRows: 8 }, full: { minCols: 60, minRows: 14 } },
});
