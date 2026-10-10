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
import { RateLimitReporter } from "./account/rateLimitReporter.js";
import { ModelCatalog } from "./catalog/models.js";
import { createCliRunningSessions } from "./claude/cliRunningSessions.js";
import { loadAgentSdk } from "./claude/sdkModule.js";
import { createSdkRuntime } from "./claude/sdkRuntime.js";
import { createSdkSessionStore } from "./claude/sdkSessionStore.js";
import { ThreadStateStore } from "./state/stateStore.js";
import { ThreadService } from "./threads/service.js";
import { SessionCatalog } from "./threads/sessionCatalog.js";
import { RpcServer } from "./rpc/server.js";
import { HOST_VERSION } from "./version.js";

const INTERRUPT_TIMEOUT_MS = 5000;
const OPEN_ELSEWHERE_POLL_MS = 10_000;
const MS_PER_MINUTE = 60_000;
const BACKGROUND_DEFER_MAX_MINUTES = 240;
const INVALID_ARGUMENTS_EXIT_CODE = 2;
const SDK_UNAVAILABLE_EXIT_CODE = 3;

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
  const sdk = await loadAgentSdk(config.agentSdk).catch((error: unknown) => {
    logger.log("error", "the Agent SDK could not be loaded", {
      err: error instanceof Error ? error : new Error(String(error)),
    });
    // WHY: without the SDK the host can serve nothing; exiting before the
    // handshake lets the companion report the provider as failed.
    // oxlint-disable-next-line unicorn/no-process-exit
    process.exit(SDK_UNAVAILABLE_EXIT_CODE);
  });
  const runtime = createSdkRuntime(sdk, config.claudeExecutable);
  const sessionStore = createSdkSessionStore(sdk);
  const holder: { server: RpcServer | null } = { server: null };
  const models = new ModelCatalog();
  const rateLimits = new RateLimitReporter({
    logger,
    nowMs,
    publish: (limits) => {
      holder.server?.publishRateLimits(limits);
    },
  });
  const service = new ThreadService({
    backgroundDeferMaxMs: BACKGROUND_DEFER_MAX_MINUTES * MS_PER_MINUTE,
    callClientTool: async (params, signal) => {
      const server = holder.server;
      if (server === null) {
        throw new Error("the RPC server is not running");
      }
      return server.callTool(params, signal);
    },
    catalog: new SessionCatalog(sessionStore),
    emit: (event) => {
      holder.server?.emit(event);
    },
    idleReleaseMs: config.idleReleaseMinutes * MS_PER_MINUTE,
    interruptTimeoutMs: INTERRUPT_TIMEOUT_MS,
    logger,
    models,
    newUuid: () => randomUUID(),
    nowMs,
    openElsewherePollMs: OPEN_ELSEWHERE_POLL_MS,
    rateLimits,
    runningSessions: createCliRunningSessions(config.claudeExecutable),
    runtime,
    sessionStore,
    stateStore: new ThreadStateStore(config.stateDirectory),
  });
  const server = new RpcServer({
    logger,
    models,
    rateLimits,
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
    server.shutdown();
    service.shutdown();
    logger.log("info", "claude agent host stopping: stdin closed");
    // WHY: closing stdin is the companion's shutdown signal; SDK child process
    // handles can keep the event loop alive after every session was closed.
    // oxlint-disable-next-line unicorn/no-process-exit
    process.exit(0);
  });
}
