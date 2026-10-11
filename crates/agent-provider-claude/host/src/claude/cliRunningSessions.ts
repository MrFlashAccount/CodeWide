/**
 * `RunningSessions` from the `claude` CLI: `claude agents --json` prints the
 * active sessions (interactive and background) as a JSON array for scripting.
 * The CLI owns Claude's process registry; the host never reads it itself.
 */

import { execFile } from "node:child_process";
import type { RunningSessions } from "./port.js";

const LIST_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 4_194_304;

/** The `sessionId` of every entry of the CLI's array; entries without one are skipped. */
export function parseRunningSessions(output: string): ReadonlySet<string> {
  const parsed: unknown = JSON.parse(output);
  if (!Array.isArray(parsed)) {
    throw new TypeError("claude agents --json did not print an array");
  }
  const entries: readonly unknown[] = parsed;
  const sessionIds = new Set<string>();
  for (const entry of entries) {
    if (typeof entry === "object" && entry !== null && "sessionId" in entry) {
      const { sessionId } = entry;
      if (typeof sessionId === "string") {
        sessionIds.add(sessionId);
      }
    }
  }
  return sessionIds;
}

async function agentsJson(claudeExecutable: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      claudeExecutable,
      ["agents", "--json"],
      { encoding: "utf8", maxBuffer: MAX_OUTPUT_BYTES, timeout: LIST_TIMEOUT_MS },
      (error, stdout) => {
        if (error === null) {
          resolve(stdout);
        } else {
          // Node types the failure as `ExecFileException`; at run time it is an `Error`.
          reject(error instanceof Error ? error : new Error(error.message));
        }
      },
    );
  });
}

export function createCliRunningSessions(claudeExecutable: string): RunningSessions {
  return {
    list: async (): Promise<ReadonlySet<string>> => {
      const stdout = await agentsJson(claudeExecutable);
      return parseRunningSessions(stdout);
    },
  };
}
