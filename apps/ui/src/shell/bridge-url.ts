// Where the bridge listens (spec 6.1): Electron passes the port as `?ws=`; otherwise the build's default applies.

/** Set by Vite's `define` from `PITWALL_WS_PORT` at build time. */
declare const __PITWALL_WS_PORT__: string;

/** The bridge's WebSocket URL for a page whose query string is `search`. */
export function bridgeUrl(search: string): string {
  const port = new URLSearchParams(search).get('ws') ?? __PITWALL_WS_PORT__;
  return `ws://127.0.0.1:${port}`;
}
