/**
 * Command-line configuration of the sidecar process.
 *
 * The companion launches `<runtime> <sidecarEntry> --claude-executable <abs>
 * --journal-directory <abs> --idle-release-minutes <5..240>`. Values are
 * validated here; an invalid launch exits before the handshake.
 */

import { isAbsolute } from "node:path";

export interface SidecarConfig {
  /** Absolute path of the user's `claude` executable. */
  readonly claudeExecutable: string;
  /** Absolute path of the sidecar's own journal directory. */
  readonly journalDirectory: string;
  /** Minutes without activity before an idle session's process is released. */
  readonly idleReleaseMinutes: number;
}

export type ConfigResult =
  | { readonly status: "ok"; readonly config: SidecarConfig }
  | { readonly status: "error"; readonly error: string };

export const IDLE_RELEASE_MINUTES = { min: 5, max: 240, default: 30 } as const;

/** Parses `--name value` pairs; unknown or repeated flags are errors. */
export function parseConfig(argv: readonly string[]): ConfigResult {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === undefined || !flag.startsWith("--") || value === undefined) {
      return { status: "error", error: `expected --flag value pairs near ${flag ?? "<end>"}` };
    }
    if (values.has(flag)) return { status: "error", error: `${flag} is repeated` };
    values.set(flag, value);
  }
  const known = new Set(["--claude-executable", "--journal-directory", "--idle-release-minutes"]);
  for (const flag of values.keys()) {
    if (!known.has(flag)) return { status: "error", error: `unknown flag ${flag}` };
  }
  const claudeExecutable = values.get("--claude-executable");
  const journalDirectory = values.get("--journal-directory");
  if (claudeExecutable === undefined || !isAbsolute(claudeExecutable)) {
    return { status: "error", error: "--claude-executable must be an absolute path" };
  }
  if (journalDirectory === undefined || !isAbsolute(journalDirectory)) {
    return { status: "error", error: "--journal-directory must be an absolute path" };
  }
  const rawMinutes = values.get("--idle-release-minutes");
  const idleReleaseMinutes = rawMinutes === undefined ? IDLE_RELEASE_MINUTES.default : Number(rawMinutes);
  if (
    !Number.isSafeInteger(idleReleaseMinutes) ||
    idleReleaseMinutes < IDLE_RELEASE_MINUTES.min ||
    idleReleaseMinutes > IDLE_RELEASE_MINUTES.max
  ) {
    return {
      status: "error",
      error: `--idle-release-minutes must be an integer in ${IDLE_RELEASE_MINUTES.min}..${IDLE_RELEASE_MINUTES.max}`,
    };
  }
  return { status: "ok", config: { claudeExecutable, journalDirectory, idleReleaseMinutes } };
}
