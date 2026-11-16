// The shell's own commands and their default keys (spec 7.7). Widgets cannot register commands in the MVP.
import { ackToken, type LinkGroup, type PanelSpec, type ReplayControl, type UiAction, type UiSettings } from '@pitwall/contracts';
import { PLAN_SLOTS, type CarId, type FeedId, type Insight, type Policy, type Slot } from '@pitwall/domain';
import * as text from '../../kit/text.ts';
import type { Inspection } from '../inspector/inspection.svelte.ts';
import { THEMES, type ThemeVariant } from '../../theme/index.ts';
import { defaultPanel } from '../workbooks/default-panel.ts';
import type { Command } from './registry.ts';

/** The overlays the shell can show. */
export type ShellOverlay =
  /** `adding`: opened by a group's `+`, it lists the `panel.add.*` commands only. */
  | { kind: 'palette'; adding?: true }
  | { kind: 'keys' }
  | { kind: 'workbooks' }
  | { kind: 'saveAs' }
  | { kind: 'picker'; group: number };

/** What the commands need from the shell. */
export type CommandContext = {
  send: (action: UiAction) => void;
  sendReplay: (control: ReplayControl) => void;
  open: (overlay: ShellOverlay) => void;
  workbookNames: () => readonly string[];
  /** The name of the workbook the bridge publishes as active; without it, or before one is published, `workbook.reset` does nothing. */
  activeWorkbook?: () => string | undefined;
  groups: () => readonly LinkGroup[];
  settings: () => Pick<UiSettings, 'realismNextSession'> | undefined;
  /** This window's font size in px. */
  fontPx: () => number;
  setFontPx: (px: number) => void;
  /** The font size of the theme in use. */
  defaultFontPx: () => number;
  setTheme: (variant: ThemeVariant) => void;
  /** Brings a workbook window to the front. */
  focusWindow: (id: string) => void;
  /** The occurrence tokens (`ackToken`) of the tier-1 alerts shown now. */
  alertKeys: () => readonly string[];
  /** The inspector's switch (dev builds). */
  inspection: Inspection;
};

/** Smallest and largest font size a window can be set to, in px. */
const FONT_MIN_PX = 11;
const FONT_MAX_PX = 20;

const WORKBOOK_SLOTS = 9;
/** The group the default keys act on. */
const KEY_GROUP = 1;

/** Default key to command id; `keys.json` overrides it. */
export const DEFAULT_KEYS: Readonly<Record<string, string>> = {
  ...Object.fromEntries(Array.from({ length: WORKBOOK_SLOTS }, (_, i) => [`Ctrl+${i + 1}`, `workbook.open.${i + 1}`])),
  'Ctrl+O': 'workbook.pick',
  'Ctrl+Enter': 'alerts.ackAll',
  'Ctrl+I': 'dev.inspect',
  Escape: `linkGroup.${KEY_GROUP}.resetPrimary`,
  'Ctrl+P': `linkGroup.${KEY_GROUP}.pickPrimary`,
  'Ctrl+K': 'palette.open',
  'Ctrl+E': 'layout.edit.toggle',
  '?': 'keys.overview',
  Space: 'replay.pause',
  'Ctrl+=': 'window.fontBigger',
  'Ctrl+-': 'window.fontSmaller',
  'Ctrl+0': 'window.fontReset',
};

