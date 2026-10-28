// The inspector's switch (spec 8.2). The command `dev.inspect` (Ctrl+I) calls `toggle`; a click on a panel calls `open`
// with its widget name while inspection is on; the inspector's close button calls `close`.

/** Whether inspection is on and which widget is being inspected. */
export class Inspection {
  #on = $state(false);
  #widget = $state<string | undefined>(undefined);

  /** True while a click on a panel should open the inspector. */
  get on(): boolean {
    return this.#on;
  }
  /** The widget being inspected, if any. */
  get widget(): string | undefined {
    return this.#widget;
  }
  /** Switches inspection on or off; off also closes the inspector. */
  toggle(): void {
    this.#on = !this.#on;
    if (!this.#on) this.#widget = undefined;
  }
  /** Inspects `widget`; does nothing while inspection is off. */
  open(widget: string): void {
    if (this.#on) this.#widget = widget;
  }
  /** Closes the inspector; inspection stays on. */
  close(): void {
    this.#widget = undefined;
  }
}
