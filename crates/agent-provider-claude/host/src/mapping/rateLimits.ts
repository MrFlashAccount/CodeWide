/**
 * Claude subscription usage limits as `ProviderRateLimits`.
 *
 * Two SDK sources describe the same windows by the same ids:
 *
 * - `rate_limit_event` (streamed during a turn) names one window at a time
 *   (`rateLimitType`) with a 0–1 `utilization` fraction, an epoch-seconds
 *   `resetsAt` and a status;
 * - the experimental usage read of the runtime probe reports several windows
 *   at once as 0–100 percentages with ISO reset times.
 *
 * `RateLimitBook` owns the merged snapshot the host reports to the companion
 * (`rateLimits.updated`). Pure; no I/O.
 */

import type {
  ProviderRateLimits,
  ProviderRateLimitWindow,
  RateLimitWindowKind,
  RateLimitWindowStatus,
} from "../protocol.js";

const SESSION_MINUTES = 300;
const WEEK_MINUTES = 10_080;
const MAX_PERCENT = 100;
const MS_PER_SECOND = 1000;
const MAX_WINDOW_ID_LENGTH = 64;
const WINDOW_ID = /^[a-z0-9_]+$/u;

interface WindowShape {
  readonly durationMins: number | null;
  readonly kind: RateLimitWindowKind;
  readonly label: string;
}

/** The windows Claude names today; another id is kept as an `other` window. */
const KNOWN_WINDOWS: ReadonlyMap<string, WindowShape> = new Map<string, WindowShape>([
  ["five_hour", { durationMins: SESSION_MINUTES, kind: "session", label: "Session" }],
  ["seven_day", { durationMins: WEEK_MINUTES, kind: "weekly", label: "Weekly" }],
  ["seven_day_opus", { durationMins: WEEK_MINUTES, kind: "weekly", label: "Weekly · Opus" }],
  ["seven_day_sonnet", { durationMins: WEEK_MINUTES, kind: "weekly", label: "Weekly · Sonnet" }],
  [
    "seven_day_overage_included",
    { durationMins: WEEK_MINUTES, kind: "weekly", label: "Weekly · Included models" },
  ],
  ["overage", { durationMins: null, kind: "other", label: "Extra usage" }],
]);

/** The usage-read windows mapped from the probe. */
const USAGE_READ_WINDOWS = ["five_hour", "seven_day", "seven_day_opus", "seven_day_sonnet"];

const STATUSES: ReadonlyMap<unknown, RateLimitWindowStatus> = new Map<
  unknown,
  RateLimitWindowStatus
>([
  ["allowed", "allowed"],
  ["allowed_warning", "warning"],
  ["rejected", "rejected"],
]);

const KIND_ORDER: readonly RateLimitWindowKind[] = ["session", "weekly", "other"];

type JsonRecord = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const percent = (value: number): number => Math.min(MAX_PERCENT, Math.max(0, Math.round(value)));

const epochSeconds = (value: unknown): number | null => {
  const seconds = finite(value);
  return seconds === null || seconds <= 0 ? null : Math.floor(seconds);
};

const isoSeconds = (value: unknown): number | null => {
  if (typeof value !== "string") {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / MS_PER_SECOND) : null;
};

function windowShape(id: string): WindowShape {
  return KNOWN_WINDOWS.get(id) ?? { durationMins: null, kind: "other", label: id };
}

function windowOf(
  id: string,
  figures: Pick<ProviderRateLimitWindow, "resetsAt" | "status" | "usedPercent">,
): ProviderRateLimitWindow {
  const shape = windowShape(id);
  return {
    id,
    kind: shape.kind,
    label: shape.label,
    resetsAt: figures.resetsAt,
    status: figures.status,
    usedPercent: figures.usedPercent,
    windowDurationMins: shape.durationMins,
  };
}

/**
 * The window one `rate_limit_event`'s `rate_limit_info` reports; `null` when
 * it names no usable window or carries no figure at all.
 */
export function rateLimitEventWindow(info: unknown): ProviderRateLimitWindow | null {
  if (!isRecord(info)) {
    return null;
  }
  const id = windowId(info["rateLimitType"]);
  const figures = eventFigures(info);
  if (id === null || figures === null) {
    return null;
  }
  return windowOf(id, figures);
}

