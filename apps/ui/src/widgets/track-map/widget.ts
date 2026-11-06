// Declaration of the track-map display (spec 7.2): the track outline with every car at its lap distance, the flagged
// marshal zones and the major incidents of the last laps.
import { declareWidget, optional, topic } from '../../kit/define-widget.ts';

export const widget = declareWidget({
  name: 'track-map',
  title: 'Track',
  data: {
    geometry: topic('trackPositions.geometry'),
    cars: topic('trackPositions.cars'),
    markers: optional(topic('incidents.markers')),
  },
  // Mockup 2-map-views.html: full 64x20 (turn and sector labels, every car's code), compact 32x10.
  sizes: { compact: { minCols: 32, minRows: 10 }, full: { minCols: 64, minRows: 20 } },
});