/** The commands that do not depend on the workbook's windows. `dev.inspect` exists in dev builds only. */
export function defaultCommands(ctx: CommandContext): Command[] {
  const g = text.commandGroups;
  const t = text.commandTitles;
  const setFont = (px: number): void => {
    const next = Math.min(FONT_MAX_PX, Math.max(FONT_MIN_PX, px));
    if (next !== ctx.fontPx()) ctx.setFontPx(next);
  };
  const resetPrimary = (): void => {
    const group = ctx.groups().find((x) => x.id === KEY_GROUP);
    if (group !== undefined && group.primary !== 'player') ctx.send({ kind: 'linkGroup.set', group: { ...group, primary: 'player' } });
  };
  return [
    ...Array.from({ length: WORKBOOK_SLOTS }, (_, i): Command => ({
      id: `workbook.open.${i + 1}`,
      title: t.workbookOpen(i + 1),
      group: g.workbooks,
      run: () => {
        const name = ctx.workbookNames()[i];
        if (name !== undefined) ctx.send({ kind: 'workbook.open', name });
      },
    })),
    { id: 'workbook.pick', title: t.workbookPick, group: g.workbooks, run: () => ctx.open({ kind: 'workbooks' }) },
    { id: 'workbook.saveAs', title: t.workbookSaveAs, group: g.workbooks, run: () => ctx.open({ kind: 'saveAs' }) },
    {
      // The bridge resets the file and publishes the default; the window keeps no copy (C73).
      id: 'workbook.reset',
      title: t.workbookReset,
      group: g.workbooks,
      run: () => {
        const name = ctx.activeWorkbook?.();
        if (name !== undefined) ctx.send({ kind: 'workbook.reset', name });
      },
    },
    {
      id: 'alerts.ackAll',
      title: t.alertsAckAll,
      group: g.alerts,
      run: () => {
        const keys = [...ctx.alertKeys()];
        if (keys.length > 0) ctx.send({ kind: 'alert.ackAll', keys });
      },
    },
    ...(import.meta.env.DEV ? [{ id: 'dev.inspect', title: t.devInspect, group: g.help, run: () => ctx.inspection.toggle() }] : []),
    { id: `linkGroup.${KEY_GROUP}.resetPrimary`, title: t.resetPrimary(KEY_GROUP), group: g.cars, run: resetPrimary },
    { id: `linkGroup.${KEY_GROUP}.pickPrimary`, title: t.pickPrimary(KEY_GROUP), group: g.cars, run: () => ctx.open({ kind: 'picker', group: KEY_GROUP }) },
    { id: 'palette.open', title: t.paletteOpen, group: g.help, run: () => ctx.open({ kind: 'palette' }) },
    { id: 'keys.overview', title: t.keysOverview, group: g.help, run: () => ctx.open({ kind: 'keys' }) },
    {
      id: 'realism.toggle',
      title: t.realismToggle,
      group: g.realism,
      run: () => ctx.send({ kind: 'realism.set', enabled: !(ctx.settings()?.realismNextSession ?? false) }),
    },
    { id: 'replay.pause', title: t.replayPause, group: g.replay, run: () => ctx.sendReplay({ kind: 'pause' }) },
    { id: 'replay.play', title: t.replayPlay, group: g.replay, run: () => ctx.sendReplay({ kind: 'play' }) },
    { id: 'window.fontBigger', title: t.fontBigger, group: g.window, run: () => setFont(ctx.fontPx() + 1) },
    { id: 'window.fontSmaller', title: t.fontSmaller, group: g.window, run: () => setFont(ctx.fontPx() - 1) },
    { id: 'window.fontReset', title: t.fontReset, group: g.window, run: () => setFont(ctx.defaultFontPx()) },
    ...THEMES.map((variant): Command => ({
      id: `theme.${variant.name}`,
      title: t.theme(variant.name),
      group: g.theme,
      run: () => ctx.setTheme(variant),
    })),
  ];
}

/** `alerts.ack.<key>` for each alert the top bar shows; it acknowledges that occurrence (`ackToken`). */
export function alertCommands(alerts: readonly Insight[], ctx: Pick<CommandContext, 'send'>): Command[] {
  return alerts.map((alert) => ({
    id: `alerts.ack.${alert.key}`,
    title: text.commandTitles.alertAck(alert.key),
    group: text.commandGroups.alerts,
    run: () => ctx.send({ kind: 'alert.ack', key: ackToken(alert) }),
  }));
}

