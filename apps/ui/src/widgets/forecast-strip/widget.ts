// Declaration of the forecast-strip display (spec 4; mockup docs/design/2026-10-30-sp4a-displays/5-weather.html): the
// game's forecast samples of this session, one column each, the first rain marked.
import { declareWidget, topic } from '../../kit/define-widget.ts';

export const widget = declareWidget({
  name: 'forecast-strip',
  title: 'Forecast',
  data: {
    // The samples, the game's accuracy flag and the first rain (from `rain-outlook`).
    forecast: topic('weather.forecast'),
  },
  // Full: the label column and seven sample columns of seven; five data rows and the accuracy note's row (R10).
  sizes: { compact: { minCols: 34, minRows: 2 }, full: { minCols: 56, minRows: 6 } },
});
