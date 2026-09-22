type CatalogDiagnosticEvent =
  | {
      readonly catalog: "missing-route" | "missing-descriptor" | "present";
      readonly desktop: boolean;
      readonly focused: boolean;
      readonly type: "navigation";
      readonly viewportWidth: number;
    }
  | {
      readonly height: number;
      readonly surface: "pane" | "content";
      readonly type: "layout";
      readonly width: number;
    }
  | {
      readonly state: "list" | "search" | "unmounted";
      readonly type: "content";
    };

const HISTORY_CAPACITY = 80;
const REPORT_INDENT = 2;

type CatalogDiagnosticSample = {
  readonly event: CatalogDiagnosticEvent;
  readonly unixMs: number;
};
type CatalogDiagnosticChannel = "content" | "layout:content" | "layout:pane" | "navigation";

/** Bounded, process-local rendering evidence; never accepts route parameters or chat content. */
class WorkspaceCatalogDiagnostics {
  readonly #latest = new Map<CatalogDiagnosticChannel, CatalogDiagnosticSample>();
  readonly #samples: CatalogDiagnosticSample[] = [];
  #droppedSamples = 0;

  record(event: CatalogDiagnosticEvent): void {
    if (this.#samples.length === HISTORY_CAPACITY) {
      this.#samples.shift();
      this.#droppedSamples += 1;
    }
    const sample = { event, unixMs: Date.now() };
    const channel = event.type === "layout" ? (`layout:${event.surface}` as const) : event.type;
    this.#latest.set(channel, sample);
    this.#samples.push(sample);
  }

  report(): string {
    return JSON.stringify(
      {
        droppedSamples: this.#droppedSamples,
        // Materialize the Map only at the clipboard JSON serialization boundary.
        latest: Object.fromEntries(this.#latest),
        samples: this.#samples,
      },
      null,
      REPORT_INDENT,
    );
  }
}

/** Retains evidence across navigation to Settings, without persistence or automatic upload. */
export const workspaceCatalogDiagnostics = new WorkspaceCatalogDiagnostics();
