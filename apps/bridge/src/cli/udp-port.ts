import { createSocket } from 'node:dgram';
import { StartupError } from '../startup-error.ts';

/** The startup problem behind a failed UDP bind: a busy port gets a plain message, anything else keeps its text. */
export function udpPortError(port: number, error: unknown): StartupError {
  if ((error as NodeJS.ErrnoException | undefined)?.code === 'EADDRINUSE') return new StartupError(`UDP port ${port} is already in use`);
  return new StartupError(`cannot listen on UDP port ${port}: ${error instanceof Error ? error.message : String(error)}`);
}

/** Binds and closes a UDP socket on `port`; throws a `StartupError` if that is impossible. */
export async function assertUdpPortFree(port: number): Promise<void> {
  const socket = createSocket('udp4');
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(port, resolve);
    });
  } catch (error) {
    throw udpPortError(port, error);
  } finally {
    await new Promise<void>((resolve) => {
      try {
        socket.close(resolve);
      } catch {
        resolve(); // the failed bind already closed it
      }
    });
  }
}
