// Declaration of the incident-feed display (spec 8.3, V35): one line per incident of the neighbourhood, newest first.
import { declareWidget, optional, topic } from '../../kit/define-widget.ts';

export const widget = declareWidget({
  name: 'incident-feed',
  title: 'Incidents',
  data: {
    feed: topic('incidents.feed'),
    cars: topic('cars.overview'),
    moment: optional(topic('raceMoment.current')),
  },
  // Mockup 2-timing.html: full 70x5 (five lines, no header), compact 34x3 (LAP, cars, what).
  sizes: { compact: { minCols: 34, minRows: 3 }, full: { minCols: 70, minRows: 5 } },
});
