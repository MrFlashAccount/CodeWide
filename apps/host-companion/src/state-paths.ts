import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Resolve the stable host token during the CodeWide cutover.
 *
 * New installs use ~/.codewide. Existing installs keep working before or after
 * the atomic Rust migration, whose legacy path becomes a symlink.
 */
export function resolveDefaultTokenPath(home: string): string {
  const current = path.join(home, ".codewide", "host.token");
  if (existsSync(current)) return current;
  const legacy = path.join(home, ".codex-remote", "host.token");
  return existsSync(legacy) ? legacy : current;
}
