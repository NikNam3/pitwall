// Every fixed text of the kit and the shell (spec 4.3, 7.4): the one place UI wording changes.
import type { Corners, DamageParts, EstimateSource, IncidentKind, InsightCategory, PitCondition, UnknownReason } from '@pitwall/domain';

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

/** The loading screen's line until a window has the bridge's `hello` and its workbook. */
export const loading = {
  /** No link yet, or the starting bridge does not know the count of recordings yet. */
  starting: 'starting the bridge',
  /** The starting bridge rebuilds stored sessions (C61): `done` of `total` recordings. */
  rebuilding: (done: number, total: number): string => `rebuilding sessions ${done}/${total}`,
  /** The bridge serves; the window's workbook has not arrived yet. */
  workbook: 'loading the workbook',
} as const;

/** Between a before and an after (positions, gaps, settings): one glyph for every display. */
export const arrow = '→';

/** Before the places a car gained, in its position mark: `▲2`. */
export const positionGained = '▲';
/** Before the places a car lost, in its position mark: `▼1`. */
export const positionLost = '▼';
/** A before/after position pair whose position held. */
export const positionUnchanged = '—';

/** Shown while the window reloads after the bridge announced another contract version. */
export const bridgeUpdated = 'bridge updated, reload';

/** The button of an empty window that opens the widget picker. */
export const addWidget = 'add widget';

/** Accessible name of a panel's settings icon. */
export const settings = 'settings';

/** The top-bar toggle of the window's edit mode, and the accessible names of the buttons it shows. */
export const editLayout = 'edit layout';
export const addPanel = 'add panel';
export const removePanel = 'remove panel';
/** The marks of those buttons: a group's `+` and a panel's `×`. */
export const addPanelMark = '+';
export const removePanelMark = '×';

/** Hover text of an unknown value: why the value is missing (spec 5; `UnknownReason`). */
export const unknownReason = {
  restricted: "hidden by the driver's telemetry setting",
  notReceived: 'not received yet',
  notApplicable: 'not applicable',
  realism: 'hidden by realism mode',
  insufficientData: 'too few laps or samples yet',
} as const satisfies Record<UnknownReason, string>;

/** Mark of a value still to come (measuring, not received yet): the ellipsis. */
const markPending = '…';
/** Mark of a value that will not come (hidden, not applicable): the en dash; the minus (U+2212) is for signed values. */
const markAbsent = '–';

/**
 * The one-character mark an unknown value shows in its cell, in the faint role, with `unknownReason` on hover (user
 * ruling 2026-10-30): an ellipsis while the value is still coming, an en dash when it will not come.
 */
export const unknownMark = {
  restricted: markAbsent,
  notReceived: markPending,
  notApplicable: markAbsent,
  realism: markAbsent,
  insufficientData: markPending,
} as const satisfies Record<UnknownReason, string>;

/** Prefix of an estimated value in a value cell. */
export const estimatedPrefix = '~';

/**
 * The source badge after a value that rests on a prior (spec 4.4): its mark per source kind (none for a value measured
 * this session, `ᶜ` for the calibration, `ᵖ` for a driver profile, `ᵈ` for a default) and its hover per kind.
 */
export const sourceMark = { session: '', calibration: 'ᶜ', profile: 'ᵖ', default: 'ᵈ' } as const satisfies Record<EstimateSource['kind'], string>;
export const sourceHover = {
  session: (parts: string): string => ['session', parts].join(separator),
  calibration: (setName: string, sources: number, parts: string): string =>
    ['calibration', setName, `${sources} ${sources === 1 ? 'source' : 'sources'}`, parts].join(separator),
  profile: (person: string, laps: number, parts: string): string =>
    ['profile', person, `${laps} ${laps === 1 ? 'lap' : 'laps'}`, parts].join(separator),
  default: (note: string): string => ['default', note].join(separator),
} as const;
/** The source kind in words (a SOURCE column), shared by every display that names a source. */
export const sourceWord = {
  session: 'session',
  calibration: 'calibration',
  profile: 'profile',
  default: 'default',
} as const satisfies Record<EstimateSource['kind'], string>;

/** Body of a gallery cell whose moment file is missing. */
export const momentMissing = 'moment not generated, run pnpm gen:moments';

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
  calibration: 'Calibration',
  drivers: 'Drivers',
  plan: 'Plan',
  help: 'Help',
} as const;

