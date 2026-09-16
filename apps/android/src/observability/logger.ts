type LogFieldValue = boolean | number | string | null;

type LogFields = Readonly<Record<string, LogFieldValue>>;

type LogLevel = "debug" | "error" | "info" | "warn";

export type LogRecord = {
  readonly err: Error | null;
  readonly event: string;
  readonly fields: LogFields;
  readonly level: LogLevel;
  readonly occurredAtUnixMs: number;
};

export type LogSink = (record: LogRecord) => void;

type LogInput = {
  readonly event: string;
  readonly fields?: LogFields;
};

type ErrorLogInput = LogInput & {
  readonly err: Error;
};

type CaughtLogInput = LogInput & {
  readonly error: unknown;
};

/** Stable structured logging capability used by V1 application owners. */
export type Logger = {
  readonly debug: (input: LogInput) => void;
  readonly error: (input: ErrorLogInput) => void;
  readonly errorCaught: (input: CaughtLogInput) => void;
  readonly info: (input: LogInput) => void;
  readonly warn: (input: LogInput) => void;
  readonly warnCaught: (input: CaughtLogInput) => void;
};

const EMPTY_FIELDS: LogFields = {};

/** Creates a structured logger around one environment-owned output sink. */
export function createLogger(sink: LogSink, now: () => number = Date.now): Logger {
  const write = (level: LogLevel, input: LogInput, err: Error | null): void => {
    sink({
      err,
      event: input.event,
      fields: input.fields ?? EMPTY_FIELDS,
      level,
      occurredAtUnixMs: now(),
    });
  };
  const writeCaught = (level: "error" | "warn", input: CaughtLogInput): void => {
    if (input.error instanceof Error) {
      write(level, input, input.error);
      return;
    }
    write(level, input, null);
  };
  return {
    debug: (input) => {
      write("debug", input, null);
    },
    error: (input) => {
      write("error", input, input.err);
    },
    errorCaught: (input) => {
      writeCaught("error", input);
    },
    info: (input) => {
      write("info", input, null);
    },
    warn: (input) => {
      write("warn", input, null);
    },
    warnCaught: (input) => {
      writeCaught("warn", input);
    },
  };
}

function consoleSink(record: LogRecord): void {
  if (record.level === "error") {
    // WHY: This is the single platform sink that exposes structured application errors to Metro and logcat.
    // oxlint-disable-next-line no-console
    console.error(record);
    return;
  }
  if (record.level === "warn") {
    // WHY: This is the single platform sink that exposes structured application warnings to Metro and logcat.
    // oxlint-disable-next-line no-console
    console.warn(record);
    return;
  }
  if (record.level === "info") {
    // WHY: This is the single platform sink that exposes structured application information to Metro and logcat.
    // oxlint-disable-next-line no-console
    console.info(record);
    return;
  }
  // WHY: This is the single platform sink that exposes structured application diagnostics to Metro and logcat.
  // oxlint-disable-next-line no-console
  console.debug(record);
}

/** Application logger for local structured diagnostics. */
export const appLogger = createLogger(consoleSink);
