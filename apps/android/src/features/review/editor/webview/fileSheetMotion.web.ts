/** Sheet detents as fractions of the WebView height, including after a keyboard resize. */
export const SHORT_SHEET = 0.6;
export const TALL_SHEET = 0.94;
export type SheetStop = 0 | typeof SHORT_SHEET | typeof TALL_SHEET;

const PERCENT = 100;
const MS_PER_SECOND = 1000;
const SAMPLES_PER_SECOND = 60;
const SPRING_FREQUENCY = 22;
const REST_DISTANCE = 0.0005;
const REST_SPEED = 0.01;

function transform(shown: number): string {
  const fraction = Math.max(0, Math.min(1, shown / TALL_SHEET));
  return `translateY(${String((1 - fraction) * PERCENT)}%)`;
}

function opacity(shown: number): number {
  return Math.max(0, Math.min(1, shown / SHORT_SHEET));
}

type SpringPoint = { readonly shown: number; readonly velocity: number };

/** Exact critically damped trajectory, also sampled when a finger interrupts a flight. */
function spring(start: number, stop: number, velocity: number): (seconds: number) => SpringPoint {
  const displacement = start - stop;
  const slope = velocity + SPRING_FREQUENCY * displacement;
  return (seconds) => {
    const decay = Math.exp(-SPRING_FREQUENCY * seconds);
    return {
      shown: stop + (displacement + slope * seconds) * decay,
      velocity: (velocity - SPRING_FREQUENCY * slope * seconds) * decay,
    };
  };
}

function resting(point: SpringPoint, stop: number): boolean {
  return (
    (stop === 0 && point.shown <= 0) ||
    (Math.abs(point.shown - stop) < REST_DISTANCE && Math.abs(point.velocity) < REST_SPEED)
  );
}

type Flight = {
  readonly animation: Animation;
  readonly backdrop: Animation;
  readonly sample: (seconds: number) => SpringPoint;
};

/** Transform and backdrop play on the compositor. Only a settled detent resizes the tree. */
export class FileSheetMotion {
  private flight: Flight | null = null;
  private shown = 0;
  private readonly reduced = matchMedia("(prefers-reduced-motion: reduce)");
  private readonly panel: HTMLDialogElement;
  stop: SheetStop = 0;

  constructor(panel: HTMLDialogElement) {
    this.panel = panel;
    this.reduced.addEventListener("change", () => {
      if (this.reduced.matches) {
        this.flight?.animation.finish();
      }
    });
  }

  /** Take over the live position without jumping to the previous detent. */
  grab(): number {
    this.interrupt();
    return this.shown;
  }

  drag(shown: number): void {
    this.shown = Math.max(0, Math.min(TALL_SHEET, shown));
    this.panel.style.height = String(TALL_SHEET * PERCENT) + "%";
    this.panel.style.transform = transform(this.shown);
    this.panel.style.setProperty("--sheet-scrim-opacity", String(opacity(this.shown)));
  }

  settle(stop: SheetStop, velocity?: number): void {
    const incoming = this.interrupt();
    this.stop = stop;
    const sample = spring(this.shown, stop, velocity ?? incoming);
    let point = sample(0);
    if (this.reduced.matches || resting(point, stop)) {
      this.finish();
      return;
    }
    this.drag(this.shown);
    const positions: string[] = [];
    const alphas: number[] = [];
    while (!resting(point, stop)) {
      positions.push(transform(point.shown));
      alphas.push(opacity(point.shown));
      point = sample(positions.length / SAMPLES_PER_SECOND);
    }
    const duration = (positions.length * MS_PER_SECOND) / SAMPLES_PER_SECOND;
    positions.push(transform(stop));
    alphas.push(opacity(stop));
    const timing = { duration, fill: "both" } as const;
    const animation = this.panel.animate({ transform: positions }, timing);
    const backdrop = this.panel.animate(
      { opacity: alphas },
      { ...timing, pseudoElement: "::backdrop" },
    );
    this.flight = { animation, backdrop, sample };
    animation.onfinish = () => {
      this.finish();
    };
  }

  private interrupt(): number {
    if (this.flight === null) {
      return 0;
    }
    const time = this.flight.animation.currentTime;
    const point = this.flight.sample(typeof time === "number" ? time / MS_PER_SECOND : 0);
    this.cancel();
    this.drag(point.shown);
    return point.velocity;
  }

  private cancel(): void {
    if (this.flight !== null) {
      this.flight.animation.onfinish = null;
      this.flight.animation.cancel();
      this.flight.backdrop.cancel();
      this.flight = null;
    }
  }

  private finish(): void {
    this.cancel();
    this.shown = this.stop;
    if (this.stop === 0) {
      this.panel.close();
      this.panel.style.removeProperty("height");
    } else {
      this.panel.style.height = String(this.stop * PERCENT) + "%";
    }
    this.panel.style.removeProperty("transform");
    this.panel.style.removeProperty("--sheet-scrim-opacity");
  }

  /** Leave modal presentation immediately when switching to the sidebar. */
  reset(): void {
    this.stop = 0;
    this.finish();
  }
}
