// Declaration of the calibration-panel display (SP4.1a spec 6; mockup docs/design/2026-11-06-sp4.1a/calibration-panel.html):
// the calibration sets of a track, their sources, suggestions and values, each editable through one `calibration.*`
// uiAction (C73, C74). Choosing the race's set (`calibration.choose`) is the shell's prompt, not the panel's.
import { declareWidget, topic } from '../../kit/define-widget.ts';

export const widget = declareWidget({
  name: 'calibration-panel',
  title: 'Calibration',
  data: {
    // Every set, of all tracks, in the bridge's order.
    sets: topic('calibration.sets'),
    // Per set its entries and its sources' fits (or why a source is skipped).
    values: topic('calibration.values'),
    // Per track the suggested sources, and the newest stored session's track.
    candidates: topic('calibration.candidates'),
    // The running session's track and set; unknown without a session.
    active: topic('calibration.active'),
  },
  sizes: { compact: { minCols: 36, minRows: 7 }, full: { minCols: 76, minRows: 29 } },
  actions: [
    'calibration.set.create', 'calibration.set.copy', 'calibration.set.rename', 'calibration.set.delete',
    'calibration.source.add', 'calibration.source.remove', 'calibration.lap.exclude', 'calibration.lap.include',
    'calibration.override.set', 'calibration.override.clear',
    // The preferred set of a track (SP4.3b2): the star after the picker.
    'calibration.prefer',
  ],
});
