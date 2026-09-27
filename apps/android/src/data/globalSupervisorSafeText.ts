function boundedCharacters(value: string, limit: number): string {
  let prefix = "";
  let count = 0;
  for (const character of value) {
    if (count === limit) {
      return `${prefix}…`;
    }
    if (count < limit - 1) {
      prefix += character;
    }
    count += 1;
  }
  return value;
}

/** Removes common credentials and bounds text before it enters the supervisor control plane. */
export function projectGlobalSupervisorSafeText(value: string, limit: number): string {
  const normalized = value.replaceAll(/\s+/gu, " ").trim();
  const withoutUrlSecrets = normalized.replaceAll(
    /\bhttps?:\/\/[^\s?#]+(?:\?[^\s#]*)?(?:#[^\s]*)?/giu,
    (url) => url.split(/[?#]/u, 1)[0] ?? "[redacted URL]",
  );
  const withoutCredentialAssignments = withoutUrlSecrets.replaceAll(
    /\b(bearer|password|secret|token|api[ _-]?key)\s*[:=]?\s+[^\s,;]+/giu,
    "$1 [redacted]",
  );
  const withoutKnownTokens = withoutCredentialAssignments.replaceAll(
    /\b(?:ghp|github_pat|sk|xox[baprs])[-_][A-Za-z0-9_-]{8,}\b/gu,
    "[redacted token]",
  );
  return boundedCharacters(withoutKnownTokens, limit);
}