function windowId(value: unknown): string | null {
  return typeof value === "string" && value.length <= MAX_WINDOW_ID_LENGTH && WINDOW_ID.test(value)
    ? value
    : null;
}

/** The figures of one event; `null` when it carries none. */
function eventFigures(
  info: JsonRecord,
): Pick<ProviderRateLimitWindow, "resetsAt" | "status" | "usedPercent"> | null {
  const utilization = finite(info["utilization"]);
  const figures = {
    resetsAt: epochSeconds(info["resetsAt"]),
    status: STATUSES.get(info["status"]) ?? null,
    // The streamed utilization is a 0–1 fraction.
    usedPercent: utilization === null ? null : percent(utilization * MAX_PERCENT),
  };
  return figures.resetsAt === null && figures.status === null && figures.usedPercent === null
    ? null
    : figures;
}

/**
 * The windows of the SDK's experimental usage read (`rate_limits` with 0–100
 * `utilization` and ISO `resets_at` per window). Empty for any other shape,
 * including a session where plan limits do not apply.
 */
export function usageReadWindows(response: unknown): readonly ProviderRateLimitWindow[] {
  if (!isRecord(response) || response["rate_limits_available"] !== true) {
    return [];
  }
  const limits = response["rate_limits"];
  if (!isRecord(limits)) {
    return [];
  }
  return USAGE_READ_WINDOWS.flatMap((id) => {
    const window = limits[id];
    const utilization = isRecord(window) ? finite(window["utilization"]) : null;
    if (!isRecord(window) || utilization === null) {
      return [];
    }
    return [
      windowOf(id, {
        resetsAt: isoSeconds(window["resets_at"]),
        status: null,
        usedPercent: percent(utilization),
      }),
    ];
  });
}

/**
 * A later report replaces the figures it carries. A missing percentage keeps
 * the earlier one unless the window reset in between.
 */
function merged(
  previous: ProviderRateLimitWindow | undefined,
  next: ProviderRateLimitWindow,
): ProviderRateLimitWindow {
  if (previous === undefined) {
    return next;
  }
  const reset =
    next.resetsAt !== null && previous.resetsAt !== null && next.resetsAt !== previous.resetsAt;
  return {
    ...next,
    resetsAt: next.resetsAt ?? previous.resetsAt,
    status: next.status ?? previous.status,
    usedPercent: next.usedPercent ?? (reset ? null : previous.usedPercent),
  };
}

const sameWindow = (left: ProviderRateLimitWindow, right: ProviderRateLimitWindow): boolean =>
  left.id === right.id &&
  left.kind === right.kind &&
  left.label === right.label &&
  left.resetsAt === right.resetsAt &&
  left.status === right.status &&
  left.usedPercent === right.usedPercent &&
  left.windowDurationMins === right.windowDurationMins;

const windowOrder = (left: ProviderRateLimitWindow, right: ProviderRateLimitWindow): number => {
  const byKind = KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind);
  return byKind === 0 ? left.id.localeCompare(right.id) : byKind;
};

/** The provider's merged limit snapshot; windows are merged by id. */
export class RateLimitBook {
  private readonly windows = new Map<string, ProviderRateLimitWindow>();
  private current: ProviderRateLimits | null = null;

  /** The latest snapshot; `null` until the first report. */
  public snapshot(): ProviderRateLimits | null {
    return this.current;
  }

  /**
   * Merges reported windows. Returns the new full snapshot, or `null` when
   * nothing changed (nothing to report).
   */
  public apply(
    reported: readonly ProviderRateLimitWindow[],
    nowSeconds: number,
  ): ProviderRateLimits | null {
    let changed = false;
    for (const next of reported) {
      const previous = this.windows.get(next.id);
      const window = merged(previous, next);
      if (previous === undefined || !sameWindow(previous, window)) {
        this.windows.set(window.id, window);
        changed = true;
      }
    }
    if (!changed) {
      return null;
    }
    this.current = {
      updatedAt: nowSeconds,
      windows: [...this.windows.values()].sort(windowOrder),
    };
    return this.current;
  }
}
