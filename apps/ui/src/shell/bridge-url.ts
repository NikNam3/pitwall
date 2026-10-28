// Where the bridge listens (spec 6.1): Electron passes the port as `?ws=`; otherwise the build's default applies.

/** Set by Vite's `define` (vite.config.ts) from `PITWALL_WS_PORT`; absent where no define runs, such as under Vitest. */
declare const __PITWALL_WS_PORT__: string | undefined;

/** The bridge's default port (`PITWALL_WS_PORT`'s default), when neither the URL nor the build names one. */
const DEFAULT_WS_PORT = '4777';

/** The port the build was made for. */
const buildPort = (): string => (typeof __PITWALL_WS_PORT__ === 'undefined' ? DEFAULT_WS_PORT : __PITWALL_WS_PORT__);

/** The bridge's WebSocket URL for a page whose query string is `search`. */
export function bridgeUrl(search: string): string {
  const port = new URLSearchParams(search).get('ws') ?? buildPort();
  return `ws://127.0.0.1:${port}`;
}