/** `window.focus.<id>` for each window of the active workbook. */
export function windowCommands(ids: readonly string[], ctx: Pick<CommandContext, 'focusWindow'>): Command[] {
  return ids.map((id) => ({ id: `window.focus.${id}`, title: text.commandTitles.windowFocus(id), group: text.commandGroups.window, run: () => ctx.focusWindow(id) }));
}

/** `panel.add.<widget>` for each widget of the build: adds a new panel of it to the dock's active group. */
export function panelCommands(decls: readonly Parameters<typeof defaultPanel>[0][], addPanel: (spec: PanelSpec) => void): Command[] {
  return decls.map((decl) => ({
    id: `panel.add.${decl.name}`,
    title: text.commandTitles.panelAdd(decl.title),
    group: text.commandGroups.window,
    run: () => addPanel(defaultPanel(decl)),
  }));
}

/** The id of the command that chooses a calibration set for the run; `null` is the track file's defaults. */
export const calibrationChooseId = (setId: string | null): string => `calibration.choose.${setId ?? 'defaults'}`;

/** The workbook the garage setup lives in (SP4.3b spec §10, U7): `calibration.pick` and `drivers.open` switch to it. */
export const GARAGE_WORKBOOK = 'garage';

/**
 * `calibration.pick` (the garage's calibration panel, through `pick`), one `calibration.choose.<setId>` per set of the
 * session's track and `calibration.choose.defaults` (SP4.1a spec 3.3, SP4.3b spec §10). A choice sends
 * `calibration.choose` for the feed.
 */
export function calibrationCommands(
  sets: readonly { id: string; name: string }[],
  ctx: Pick<CommandContext, 'send'> & { feedId: FeedId; pick: () => void },
): Command[] {
  const g = text.commandGroups.calibration;
  const t = text.commandTitles;
  const choose = (setId: string | null): void => ctx.send({ kind: 'calibration.choose', feedId: ctx.feedId, setId });
  return [
    { id: 'calibration.pick', title: t.calibrationPick, group: g, run: ctx.pick },
    ...sets.map((set): Command => ({ id: calibrationChooseId(set.id), title: t.calibrationChoose(set.name), group: g, run: () => choose(set.id) })),
    { id: calibrationChooseId(null), title: t.calibrationChoose(text.calibration.defaults), group: g, run: () => choose(null) },
  ];
}

/** `drivers.open`: the garage's drivers panel, through `open` (SP4.3b spec §10, README Q6 A). */
export const driversOpenCommand = (open: () => void): Command => ({
  id: 'drivers.open',
  title: text.commandTitles.driversOpen,
  group: text.commandGroups.drivers,
  run: open,
});

/** The id of the command that commits the given plan for car `carId` (C72, C76). */
export const planCommitId = (carId: CarId): string => `plan.commit.${carId}`;

/** The id of the command that clears car `carId`'s plan (C72, C76). */
export const planClearId = (carId: CarId): string => `plan.clear.${carId}`;

/**
 * The plan decision's commands (SP4.3b spec §8.2): per car, `plan.clear.<carId>`, and `plan.commit.<carId>` for a car
 * given a policy, which it sends whole. Both go as uiActions for the window's feed; the window keeps no copy (C73): the
 * plan takes effect when the bridge records it.
 */
export function planCommands(
  cars: readonly { carId: CarId; policy: Policy | null }[],
  ctx: Pick<CommandContext, 'send'> & { feedId: FeedId },
): Command[] {
  const g = text.commandGroups.plan;
  const t = text.commandTitles;
  return cars.flatMap(({ carId, policy }): Command[] => [
    ...(policy === null
      ? []
      : [{ id: planCommitId(carId), title: t.planCommit(carId), group: g, run: () => ctx.send({ kind: 'plan.commit', feedId: ctx.feedId, carId, policy }) }]),
    { id: planClearId(carId), title: t.planClear(carId), group: g, run: () => ctx.send({ kind: 'plan.clear', feedId: ctx.feedId, carId }) },
  ]);
}

