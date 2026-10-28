// The open overlays of a window (shell overlays and panel popovers), so Escape closes the newest one first.
import { getContext, setContext } from 'svelte';

const KEY = Symbol('overlay-stack');

/** Closers of the open overlays, oldest first. */
export class OverlayStack {
  readonly #closers: Array<() => void> = [];

  /** Notes an open overlay; returns the function to call when it closed on its own. */
  add(close: () => void): () => void {
    this.#closers.push(close);
    return () => {
      const at = this.#closers.indexOf(close);
      if (at >= 0) this.#closers.splice(at, 1);
    };
  }

  /** Closes the newest open overlay; false when none is open. */
  closeTop(): boolean {
    const close = this.#closers.at(-1);
    if (close === undefined) return false;
    close();
    return true;
  }
}

/** Provides the window's stack to the panels below. */
export const provideOverlayStack = (stack: OverlayStack): void => {
  setContext(KEY, stack);
};

/** The window's stack; undefined outside a window. */
export const useOverlayStack = (): OverlayStack | undefined => getContext<OverlayStack | undefined>(KEY);
