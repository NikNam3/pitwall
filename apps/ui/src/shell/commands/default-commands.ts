// The shell's own commands and their default keys (spec 7.7). Widgets cannot register commands in the MVP.
import { ackToken, type LinkGroup, type ReplayControl, type UiAction, type UiSettings } from '@pitwall/contracts';
import type { Insight } from '@pitwall/domain';
import * as text from '../../kit/text.ts';
import type { Inspection } from '../inspector/inspection.svelte.ts';
import { THEMES, type ThemeVariant } from '../../theme/index.ts';
import type { Command } from './registry.ts';

/** The overlays the shell can show. */
export type ShellOverlay =
  | { kind: 'palette' }
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
