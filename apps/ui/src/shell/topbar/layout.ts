// The top bar's items in order (mockup 9-top-bar). A segment is `segments/<Name>.svelte`; adding, removing or moving one is a line here.

/** The file name of a segment without extension, lower case: `session` is `segments/Session.svelte`. */
export type SegmentName = 'workbook' | 'session' | 'phase' | 'moment' | 'talk' | 'alerts' | 'replay' | 'feed' | 'realism';

export const TOP_BAR: { left: SegmentName[]; right: SegmentName[] } = {
  left: ['workbook', 'session', 'phase', 'moment', 'talk'],
  right: ['alerts', 'replay', 'feed', 'realism'],
};
