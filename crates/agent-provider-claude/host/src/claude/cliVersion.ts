/**
 * Version of the user's Claude Code executable. The provider descriptor uses
 * this runtime version, matching Codex's descriptor, instead of the version of
 * CodeWide's adapter process.
 */

import { execFile } from "node:child_process";

const VERSION_TIMEOUT_MS = 5000;
const MAX_OUTPUT_BYTES = 4096;
const MAX_VERSION_LENGTH = 64;
const VERSION_PATTERN = /\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/;

/** Extracts the bounded semantic version from `claude --version`. */
export function parseClaudeVersion(output: string): string {
  const version = VERSION_PATTERN.exec(output)?.[0];
  if (version === undefined || version.length > MAX_VERSION_LENGTH) {
    throw new TypeError("claude --version did not report a semantic version");
  }
  return version;
}

/** Runs the resolved Claude executable once and returns its reported version. */
export async function readClaudeVersion(claudeExecutable: string): Promise<string> {
  const output = await new Promise<string>((resolve, reject) => {
    execFile(
      claudeExecutable,
      ["--version"],
      { encoding: "utf8", maxBuffer: MAX_OUTPUT_BYTES, timeout: VERSION_TIMEOUT_MS },
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
  return parseClaudeVersion(output);
}
