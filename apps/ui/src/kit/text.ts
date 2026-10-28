// Every fixed text of the kit and the shell (spec 4.3, 7.4): the one place UI wording changes.

/** Header state while a required topic has no value yet. */
export const noDataYet = 'no data yet';

/** Header state when a required topic errored on the bridge. */
export const errored = 'error';

/** First words of the errored panel's sentence. */
export const noResult = 'No result.';

/** Rest of the errored panel's sentence, naming the topic that failed. */
export const topicErrored = (topic: string): string => `The bridge reported an error for ${topic}.`;

/** Header state of a panel whose values fell behind; without seconds when only the feed or link is known to be stale. */
export const stale = (seconds?: number): string => (seconds === undefined ? 'stale' : `stale ${seconds} s`);

/** Header state of a `Computed` result: the lap it was computed for. */
export const computedFor = (lap: number): string => `L${lap}`;

/** Body of a panel whose widget is not in this build. */
export const unknownWidget = (name: string): string => `unknown widget ${name}`;

/** Body of a panel too small for every size mode of its widget. */
export const tooSmall = 'too small';

/** Note for a panel option that was invalid or unknown and is ignored. */
export const optionIgnored = (panelId: string, option: string): string => `${panelId}: option ${option} ignored`;

/** Between the items of a one-line list. */
export const separator = ' · ';

/** Shown while the window reloads after the bridge announced another contract version. */
export const bridgeUpdated = 'bridge updated, reload';

/** The button of an empty window that opens the widget picker. */
export const addWidget = 'add widget';

/** Accessible name of a panel's settings icon. */
export const settings = 'settings';

/** Prefix of an estimated value in a value cell. */
export const estimatedPrefix = '~';

/** Body of a gallery cell whose moment file is missing. */
export const momentMissing = 'moment not generated, run pnpm gen:moments';
