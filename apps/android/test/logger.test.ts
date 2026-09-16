import { describe, expect, it } from "vitest";

import { createLogger, type LogRecord } from "../src/observability/logger";

describe("structured logger", () => {
  it("preserves an Error instance and its stack in the err field", () => {
    const records: LogRecord[] = [];
    const logger = createLogger((record) => {
      records.push(record);
    }, () => 42);
    const error = new Error("database failed");

    logger.error({ err: error, event: "database.write.failed", fields: { attempt: 2 } });

    expect(records).toEqual([
      {
        err: error,
        event: "database.write.failed",
        fields: { attempt: 2 },
        level: "error",
        occurredAtUnixMs: 42,
      },
    ]);
    expect(records[0]?.err?.stack).toBe(error.stack);
  });

  it("does not serialize an unknown thrown value into the record", () => {
    const records: LogRecord[] = [];
    const logger = createLogger((record) => {
      records.push(record);
    }, () => 73);

    logger.warnCaught({ error: { secret: "must-not-leak" }, event: "native.event.invalid" });

    expect(records).toEqual([
      {
        err: null,
        event: "native.event.invalid",
        fields: {},
        level: "warn",
        occurredAtUnixMs: 73,
      },
    ]);
  });
});
