// The top bar's items in order (mockup 9-top-bar). A segment is `segments/<Name>.svelte`; adding, removing or moving one is a line here.

/** The file name of a segment without extension, lower case: `session` is `segments/Session.svelte`. */
export type SegmentName = 'session' | 'flag' | 'moment' | 'alerts' | 'replay' | 'feed' | 'realism';

export const TOP_BAR: { left: SegmentName[]; right: SegmentName[] } = {
  left: ['session', 'flag', 'moment'],
  right: ['alerts', 'replay', 'feed', 'realism'],
};
