import { StartupError } from './startup-error.ts';

export type Config = {
  wsPort: number;
  udpPort: number;
  /** The IPv4 address the UDP socket binds: every interface (`0.0.0.0`) by default, or one, e.g. a VPN's. */
  udpHost: string;
  uiPort: number;
};

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

/** An IPv4 address in dotted-quad form from `env[name]`, or `fallback` when unset (the source is a `udp4` socket). */
function ipv4From(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const raw = env[name];
  if (raw === undefined) return fallback;
  const octets = raw.split('.');
  if (octets.length !== 4 || !octets.every((o) => /^\d{1,3}$/.test(o) && Number(o) <= 255)) {
    throw new StartupError(`${name} must be an IPv4 address like 10.66.0.2, got "${raw}"`);
  }
  return raw;
}

/** The bridge's ports and UDP bind address, from `PITWALL_WS_PORT`, `PITWALL_UDP_PORT`, `PITWALL_UDP_HOST` and `PITWALL_UI_PORT`. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    wsPort: portFrom(env, 'PITWALL_WS_PORT', 4777),
    udpPort: portFrom(env, 'PITWALL_UDP_PORT', 20_777),
    udpHost: ipv4From(env, 'PITWALL_UDP_HOST', '0.0.0.0'),
    uiPort: portFrom(env, 'PITWALL_UI_PORT', 5173),
  };
}
