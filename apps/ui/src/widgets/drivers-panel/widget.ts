// Declaration of the drivers-panel display (SP4.3b spec §10, U5, U7, U8; mockup docs/design/2026-11-12-sp4.3b/drivers-panel.html):
// the seats and the persons linked to them, per person its profile entries with overrides and its linked sessions with an
// exclude toggle each; read-only, the lobby settings and the feed's effective config. Every edit is one `drivers.*`
// uiAction (C62c, C73, C74).
import { declareWidget, optional, topic } from '../../kit/define-widget.ts';

export const widget = declareWidget({
  name: 'drivers-panel',
  title: 'Drivers',
  data: {
    // Every person with their profile entries, links, exclusions and linked sessions (newest first).
    profiles: topic('drivers.profiles'),
    // The seat links, the stored unlinked human slots and our running feeds' unlinked human seats.
    links: topic('drivers.links'),
    // The running session: its lobby settings; absent without a session.
    session: optional(topic('session.info')),
    // The feed's effective config: every unit's values and the keys config.json set; absent without a session.
    config: optional(topic('config.effective')),
  },
  sizes: { compact: { minCols: 30, minRows: 3 }, full: { minCols: 92, minRows: 36 } },
  actions: ['drivers.add', 'drivers.link', 'drivers.exclude', 'drivers.include', 'drivers.override', 'drivers.override.clear'],
});
