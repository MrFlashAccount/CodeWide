import { createHash } from "node:crypto";
import { lstat, readFile, readlink } from "node:fs/promises";
import path from "node:path";

import { runCommand } from "./process.ts";

function addField(
  hash: ReturnType<typeof createHash>,
  label: string,
  value: Buffer | string,
): void {
  const bytes = typeof value === "string" ? Buffer.from(value) : value;
  hash.update(`${label.length}:${label}:${bytes.length}:`);
  hash.update(bytes);
}

/** Fingerprints the exact committed and local source state exercised by E2E. */
export async function computeSourceFingerprint(repoRoot: string): Promise<string> {
  const [head, trackedResult, untrackedResult] = await Promise.all([
    runCommand("git", ["rev-parse", "HEAD"], { cwd: repoRoot }),
    runCommand("git", ["ls-files", "-z"], { cwd: repoRoot }),
    runCommand("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
      cwd: repoRoot,
    }),
  ]);
  const hash = createHash("sha256");
  addField(hash, "head", head.stdout.trim());
  const tracked = sortedPaths(trackedResult.stdout);
  const untracked = sortedPaths(untrackedResult.stdout);
  for (const filePath of tracked) await addWorkingTreePath(hash, repoRoot, "tracked", filePath);
  for (const filePath of untracked) await addWorkingTreePath(hash, repoRoot, "untracked", filePath);
  return `sha256:${hash.digest("hex")}`;
}

function sortedPaths(value: string): string[] {
  return value
    .split("\0")
    .filter((filePath) => filePath !== "")
    .sort((left, right) => left.localeCompare(right));
}

async function addWorkingTreePath(
  hash: ReturnType<typeof createHash>,
  repoRoot: string,
  kind: "tracked" | "untracked",
  filePath: string,
): Promise<void> {
  const absolutePath = path.join(repoRoot, filePath);
  try {
    const metadata = await lstat(absolutePath);
    addField(hash, `${kind}-path`, filePath);
    addField(hash, `${kind}-mode:${filePath}`, String(metadata.mode & 0o777));
    if (metadata.isSymbolicLink()) {
      addField(hash, `${kind}-symlink:${filePath}`, await readlink(absolutePath));
    } else if (metadata.isFile()) {
      addField(hash, `${kind}-bytes:${filePath}`, await readFile(absolutePath));
    } else {
      addField(hash, `${kind}-special:${filePath}`, metadata.isDirectory() ? "directory" : "other");
    }
  } catch (cause) {
    if (isMissingPathError(cause)) {
      addField(hash, `${kind}-deleted`, filePath);
      return;
    }
    throw cause;
  }
}

function isMissingPathError(cause: unknown): cause is NodeJS.ErrnoException {
  return cause instanceof Error && "code" in cause && cause.code === "ENOENT";
}

/** Returns the exercised fingerprint only when the source tree stayed unchanged. */
export function requireStableSourceFingerprint(before: string, after: string): string {
  if (before !== after) {
    throw new Error(
      "Repository source changed while Android E2E was running; evidence cannot prove one stable source graph",
    );
  }
  return before;
}