export const commandTitles = {
  workbookOpen: (n: number): string => `Open workbook ${n}`,
  workbookPick: 'Pick a workbook',
  workbookSaveAs: 'Save workbook as',
  alertsAckAll: 'Acknowledge all alerts',
  alertAck: (key: string): string => `Acknowledge alert ${key}`,
  devInspect: 'Inspect a widget (dev)',
  pickPrimary: (group: number): string => `Pick primary car (group ${group})`,
  resetPrimary: (group: number): string => `Back to our driver (group ${group})`,
  paletteOpen: 'Command palette',
  keysOverview: 'Key overview',
  windowFocus: (id: string): string => `Focus window ${id}`,
  panelAdd: (title: string): string => `Add panel: ${title}`,
  panelRemove: (title: string): string => `Remove panel: ${title}`,
  layoutEditToggle: 'Edit layout',
  layoutEditAddPanel: 'Add panel to the active group',
  realismToggle: 'Toggle realism mode',
  replayPause: 'Pause replay',
  replayPlay: 'Play replay',
  fontBigger: 'Bigger font',
  fontSmaller: 'Smaller font',
  fontReset: 'Default font size',
  theme: (name: string): string => `Theme ${name}`,
  calibrationPick: 'Pick the calibration set',
  calibrationChoose: (setName: string): string => `Calibration: ${setName}`,
  driversOpen: 'Link the drivers',
  planCommit: (car: number): string => `Commit the plan for car ${car}`,
  planClear: (car: number): string => `Clear the plan for car ${car}`,
} as const;

/** The session-start calibration prompt and the top bar's calibration segment (SP4.1a spec 3.3). */
export const calibration = {
  /** The track, then the session's kind as the top bar names it (`Silverstone race`); the track alone without one. */
  promptTitle: (track: string, session?: string): string =>
    ['Calibration for this session', session === undefined ? track : `${track} ${session}`].join(separator),
  sources: (n: number): string => `${n} ${n === 1 ? 'source' : 'sources'}`,
  missing: (n: number): string => `${n} missing`,
  missingHover: 'a stint no longer in its session (session rebuilt or deleted): left out of every value',
  /** A set's day: when it was last used, else when it was made. */
  used: (day: string): string => `used ${day}`,
  created: (day: string): string => `new ${day}`,
  preselected: 'preselected',
  preselectedHover: 'the preselection for this track; Esc keeps it',
  /** The choice of no set: the track file's values. */
  defaults: 'defaults',
  defaultsNote: "the track file's values",
  footer: (kept: string): string => ['↑↓ move', 'Enter choose', `Esc keeps ${kept}`].join(separator),
  /** The top bar's label before the active set's name. */
  label: 'calibration',
} as const;

/** Notes of the key overview for entries of `keys.json` that are ignored. */
export const keyUnknownCommand = (key: string, command: string): string => `keys.json: "${key}" ${arrow} unknown command "${command}", ignored`;
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
/** The choice of a car option whose unset value is no car (a rival picker). */
export const noCar = 'none';
export const noSettings = 'no settings';
export const settingsSaved = 'saved in this workbook';
/** The settings popover's choice of the link group the panel follows. */
export const linkGroup = 'Link group';

/** Accessible name of the link marker button. */
export const linkMarker = 'link group';

/** Top bar (spec 7.6, 7.7, 7.9, 8.5). */
export const topBar = {
  /** Tooltip of the workbook name in the top bar, which opens the workbook picker. */
  workbookTitle: 'Open a workbook (Ctrl+O)',
  /** The count of human seats without a linked person (opens the drivers panel). */
  unlinked: 'unlinked',
  laps: (count: string): string => `${count} laps`,
  /** The player's current lap, of the session's total when it has one: `L23/62`. */
  lapOf: (lap: string, total: string | undefined): string => (total === undefined ? `L${lap}` : `L${lap}/${total}`),
  /** The session phase in the top bar (race control's situation); resting phases show nothing. */
  phase: { formation: 'FORMATION', startLights: 'START', sc: 'SC', vsc: 'VSC', red: 'RED', finished: 'FINISHED', paused: 'PAUSED' },
  /** The latest stage of a safety car period. */
  phaseStage: { deployed: 'deployed', returning: 'in this lap', returned: 'in', resume: 'resume' },
  /** The race moment's name (spec 7.2). */
  moment: { neutralised: 'neutralised', incident: 'incident', window: 'pit window', weather: 'weather', battle: 'battle', carCare: 'car care' },
  /** The talk window dot's tooltip (spec 7.4). */
  talk: { clear: 'good moment to talk', busy: 'braking: wait' },
  realismOn: 'realism on',
  realismOff: 'realism off',
  /** The value realism takes at the next session, shown when it differs from this one. */
  realismNext: (enabled: boolean): string => `${arrow} ${enabled ? 'on' : 'off'}`,
  feedUnknown: 'feed —',
  feedDown: 'feed down',
  feedStale: 'feed stale',
  lossUnknown: '—',
  feedOk: (loss: string): string => `feed ok · ${loss} loss`,
  playing: '⏵ playing',
  paused: '⏸ paused',
  speed: 'replay speed',
  lap: 'lap',
  beyondEnd: 'end of recording',
  /** A jump is fast-forwarding to its target. */
  jumping: 'jumping…',
  alertMark: '!',
  ack: 'ack',
  acknowledge: 'acknowledge alert',
  moreAlerts: (n: number): string => `+${n}`,
  mutedGroups: (n: number): string => `${n} muted`,
} as const;

