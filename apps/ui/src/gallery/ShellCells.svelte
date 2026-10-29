<script lang="ts">
  // The shell's cells (spec 10): the top bar under four cases, the palette, the key overview, and the settings popover
  // and inspector of `feed-status`. Each is the real component fed by a `GalleryConnection`, in a stage of its own.
  import { onDestroy } from 'svelte';
  import type { SessionInfo } from '@pitwall/contracts';
  import { carId, feedId } from '@pitwall/domain';
  import { TopicStore } from '../connection/topic-store.svelte.ts';
  import * as text from '../kit/text.ts';
  import type { ResolvedLink } from '../kit/types.ts';
  import Inspector from '../shell/inspector/Inspector.svelte';
  import { Inspection } from '../shell/inspector/inspection.svelte.ts';
  import { DEFAULT_KEYS, defaultCommands } from '../shell/commands/default-commands.ts';
  import KeyOverview from '../shell/commands/KeyOverview.svelte';
  import { parseKeys } from '../shell/commands/keys.ts';
  import { OVERLAY_COLS } from '../shell/commands/overlay-sizes.ts';
  import Palette from '../shell/commands/Palette.svelte';
  import { CommandRegistry } from '../shell/commands/registry.ts';
  import SettingsPopover from '../shell/panel/SettingsPopover.svelte';
  import TopBar from '../shell/topbar/TopBar.svelte';
  import { DEFAULT_THEME, role } from '../theme/index.ts';
  import { WIDGETS } from '../widgets/index.generated.ts';
  import { SHELL_CELLS, type ShellCell as Cell } from './cells.ts';
  import { freezeClock } from './fixed-clock.ts';
  import { GalleryConnection, type GalleryOverride } from './gallery-connection.ts';
  import { INSPECTOR_CATALOGUE, INSPECTOR_WIDGET } from './inspector-catalogue.ts';
  import type { MomentValues } from './moment-values.ts';
  import { afterFrames } from './ready.ts';
  import ShellCell from './ShellCell.svelte';
  import { snapOrigin } from './snap.ts';
  import { TOP_BAR_CASES } from './topbar-cases.ts';

  type Props = { moments: Record<string, MomentValues> };
  let { moments }: Props = $props();

  /** The race the top bar cases are drawn on, and the feed it is on. */
  const BASE_MOMENT = 'raceSingaporeStart.grid';
  const FEED = feedId('gallery');
  /** The top bar is one line wide; the overlays are as wide as they are plus a margin. */
  const TOP_BAR_COLS = 140;
  const OVERLAY_MARGIN_COLS = 4;
  const OVERLAY_ROWS = 40;
  /** Wide enough for the longest value the inspector prints. */
  const INSPECTOR_COLS = 130;
  const theme = DEFAULT_THEME;

  /** The race moment with a realism-on session, so the realism segment has a setting to differ from. */
  const base = $derived.by((): MomentValues | undefined => {
    const race = moments[BASE_MOMENT];
    return race?.map((entry) => (entry.topic === 'session.info' ? { ...entry, value: { ...(entry.value as SessionInfo), realism: true } } : entry));
  });
  /** What every top bar case shares; a case's own overrides come first and so win. */
  const BASE_OVERRIDES: GalleryOverride[] = [
    { topic: 'ui.settings', value: { realismNextSession: true, keys: {} } },
    { topic: 'ui.alerts', value: { acknowledged: [], muted: [] } },
  ];

  const topBarStore = (name: keyof typeof TOP_BAR_CASES): TopicStore =>
    new TopicStore(
      new GalleryConnection(base ?? [], [...TOP_BAR_CASES[name], ...BASE_OVERRIDES], [{ feedId: FEED, kind: name === 'replay-transport' ? 'replay' : 'udp', label: 'gallery' }]),
    );
  const noop = (): void => {};

  // The commands the palette and the key overview list: the shell's own, with their default keys.
  const registry = new CommandRegistry();
  for (const command of defaultCommands({
    send: noop,
    sendReplay: noop,
    open: noop,
    workbookNames: () => [],
    groups: () => [],
    settings: () => ({ realismNextSession: true }),
    fontPx: () => theme.fontPx,
    setFontPx: noop,
    defaultFontPx: () => theme.fontPx,
    setTheme: noop,
    focusWindow: noop,
    alertKeys: () => [],
    inspection: new Inspection(),
  })) {
    registry.register(command);
  }
  // One ignored entry of `keys.json`, so the overview shows its warning.
  const keys = parseKeys({ 'Ctrl+W': 'close' }, new Set(registry.list().map((c) => c.id)), DEFAULT_KEYS);

  /** Types the palette's query as a user would. */
  const typeQuery = (query: string) => (stage: HTMLElement): void => {
    const input = stage.querySelector('input');
    if (input === null) return;
    input.value = query;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const widget = WIDGETS.find((w) => w.decl.name === INSPECTOR_WIDGET);
  // The gallery is static: the moments are fixed when it mounts.
  /* svelte-ignore state_referenced_locally */
  const inspected = moments[BASE_MOMENT] ?? [];
  const inspectorStore = new TopicStore(
    new GalleryConnection(inspected, [{ topic: 'dev.calcStats', value: [{ id: 'feed.status', lastMs: 0.08, meanMs: 0.07, runs: 1234, lastSessionTime: 0 }] }]),
  );
  const inspectorLink: ResolvedLink = { group: 1, feedId: FEED, primary: carId(0), compare: [], window: { kind: 'live' } };
  // The inspector prints the time of day of each topic's last update: the clock stands still until the cell has drawn.
  const unfreezeClock = freezeClock();
  onDestroy(unfreezeClock);
  const settleClock = async (): Promise<void> => {
    await afterFrames();
    unfreezeClock();
  };

  const stageCols = (kind: Cell['kind']): number =>
    (kind === 'topbar' ? TOP_BAR_COLS : kind === 'key-overview' ? OVERLAY_COLS.keys : kind === 'inspector' ? INSPECTOR_COLS : kind === 'palette' ? OVERLAY_COLS.palette : OVERLAY_COLS.narrow) + (kind === 'topbar' || kind === 'inspector' ? 0 : OVERLAY_MARGIN_COLS);
</script>

<div class="grid" use:snapOrigin>
  {#each SHELL_CELLS as cell (cell.id)}
    {#if cell.kind === 'topbar'}
      {#if base === undefined}
        <figure data-gallery-id={cell.id} data-ready style:color={role('warning')}>{cell.id}: {text.momentMissing}</figure>
      {:else}
        <ShellCell id={cell.id} {theme} cols={stageCols(cell.kind)}>
          <TopBar store={topBarStore(cell.detail as keyof typeof TOP_BAR_CASES)} feedId={FEED} send={noop} sendReplay={noop} />
        </ShellCell>
      {/if}
    {:else if cell.kind === 'palette'}
      <ShellCell id={cell.id} {theme} cols={stageCols(cell.kind)} overlay prepare={typeQuery(cell.detail ?? '')}>
        <Palette {registry} bindings={keys.bindings} />
      </ShellCell>
    {:else if cell.kind === 'key-overview'}
      <ShellCell id={cell.id} {theme} cols={stageCols(cell.kind)} rows={OVERLAY_ROWS} overlay>
        <KeyOverview {registry} bindings={keys.bindings} notes={keys.notes} onClose={noop} />
      </ShellCell>
    {:else if cell.kind === 'settings-popover'}
      {#if widget !== undefined}
        <ShellCell id={cell.id} {theme} cols={stageCols(cell.kind)} overlay>
          <SettingsPopover decl={widget.decl} options={{}} onChange={noop} linkGroup={1} onLinkGroup={noop} onClose={noop} anchor={{ x: 0, y: 0 }} />
        </ShellCell>
      {/if}
    {:else if cell.kind === 'inspector'}
      <ShellCell id={cell.id} {theme} cols={stageCols(cell.kind)} prepare={settleClock}>
        <Inspector store={inspectorStore} catalogue={INSPECTOR_CATALOGUE} widget={cell.detail ?? INSPECTOR_WIDGET} link={inspectorLink} host={{ openPath: noop }} />
      </ShellCell>
    {/if}
  {/each}
</div>

<style>
  .grid {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--pw-panel-gap);
  }
</style>
