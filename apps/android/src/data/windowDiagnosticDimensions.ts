import { Dimensions, type ScaledSize } from "react-native";

const HISTORY_CAPACITY = 160;
const REPORT_INDENT = 2;

interface WindowDimensionMetrics {
  readonly fontScale: number;
  readonly height: number;
  readonly scale: number;
  readonly width: number;
}

interface WindowDimensionSample {
  readonly screen: WindowDimensionMetrics;
  readonly unixMs: number;
  readonly window: WindowDimensionMetrics;
}

function metricSnapshot(metrics: ScaledSize): WindowDimensionMetrics {
  // Capture a value snapshot: RN can publish different metrics while the report is retained.
  return {
    fontScale: metrics.fontScale,
    height: metrics.height,
    scale: metrics.scale,
    width: metrics.width,
  };
}

/** Retains JS viewport changes independently of settings visibility, with bounded memory. */
export class WindowDiagnosticDimensions {
  #samples: WindowDimensionSample[] = [];
  #droppedSamples = 0;
  #subscription: { remove: () => void } | null = null;

  start(): void {
    if (this.#subscription !== null) {
      return;
    }
    this.#samples = [];
    this.#droppedSamples = 0;
    this.#capture();
    this.#subscription = Dimensions.addEventListener("change", () => {
      this.#capture();
    });
  }

  stop(): void {
    if (this.#subscription === null) {
      return;
    }
    this.#capture();
    this.#subscription.remove();
    this.#subscription = null;
  }

  report(): string {
    return JSON.stringify(
      { droppedSamples: this.#droppedSamples, samples: this.#samples },
      null,
      REPORT_INDENT,
    );
  }

  #capture(): void {
    if (this.#samples.length === HISTORY_CAPACITY) {
      this.#samples.shift();
      this.#droppedSamples += 1;
    }
    this.#samples.push({
      screen: metricSnapshot(Dimensions.get("screen")),
      unixMs: Date.now(),
      window: metricSnapshot(Dimensions.get("window")),
    });
  }
}