/** The alarm groups the engineer mutes by category: their names and the toggle's two actions, for the top bar and the alarm list. */
export const alertGroups = {
  category: {
    strategy: 'strategy',
    tyres: 'tyres',
    energy: 'energy',
    car: 'car',
    damage: 'damage',
    race: 'race',
    feed: 'feed',
    system: 'system',
  } satisfies Record<InsightCategory, string>,
  mute: 'mute',
  unmute: 'unmute',
} as const;

/** Insight texts of the alarm kinds (spec 5.6); `formatInsight` fills in the values. */
export const insightText = {
  /** A tyre or brake or engine channel: `FR brake`, `RL carcass`, `engine`. */
  channel: { surfaceC: 'surface', carcassC: 'carcass', pressurePsi: 'pressure', brakesC: 'brake', engineC: 'engine' },
  outOfBandLap: 'out of band a full lap',
  above: 'above band',
  below: 'below band',
  wearLimitNear: (corner: string, laps: string): string => `${corner} wear limit in ${laps}`,
  fuelShort: (margin: string): string => `fuel short ${margin}`,
  damageJump: (parts: string, percent: string): string => `damage: ${parts} ${percent}`,
  warningLast: (warnings: number, before: number): string => `one warning left before a penalty ${warnings}/${before}`,
  penalty: 'penalty',
  /** The car parts of a damage jump, by the `DamageParts` keys the alarm sends. */
  part: {
    frontLeftWingPct: 'FL wing',
    frontRightWingPct: 'FR wing',
    rearWingPct: 'rear wing',
    floorPct: 'floor',
    diffuserPct: 'diffuser',
    sidepodPct: 'sidepod',
    gearboxPct: 'gearbox',
    enginePct: 'engine',
  } satisfies Record<keyof DamageParts, string>,
} as const;

/** The name of each corner of the car, by the `Corners` keys (`fl` -> `FL`). */
export const cornerNames = { fl: 'FL', fr: 'FR', rl: 'RL', rr: 'RR' } as const satisfies Record<keyof Corners<unknown>, string>;

/** The name of each sector of the lap (`2` -> `S2`). */
export const sectorNames = { 1: 'S1', 2: 'S2', 3: 'S3' } as const satisfies Record<1 | 2 | 3, string>;

/** What the incident feed says of each kind of incident. */
export const incidentKinds = {
  collision: 'collision',
  retirement: 'retirement',
  damage: 'damage',
  timeLoss: 'time loss',
  warning: 'warning',
  penalty: 'penalty',
  neutralised: 'neutralised',
} as const satisfies Record<IncidentKind, string>;

/**
 * The F1 25 infringement codes (PENA `infringementType`, the data-output spec's "Infringement types"), as short
 * lower-case words for a warning or penalty line.
 */
export const infringementNames: Readonly<Record<number, string>> = {
  0: 'slow driving',
  1: 'wrong way',
  2: 'reversing off the start',
  3: 'big collision',
  4: 'collision',
  5: 'position not given back',
  6: 'positions not given back',
  7: 'corner cutting, time gained',
  8: 'corner cutting overtake',
  9: 'corner cutting overtakes',
  10: 'crossed pit exit line',
  11: 'ignored blue flags',
  12: 'ignored yellow flags',
  13: 'ignored drive through',
  14: 'too many drive throughs',
  15: 'drive through due',
  16: 'drive through this lap',
  17: 'pit lane speeding',
  18: 'parked too long',
  19: 'tyre regulations',
  20: 'too many penalties',
  21: 'multiple warnings',
  22: 'near disqualification',
  23: 'tyre selection',
  24: 'tyre selections',
  25: 'lap invalid, corner cutting',
  26: 'lap invalid, ran wide',
  27: 'corner cutting',
  28: 'corner cutting, significant',
  29: 'corner cutting, extreme',
  30: 'lap invalid, wall riding',
  31: 'lap invalid, flashback',
  32: 'lap invalid, reset to track',
  33: 'blocking the pit lane',
  34: 'jump start',
  35: 'safety car collision',
  36: 'safety car overtake',
  37: 'too fast behind safety car',
  38: 'too fast under virtual safety car',
  39: 'slow formation lap',
  40: 'parked on formation lap',
  41: 'mechanical failure',
  42: 'terminal damage',
  43: 'too far behind safety car',
  44: 'black flag timer',
  45: 'unserved stop-go',
  46: 'unserved drive through',
  47: 'engine change',
  48: 'gearbox change',
  49: 'parc fermé change',
  50: 'league grid penalty',
  51: 'retry penalty',
  52: 'illegal time gain',
  53: 'mandatory pit stop',
  54: 'attribute assigned',
};

/** What the incident feed calls a warning: `corner cutting`, or the name of its infringement code; `warning` for a code we don't know. */
export const warningKind = (kind: 'cornerCutting' | 'other', infringement?: number): string =>
  kind === 'cornerCutting' ? 'corner cutting' : ((infringement === undefined ? undefined : infringementNames[infringement]) ?? 'warning');

/** A ghost's condition letter, at a ghost line's end and beside a map ring. */
const ghostLetters: Record<PitCondition, string> = { green: 'G', vsc: 'VSC', sc: 'SC' };
export const ghostLetter = (c: PitCondition): string => ghostLetters[c];
