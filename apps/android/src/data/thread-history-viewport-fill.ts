type Direction = "older" | "newer";

type ViewportFillCapabilities = {
  afterLayout: () => Promise<void>;
  isCurrent: () => boolean;
  loadPage: (direction: Direction) => Promise<boolean>;
};

// Invisible/filtered turns must not turn one layout event into an unbounded
// history download. Another explicit edge gesture renews this allowance.
const MAX_PAGES_PER_VIEWPORT_INTENT = 4;

/** Owns bounded page continuation while measured content cannot fill its viewport.
 * It never moves the scroll position; the list retains its visible-item anchor. */
export class ThreadHistoryViewportFill {
  private viewportHeight = 0;
  private contentHeight = 0;
  private direction: Direction = "older";
  private generation = 0;
  private remaining = MAX_PAGES_PER_VIEWPORT_INTENT;
  private pending: { generation: number; promise: Promise<void> } | null = null;

  private readonly capabilities: ViewportFillCapabilities;

  constructor(capabilities: ViewportFillCapabilities) {
    this.capabilities = capabilities;
  }

  async reportViewport(viewportHeight: number, contentHeight: number): Promise<void> {
    if (!Number.isFinite(viewportHeight) || !Number.isFinite(contentHeight)) {
      return;
    }
    if (viewportHeight !== this.viewportHeight) {
      this.remaining = MAX_PAGES_PER_VIEWPORT_INTENT;
    }
    this.viewportHeight = viewportHeight;
    this.contentHeight = contentHeight;
    return this.run(false);
  }

  /** An explicit edge intent permits one page even when the viewport is full. */
  async load(direction: Direction): Promise<void> {
    if (this.pending?.generation === this.generation && this.direction === direction) {
      return this.pending.promise;
    }
    this.cancel();
    this.direction = direction;
    this.remaining = MAX_PAGES_PER_VIEWPORT_INTENT;
    return this.run(true);
  }

  cancel(): void {
    this.generation += 1;
    this.remaining = 0;
  }

  private async run(forceFirstPage: boolean): Promise<void> {
    if (this.pending?.generation === this.generation) {
      return this.pending.promise;
    }
    if (
      !forceFirstPage &&
      (this.remaining === 0 ||
        this.viewportHeight <= 0 ||
        this.contentHeight <= 0 ||
        this.contentHeight >= this.viewportHeight)
    ) {
      return;
    }
    const generation = this.generation;
    const direction = this.direction;
    const operation = Promise.resolve()
      .then(async () => {
        await this.fill(generation, direction, forceFirstPage);
      })
      .finally(() => {
        if (this.pending?.promise === operation) {
          this.pending = null;
        }
      });
    this.pending = { generation, promise: operation };
    return operation;
  }

  private async fill(
    generation: number,
    direction: Direction,
    forceFirstPage: boolean,
  ): Promise<void> {
    try {
      while (
        generation === this.generation &&
        this.capabilities.isCurrent() &&
        this.remaining > 0
      ) {
        const needsContent =
          this.viewportHeight > 0 &&
          this.contentHeight > 0 &&
          this.contentHeight < this.viewportHeight;
        if (!forceFirstPage && !needsContent) {
          return;
        }
        forceFirstPage = false;
        this.remaining -= 1;
        const progressed = await this.capabilities.loadPage(direction);
        if (generation !== this.generation) {
          return;
        }
        if (!progressed) {
          this.remaining = 0;
          return;
        }
        // Let committed native measurements replace the previous page's height
        // before deciding whether another page is necessary.
        await this.capabilities.afterLayout();
      }
    } catch (error) {
      if (generation === this.generation) {
        this.remaining = 0;
      }
      throw error;
    }
  }
}
