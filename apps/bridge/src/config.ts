import { StartupError } from './startup-error.ts';

export type Config = { wsPort: number; udpPort: number; uiPort: number };

const MAX_PORT = 65_535;

/** A port from `env[name]`, or `fallback` when unset. Throws `StartupError` for anything but an integer 0-65535. */
function portFrom(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) > MAX_PORT) {
    throw new StartupError(`${name} must be an integer 0-${MAX_PORT}, got "${raw}"`);
  }
  return Number(raw);
}

/** The bridge's ports, from `PITWALL_WS_PORT`, `PITWALL_UDP_PORT` and `PITWALL_UI_PORT`. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    wsPort: portFrom(env, 'PITWALL_WS_PORT', 4777),
    udpPort: portFrom(env, 'PITWALL_UDP_PORT', 20_777),
    uiPort: portFrom(env, 'PITWALL_UI_PORT', 5173),
  };
}
