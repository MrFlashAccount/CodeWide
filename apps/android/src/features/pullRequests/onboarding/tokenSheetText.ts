/**
 * Presentation of the Paste-a-token sheet's plugin text. The plugin's detail
 * is untrusted plain text; only words exactly equal to the classic scopes the
 * plugin declared in its own Generate-token link are styled as code.
 */

/** One run of the detail text at its offset; `code` runs are a declared scope name. */
export type DetailRun = { readonly code: boolean; readonly offset: number; readonly text: string };

/** Classic scopes from the `scopes` query of a validated Generate-token URL. */
export function declaredScopes(safeUrl: string | null): ReadonlySet<string> {
  if (safeUrl === null) {
    return new Set();
  }
  const scopes = new URL(safeUrl).searchParams.get("scopes") ?? "";
  return new Set(scopes.split(",").filter((scope) => scope.length > 0));
}

/** Splits the detail into runs, marking whole-word occurrences of a declared scope. */
export function detailRuns(detail: string, scopes: ReadonlySet<string>): readonly DetailRun[] {
  const runs: DetailRun[] = [];
  let offset = 0;
  // Words keep `:` so `read:org` stays one token; separators keep the original text.
  for (const part of detail.split(/([\w:]+)/u)) {
    if (part.length > 0) {
      runs.push({ code: scopes.has(part), offset, text: part });
      offset += part.length;
    }
  }
  return runs;
}
