/**
 * Sidecar process entry: wires configuration, journal, SDK runtime, thread
 * service and the stdio JSON-RPC server.
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
import { Journal } from "./journal/journal.js";
import { createSdkRuntime } from "./claude/sdkRuntime.js";
import { ThreadService } from "./threads/service.js";
import { RpcServer } from "./rpc/server.js";
import { SIDECAR_VERSION } from "./version.js";

const INTERRUPT_TIMEOUT_MS = 5_000;
const BACKGROUND_DEFER_MAX_MS = 4 * 60 * 60 * 1000;

function main(): void {
  const logger = createLogger((line) => process.stderr.write(line));
  const parsed = parseConfig(process.argv.slice(2));
  if (parsed.status === "error") {
    logger.log("error", "invalid sidecar arguments", { err: new Error(parsed.error) });
    process.exitCode = 2;
    return;
  }
  const config = parsed.config;
  const journal = new Journal(config.journalDirectory);
  const runtime = createSdkRuntime(config.claudeExecutable);
  const holder: { server: RpcServer | null } = { server: null };
  const service = new ThreadService({
    journal,
    runtime,
    logger,
    emit: (event) => holder.server?.emit(event),
    nowMs: () => Date.now(),
    newUuid: () => randomUUID(),
    interruptTimeoutMs: INTERRUPT_TIMEOUT_MS,
    idleReleaseMs: config.idleReleaseMinutes * 60 * 1000,
    backgroundDeferMaxMs: BACKGROUND_DEFER_MAX_MS,
  });
  const server = new RpcServer({ service, runtime, logger, write: (line) => process.stdout.write(line), version: SIDECAR_VERSION });
  holder.server = server;
  for (const event of service.load()) server.emit(event);
  logger.log("info", "claude sidecar started", { idleReleaseMinutes: config.idleReleaseMinutes });

  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on("line", (line) => {
    void server.handleLine(line);
  });
  lines.on("close", () => {
    service.shutdown();
    logger.log("info", "claude sidecar stopping: stdin closed");
    process.exit(0);
  });
}

main();