/** `plan.<verb>.<carId>.<slot>`: the ids of the plan slot commands (C72). */
export const planSlotId = (verb: 'save' | 'activate' | 'remove' | 'edit', carId: CarId, slot: Slot): string => `plan.${verb}.${carId}.${slot}`;

/**
 * The plan slot commands (SP4.3d1 Task 11, C72-C74): per car and slot of `PLAN_SLOTS`, `plan.activate`, `plan.remove`
 * and `plan.edit`, and `plan.save` for a car given a policy (saved whole). The first three send their uiActions for the
 * window's feed; `plan.edit` sends nothing (C73): it opens the board's window-local draft through `edit`, which the
 * caller supplies (there is no shell seam for a widget-local action).
 */
export function planSlotCommands(
  cars: readonly { carId: CarId; policy: Policy | null }[],
  ctx: Pick<CommandContext, 'send'> & { feedId: FeedId },
  edit: (carId: CarId, slot: Slot) => void,
): Command[] {
  const g = text.commandGroups.plan;
  const t = text.commandTitles;
  const feedId = ctx.feedId;
  return cars.flatMap(({ carId, policy }) =>
    PLAN_SLOTS.flatMap((slot): Command[] => [
      ...(policy === null
        ? []
        : [{ id: planSlotId('save', carId, slot), title: t.planSave(carId, slot), group: g, run: () => ctx.send({ kind: 'plan.save', feedId, carId, slot, policy }) }]),
      { id: planSlotId('activate', carId, slot), title: t.planActivate(carId, slot), group: g, run: () => ctx.send({ kind: 'plan.activate', feedId, carId, slot }) },
      { id: planSlotId('remove', carId, slot), title: t.planRemove(carId, slot), group: g, run: () => ctx.send({ kind: 'plan.remove', feedId, carId, slot }) },
      { id: planSlotId('edit', carId, slot), title: t.planEdit(carId, slot), group: g, run: () => edit(carId, slot) },
    ]),
  );
}

/**
 * `session.end` (C59, C72): ends the recording of the window's feed's session now; it sends `session.end` for the feed.
 * The window keeps no copy (C73): the session ends when the bridge ends it.
 */
export function sessionEndCommand(ctx: Pick<CommandContext, 'send'> & { feedId: FeedId }): Command {
  return {
    id: 'session.end',
    title: text.commandTitles.sessionEnd,
    group: text.commandGroups.session,
    run: () => ctx.send({ kind: 'session.end', feedId: ctx.feedId }),
  };
}

/** `layout.edit.toggle`: turns the window's edit mode (window-local, C73) on or off. */
export function layoutEditCommand(toggle: () => void): Command {
  return { id: 'layout.edit.toggle', title: text.commandTitles.layoutEditToggle, group: text.commandGroups.window, run: toggle };
}

/**
 * `layout.edit.addPanel`: what a group's `+` runs; `addToActiveGroup` targets the active group and opens the palette on
 * the `panel.add.*` commands. Registered only while edit mode is on; its id is no `panel.add.*` one, so that palette
 * does not list it.
 */
export function layoutEditAddCommand(addToActiveGroup: () => void): Command {
  return { id: 'layout.edit.addPanel', title: text.commandTitles.layoutEditAddPanel, group: text.commandGroups.window, run: addToActiveGroup };
}

/** `panel.remove.<id>` for each panel of the window; registered only while edit mode is on. */
export function panelRemoveCommands(panels: readonly { id: string; title: string }[], removePanel: (id: string) => void): Command[] {
  return panels.map((panel) => ({
    id: `panel.remove.${panel.id}`,
    title: text.commandTitles.panelRemove(panel.title),
    group: text.commandGroups.window,
    run: () => removePanel(panel.id),
  }));
}
