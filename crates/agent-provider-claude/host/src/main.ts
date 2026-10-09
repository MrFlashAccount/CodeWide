/**
 * Claude agent host process entry: wires configuration, the host's thread
 * metadata store, Claude's session store, the SDK runtime, the thread service
 * and the stdio JSON-RPC server.
 *
 * Launch: `<runtime> dist/main.js --claude-executable <abs>
 * --journal-directory <abs> --idle-release-minutes <5..240>`. stdout carries
 * protocol messages only; stderr carries JSON log lines only. Closing stdin
 * (the companion exiting) ends every session and the process.
 */

import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { parseConfig } from "./config.js";
import { createLogger } from "./log.js";
import { createSdkRuntime } from "./claude/sdkRuntime.js";
import { createSdkSessionStore } from "./claude/sdkSessionStore.js";
import { ThreadStateStore } from "./state/stateStore.js";
import { ThreadService } from "./threads/service.js";
import { SessionCatalog } from "./threads/sessionCatalog.js";
import { RpcServer } from "./rpc/server.js";
import { HOST_VERSION } from "./version.js";

const INTERRUPT_TIMEOUT_MS = 5000;
const MS_PER_MINUTE = 60_000;
const BACKGROUND_DEFER_MAX_MINUTES = 240;
const INVALID_ARGUMENTS_EXIT_CODE = 2;

const FIRST_ARGUMENT = 2;
const nowMs = (): number => Date.now();
const writeStderr = (line: string): void => {
  process.stderr.write(line);
};
const writeStdout = (line: string): void => {
  process.stdout.write(line);
};

const logger = createLogger(writeStderr);
const parsed = parseConfig(process.argv.slice(FIRST_ARGUMENT));

if (parsed.status === "error") {
  logger.log("error", "invalid Claude agent host arguments", { err: new Error(parsed.error) });
  process.exitCode = INVALID_ARGUMENTS_EXIT_CODE;
} else {
  const config = parsed.config;
  const runtime = createSdkRuntime(config.claudeExecutable);
  const sessionStore = createSdkSessionStore();
  const holder: { server: RpcServer | null } = { server: null };
  const service = new ThreadService({
    backgroundDeferMaxMs: BACKGROUND_DEFER_MAX_MINUTES * MS_PER_MINUTE,
    catalog: new SessionCatalog(sessionStore),
    emit: (event) => {
      holder.server?.emit(event);
    },
    idleReleaseMs: config.idleReleaseMinutes * MS_PER_MINUTE,
    interruptTimeoutMs: INTERRUPT_TIMEOUT_MS,
    logger,
    newUuid: () => randomUUID(),
    nowMs,
    runtime,
    sessionStore,
    stateStore: new ThreadStateStore(config.stateDirectory),
  });
  const server = new RpcServer({
    logger,
    runtime,
    service,
    version: HOST_VERSION,
    write: writeStdout,
  });
  holder.server = server;
  for (const event of service.load()) {
    server.emit(event);
  }
  logger.log("info", "claude agent host started", {
    idleReleaseMinutes: config.idleReleaseMinutes,
  });

  const lines = createInterface({ crlfDelay: Infinity, input: process.stdin });
  lines.on("line", (line) => {
    server.handleLine(line).catch((error: unknown) => {
      logger.log("error", "request handling failed", {
        err: error instanceof Error ? error : new Error(String(error)),
      });
    });
  });
  lines.on("close", () => {
    service.shutdown();
    logger.log("info", "claude agent host stopping: stdin closed");
    // WHY: closing stdin is the companion's shutdown signal; SDK child process
    // handles can keep the event loop alive after every session was closed.
    // oxlint-disable-next-line unicorn/no-process-exit
    process.exit(0);
  });
}
