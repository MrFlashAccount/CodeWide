/** Owns icon reads for one view/navigation lifetime; delayed results cannot replace a newer icon. */
export class BrowserFaviconSession {
  #generation = 0;
  #page: { readonly target: number; readonly url: string } | null = null;
  readonly #read: (target: number, url: string) => Promise<string | null>;
  readonly #publish: (icon: string | null) => void;

  constructor(
    read: (target: number, url: string) => Promise<string | null>,
    publish: (icon: string | null) => void,
  ) {
    this.#read = read;
    this.#publish = publish;
  }

  /** Navigation or renderer disposal revokes pending reads and clears the previous page icon. */
  reset(): void {
    this.#generation += 1;
    this.#page = null;
    this.#publish(null);
  }

  /** Identifies the page whose completion may start an icon read. */
  started(target: number, url: string): void {
    this.reset();
    this.#page = { target, url };
  }

  /** Final native navigation also covers redirects and same-document history changes. */
  committed(target: number, url: string): void {
    if (this.#page?.target !== target) {
      return;
    }
    if (this.#page.url !== url) {
      this.started(target, url);
    }
    this.loaded(target, url);
  }

  /** Starts from a native page event, without effect-triggered loading or a separate network fetch. */
  loaded(target: number, url: string): void {
    if (this.#page?.target !== target || this.#page.url !== url) {
      return;
    }
    const generation = ++this.#generation;
    void this.#read(target, url)
      .then((icon) => {
        if (this.#generation === generation) {
          this.#publish(icon);
        }
      })
      .catch(() => {
        // Missing/disposed native views leave the neutral fallback; no page URLs or native errors are logged.
      });
  }
}
