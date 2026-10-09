/**
 * Structured stderr logging.
 *
 * One JSON object per line: `{"ts","level","msg", ...fields}`. Fields carry
 * opaque ids and counters only — never prompts, outputs, tool inputs, env
 * values or credentials. An `Error` logged at `error` level is passed whole
 * in `err` and serialized with its original `name`, `message` and `stack`.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

/** Allowed field values: opaque ids, counters, flags and caught errors. */
export type LogField = string | number | boolean | null | Error;

export interface Logger {
  readonly log: (level: LogLevel, msg: string, fields?: Readonly<Record<string, LogField>>) => void;
}

function serializeField(value: LogField): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack ?? null };
  }
  return value;
}

/** Writes JSON log lines to the given sink (stderr in production). */
export function createLogger(write: (line: string) => void, now: () => Date = () => new Date()): Logger {
  return {
    log(level, msg, fields = {}) {
      const record: Record<string, unknown> = { ts: now().toISOString(), level, msg };
      for (const [key, value] of Object.entries(fields)) {
        record[key] = serializeField(value);
      }
      write(`${JSON.stringify(record)}\n`);
    },
  };
}

/** A logger that keeps lines in memory; used by tests to inspect log hygiene. */
export function createMemoryLogger(): Logger & { readonly lines: readonly string[] } {
  const lines: string[] = [];
  const logger = createLogger((line) => lines.push(line), () => new Date(0));
  return { log: logger.log, lines };
}
