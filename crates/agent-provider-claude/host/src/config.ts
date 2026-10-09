/**
 * Command-line configuration of the Claude agent host process.
 *
 * The companion launches `<runtime> <entry> --claude-executable <abs>
 * --journal-directory <abs> --idle-release-minutes <5..240>`. The state
 * directory flag keeps its former name `--journal-directory` so that existing
 * companion builds keep working; `--state-directory` is accepted as its
 * replacement (exactly one of the two). Values are validated here; an invalid
 * launch exits before the handshake.
 */

import { isAbsolute } from "node:path";

export interface HostConfig {
  /** Absolute path of the user's `claude` executable. */
  readonly claudeExecutable: string;
  /** Minutes without activity before an idle session's process is released. */
  readonly idleReleaseMinutes: number;
  /** Absolute path of the host's own thread metadata directory. */
  readonly stateDirectory: string;
}

export type ConfigResult =
  | { readonly config: HostConfig; readonly status: "ok" }
  | { readonly error: string; readonly status: "error" };

const IDLE_RELEASE_MIN = 5;
const IDLE_RELEASE_MAX = 240;
const IDLE_RELEASE_DEFAULT = 30;

export const IDLE_RELEASE_MINUTES = {
  default: IDLE_RELEASE_DEFAULT,
  max: IDLE_RELEASE_MAX,
  min: IDLE_RELEASE_MIN,
} as const;

const KNOWN_FLAGS: ReadonlySet<string> = new Set([
  "--claude-executable",
  "--idle-release-minutes",
  "--journal-directory",
  "--state-directory",
]);

const PAIR = 2;

type FlagsResult =
  | { readonly error: string; readonly status: "error" }
  | { readonly status: "ok"; readonly values: ReadonlyMap<string, string> };

/** Parses `--name value` pairs; unknown or repeated flags are errors. */
function parseFlags(argv: readonly string[]): FlagsResult {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += PAIR) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === undefined || !flag.startsWith("--") || value === undefined) {
      return { error: `expected --flag value pairs near ${flag ?? "<end>"}`, status: "error" };
    }
    if (!KNOWN_FLAGS.has(flag)) {
      return { error: `unknown flag ${flag}`, status: "error" };
    }
    if (values.has(flag)) {
      return { error: `${flag} is repeated`, status: "error" };
    }
    values.set(flag, value);
  }
  return { status: "ok", values };
}

function stateDirectoryOf(values: ReadonlyMap<string, string>): string | null {
  const legacy = values.get("--journal-directory");
  const current = values.get("--state-directory");
  if (legacy !== undefined && current !== undefined) {
    return null;
  }
  const directory = current ?? legacy;
  return directory !== undefined && isAbsolute(directory) ? directory : null;
}

function idleMinutesOf(values: ReadonlyMap<string, string>): number | null {
  const raw = values.get("--idle-release-minutes");
  const minutes = raw === undefined ? IDLE_RELEASE_DEFAULT : Number(raw);
  return Number.isSafeInteger(minutes) && minutes >= IDLE_RELEASE_MIN && minutes <= IDLE_RELEASE_MAX
    ? minutes
    : null;
}

export function parseConfig(argv: readonly string[]): ConfigResult {
  const flags = parseFlags(argv);
  if (flags.status === "error") {
    return flags;
  }
  const claudeExecutable = flags.values.get("--claude-executable");
  if (claudeExecutable === undefined || !isAbsolute(claudeExecutable)) {
    return { error: "--claude-executable must be an absolute path", status: "error" };
  }
  const stateDirectory = stateDirectoryOf(flags.values);
  if (stateDirectory === null) {
    return {
      error: "exactly one of --state-directory or --journal-directory must be an absolute path",
      status: "error",
    };
  }
  const idleReleaseMinutes = idleMinutesOf(flags.values);
  if (idleReleaseMinutes === null) {
    return {
      error: `--idle-release-minutes must be an integer in ${String(IDLE_RELEASE_MIN)}..${String(IDLE_RELEASE_MAX)}`,
      status: "error",
    };
  }
  return { config: { claudeExecutable, idleReleaseMinutes, stateDirectory }, status: "ok" };
}
