import { recordOperationalTelemetryEvent } from "./telemetry";

const HISTORY_CAPACITY = 512;
const UPLOAD_INTERVAL_MS = 1000;
const UPLOAD_BUDGET = 12;
const INCIDENT_UPLOAD_BUDGET = 2;
const INCIDENT_CONTEXT_SIZE = 32;

/** One content-free event shared by the local report and existing telemetry transport. */
type TimelineScrollLog = {
  readonly connectionId: string | null;
  readonly name: string;
  readonly requestId: string;
  readonly tags: Readonly<Record<string, string>>;
  readonly threadId: string | null;
  readonly values: Readonly<Record<string, number>>;
};

type TimelineScrollSample = TimelineScrollLog & {
  readonly sequence: number;
  readonly unixMs: number;
};

type TimelineScrollReport = {
  readonly capacity: number;
  readonly evictedEvents: number;
  readonly lastRebound: readonly TimelineScrollSample[];
  readonly samples: readonly TimelineScrollSample[];
  readonly suppressedUploads: number;
  readonly version: number;
};

/** Bounded process-local evidence survives navigation to Settings, including with the HUD off. */
export class TimelineScrollJournal {
  readonly #samples: TimelineScrollSample[] = [];
  #lastRebound: readonly TimelineScrollSample[] = [];
  #sequence = 0;
  #evictedEvents = 0;
  #suppressedUploads = 0;
  #uploadWindowAt = 0;
  #uploadsInWindow = 0;
  #incidentUploadsInWindow = 0;

  /** Stores an immutable event and optionally sends it within the shared upload budget. */
  record(event: TimelineScrollLog, upload: boolean): void {
    const unixMs = Date.now();
    this.#sequence += 1;
    if (this.#samples.length === HISTORY_CAPACITY) {
      this.#samples.shift();
      this.#evictedEvents += 1;
    }
    this.#samples.push({ ...event, sequence: this.#sequence, unixMs });
    const incident = event.name === "chat.scroll.rebound";
    if (incident) {
      // Capture a causal window before subsequent scrolling can evict it from the live journal.
      this.#lastRebound = this.#samples.slice(-INCIDENT_CONTEXT_SIZE);
    }
    if (!upload || event.connectionId === null || event.threadId === null) {
      return;
    }
    if (!this.#admitUpload(incident, unixMs)) {
      return;
    }
    recordOperationalTelemetryEvent(event.connectionId, {
      name: event.name,
      requestId: event.requestId,
      tags: event.tags,
      threadId: event.threadId,
      values: { ...event.values, sequence: this.#sequence },
    });
  }

  #admitUpload(incident: boolean, unixMs: number): boolean {
    if (unixMs - this.#uploadWindowAt >= UPLOAD_INTERVAL_MS) {
      this.#uploadWindowAt = unixMs;
      this.#uploadsInWindow = 0;
      this.#incidentUploadsInWindow = 0;
    }
    const budgetAvailable = incident
      ? this.#incidentUploadsInWindow < INCIDENT_UPLOAD_BUDGET
      : this.#uploadsInWindow < UPLOAD_BUDGET;
    if (!budgetAvailable) {
      this.#suppressedUploads += 1;
      return false;
    }
    if (incident) {
      this.#incidentUploadsInWindow += 1;
    } else {
      this.#uploadsInWindow += 1;
    }
    return true;
  }

  /** Captures one consistent report; the array copy isolates subsequent recorder appends. */
  snapshot(): TimelineScrollReport {
    return {
      capacity: HISTORY_CAPACITY,
      evictedEvents: this.#evictedEvents,
      lastRebound: this.#lastRebound,
      samples: this.#samples.slice(),
      suppressedUploads: this.#suppressedUploads,
      version: 1,
    };
  }
}

/** Shared report retention is independent of any mounted conversation or settings screen. */
export const timelineScrollJournal = new TimelineScrollJournal();
