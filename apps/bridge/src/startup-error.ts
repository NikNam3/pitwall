/** An expected, user-facing failure while starting the bridge; the CLI prints its message and exits 1. */
export class StartupError extends Error {
  override readonly name = 'StartupError';
}
