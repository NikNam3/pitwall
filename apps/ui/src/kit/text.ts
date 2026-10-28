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

// Shell: commands, keys and overlays (spec 7.7). Command titles and the headings of the key overview.

/** Group headings of the key overview, one per kind of command. */
export const commandGroups = {
  workbooks: 'Workbooks',
  alerts: 'Alerts',
  cars: 'Cars',
  replay: 'Replay',
  window: 'Window',
  theme: 'Theme',
  realism: 'Realism',
  help: 'Help',
} as const;

export const commandTitles = {
  workbookOpen: (n: number): string => `Open workbook ${n}`,
  workbookPick: 'Pick a workbook',
  workbookSaveAs: 'Save workbook as',
  alertsAckAll: 'Acknowledge all alerts',
  pickPrimary: (group: number): string => `Pick primary car (group ${group})`,
  resetPrimary: (group: number): string => `Back to our driver (group ${group})`,
  paletteOpen: 'Command palette',
  keysOverview: 'Key overview',
  windowFocus: (id: string): string => `Focus window ${id}`,
  realismToggle: 'Toggle realism mode',
  replayPause: 'Pause replay',
  replayPlay: 'Play replay',
  fontBigger: 'Bigger font',
  fontSmaller: 'Smaller font',
  fontReset: 'Default font size',
  theme: (name: string): string => `Theme ${name}`,
} as const;

/** Notes of the key overview for entries of `keys.json` that are ignored. */
export const keyUnknownCommand = (key: string, command: string): string => `keys.json: "${key}" → unknown command "${command}", ignored`;
export const keyBoundTwice = (key: string, command: string): string => `keys.json: "${key}" is bound twice, "${command}" ignored`;
export const keyNotString = (key: string): string => `keys.json: "${key}" is not bound to a command name, ignored`;

/** Title of the key overview, and its label for the notes. */
export const keyOverviewTitle = 'Keys';

/** Placeholder of the palette's input. */
export const palettePlaceholder = 'command';

/** Empty palette result. */
export const noCommands = 'no matching command';

/** Title of the workbook picker, and of the name prompt of `workbook.saveAs`. */
export const workbooksTitle = 'Workbooks';
export const saveAsTitle = 'Save workbook as';

/** Empty workbook list. */
export const noWorkbooks = 'no workbooks';

/** Accessible name of the workbook name input. */
export const workbookName = 'workbook name';

/** Group picker (spec 7.5). */
export const picker = {
  primary: 'Primary',
  compare: 'Compare',
  window: 'Window',
  player: 'player',
  teammate: 'teammate',
  live: 'live',
  lap: 'lap',
  range: 'range',
  from: 'from lap',
  to: 'to lap',
  noFeed: 'no feed yet',
  noCars: 'no cars yet',
} as const;

/** Settings popover. */
export const settingsTitle = (widget: string): string => `${widget} · settings`;
/** The choice of a car option that follows the panel's link group. */
export const followLink = 'follow';
export const noSettings = 'no settings';
export const settingsSaved = 'saved in this workbook';

/** Accessible name of the link marker button. */
export const linkMarker = 'link group';
