export type TelemetryEventInput = {
  name: string;
  sessionId?: string;
  requestId?: string;
  connectionId?: string;
  threadId?: string;
  turnId?: string;
  itemId?: string;
  values?: Record<string, number>;
  tags?: Record<string, string>;
};

type TelemetryEvent = TelemetryEventInput & {
  eventId: string;
  occurredAtUnixMs: number;
};

export type TelemetryBatch = {
  version: 1;
  batchId: string;
  sentAtUnixMs: number;
  clientSessionId: string;
  appVersion?: string;
  events: TelemetryEvent[];
};

type TelemetryTransport = (connectionId: string, batch: TelemetryBatch) => Promise<void>;

const MAX_QUEUE_EVENTS = 2_048;
const MAX_BATCH_EVENTS = 64;
const FLUSH_INTERVAL_MS = 1_000;
const MAX_RETRY_MS = 30_000;
const clientSessionId = `client-${createId()}`;
const queues = new Map<string, TelemetryEvent[]>();
const retryAttempts = new Map<string, number>();
const inFlight = new Set<string>();
let enabled = false;
let transport: TelemetryTransport | null = null;
let appVersion: string | undefined;
let flushTimer: ReturnType<typeof setTimeout> | undefined;

export function configureTelemetryTransport(next: TelemetryTransport | null): void {
  transport = next;
  if (next !== null && enabled && queues.size > 0) scheduleFlush(0);
}

export function configureTelemetryAppVersion(next: string | null | undefined): void {
  appVersion = typeof next === "string" && next.length > 0 && next.length <= 128 ? next : undefined;
}

export function setTelemetryEnabled(next: boolean): void {
  enabled = next;
  if (!next) {
    queues.clear();
    retryAttempts.clear();
    if (flushTimer !== undefined) clearTimeout(flushTimer);
    flushTimer = undefined;
  }
}

export function recordTelemetryEvent(connectionId: string, input: TelemetryEventInput): void {
  if (!enabled || !validIdentifier(connectionId) || !validName(input.name)) return;
  const event = sanitizeEvent(input);
  if (event === null) return;
  const queue = queues.get(connectionId) ?? [];
  queue.push({
    ...event,
    connectionId,
    eventId: `event-${createId()}`,
    occurredAtUnixMs: Date.now(),
  });
  if (queue.length > MAX_QUEUE_EVENTS) queue.splice(0, queue.length - MAX_QUEUE_EVENTS);
  queues.set(connectionId, queue);
  scheduleFlush(queue.length >= MAX_BATCH_EVENTS ? 0 : FLUSH_INTERVAL_MS);
}

export async function flushTelemetry(): Promise<void> {
  if (!enabled || transport === null) return;
  const connections = [...queues.keys()].filter((connectionId) => !inFlight.has(connectionId));
  await Promise.all(connections.map(flushConnection));
}

async function flushConnection(connectionId: string): Promise<void> {
  if (!enabled || transport === null || inFlight.has(connectionId)) return;
  const queue = queues.get(connectionId);
  if (queue === undefined || queue.length === 0) return;
  const events = queue.splice(0, MAX_BATCH_EVENTS);
  if (queue.length === 0) queues.delete(connectionId);
  const batch: TelemetryBatch = {
    version: 1,
    batchId: `batch-${createId()}`,
    sentAtUnixMs: Date.now(),
    clientSessionId,
    ...(appVersion === undefined ? {} : { appVersion }),
    events,
  };
  inFlight.add(connectionId);
  try {
    await transport(connectionId, batch);
    retryAttempts.delete(connectionId);
    if ((queues.get(connectionId)?.length ?? 0) > 0) scheduleFlush(0);
  } catch {
    const current = queues.get(connectionId) ?? [];
    current.unshift(...events);
    if (current.length > MAX_QUEUE_EVENTS) current.splice(MAX_QUEUE_EVENTS);
    queues.set(connectionId, current);
    const attempt = (retryAttempts.get(connectionId) ?? 0) + 1;
    retryAttempts.set(connectionId, attempt);
    scheduleFlush(Math.min(MAX_RETRY_MS, FLUSH_INTERVAL_MS * 2 ** Math.min(attempt - 1, 5)));
  } finally {
    inFlight.delete(connectionId);
  }
}

function scheduleFlush(delayMs: number): void {
  if (!enabled || transport === null) return;
  if (flushTimer !== undefined) {
    if (delayMs !== 0) return;
    clearTimeout(flushTimer);
  }
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    void flushTelemetry();
  }, delayMs);
}

function sanitizeEvent(input: TelemetryEventInput): TelemetryEventInput | null {
  const dimensions: Pick<TelemetryEventInput, "sessionId" | "requestId" | "connectionId" | "threadId" | "turnId" | "itemId"> = {};
  for (const key of ["sessionId", "requestId", "connectionId", "threadId", "turnId", "itemId"] as const) {
    const value = input[key];
    if (value !== undefined) {
      if (!validIdentifier(value)) return null;
      dimensions[key] = value;
    }
  }
  const values: Record<string, number> = {};
  for (const [name, value] of Object.entries(input.values ?? {}).slice(0, 32)) {
    if (safeAttributeName(name) && Number.isFinite(value)) values[name] = Math.max(-Number.MAX_SAFE_INTEGER, Math.min(Number.MAX_SAFE_INTEGER, value));
  }
  const tags: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.tags ?? {}).slice(0, 32)) {
    if (safeAttributeName(name) && validIdentifier(value)) tags[name] = value;
  }
  return {
    name: input.name,
    ...dimensions,
    ...(Object.keys(values).length === 0 ? {} : { values }),
    ...(Object.keys(tags).length === 0 ? {} : { tags }),
  };
}

function validIdentifier(value: string): boolean {
  return value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/u.test(value);
}

function validName(value: string): boolean {
  return value.length > 0 && value.length <= 96 && /^[a-zA-Z0-9._-]+$/u.test(value);
}

function safeAttributeName(value: string): boolean {
  return validName(value) && !["content", "message", "payload", "prompt", "raw", "response", "text"].includes(value.toLowerCase());
}

function createId(): string {
  const runtimeCrypto = globalThis.crypto as { randomUUID?: () => string } | undefined;
  return runtimeCrypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function resetTelemetryForTests(): void {
  setTelemetryEnabled(false);
  transport = null;
  appVersion = undefined;
  inFlight.clear();
}
