// Declaration of the pit-loss-table display (spec 6; mockup docs/design/2026-11-06-sp4.1a/source-badge.html): the pit
// loss per condition with its source, and this session's stops.
import { declareWidget, topic } from '../../kit/define-widget.ts';

export const widget = declareWidget({
  name: 'pit-loss-table',
  title: 'Pit loss',
  data: {
    // The loss per condition and this session's stops.
    losses: topic('pitLosses.track'),
    // Driver codes of the stops.
    cars: topic('cars.overview'),
    // Our cars (player and teammate) take the own-car colour.
    session: topic('session.info'),
  },
  sizes: { compact: { minCols: 18, minRows: 3 }, full: { minCols: 32, minRows: 13 } },
});
