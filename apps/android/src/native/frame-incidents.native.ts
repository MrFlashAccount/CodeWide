import { AppState } from "react-native";

import {
  hasFrameContext,
  publishFrameIncidents,
  recordJsSchedulingDelay,
} from "../data/ui-frame-telemetry";

interface FrameIncidentReader {
  drainFrameIncidents: () => Promise<unknown>;
}

/** One foreground poll; native collection keeps running while JS is blocked. */
export function startFrameIncidentReporting(reader: FrameIncidentReader): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pollTask: Promise<void> | null = null;
  let active = AppState.currentState === "active";
  let expectedAt = 0;
  function finishPoll() {
    pollTask = null;
    schedule(2000);
  }
  function schedule(delayMs: number) {
    if (!active || pollTask !== null || timer !== null) {
      return;
    }
    expectedAt = performance.now() + delayMs;
    timer = setTimeout(() => {
      pollTask = poll().then(
        () => {
          finishPoll();
        },
        () => {
          finishPoll();
        },
      );
    }, delayMs);
  }
  async function poll() {
    timer = null;
    if (!active) {
      return;
    }
    recordJsSchedulingDelay(performance.now() - expectedAt);
    try {
      if (hasFrameContext()) {
        publishFrameIncidents(await reader.drainFrameIncidents());
      }
    } catch {
      // Diagnostics must not interrupt the application; retry on the next poll.
    }
  }
  AppState.addEventListener("change", (state) => {
    active = state === "active";
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = null;
    if (active) {
      schedule(0);
    }
  });
  schedule(0);
}
