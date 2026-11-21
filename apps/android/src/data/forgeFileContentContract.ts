/**
 * `companion/pullRequest/fileContent/read`: one complete head file of a pull
 * request (`forge.fileContent@1`). The Companion has already held `text` to the
 * protocol's bound (at most 1 MiB, UTF-8 without NUL); every other state means
 * the whole file cannot be shown.
 */
import { decodeOrNull, oneOf, optionalCount, record, text } from "./forgeWire";

/** The head file, or why it cannot be shown whole. */
export type PullRequestFileContent =
  | { readonly content: string; readonly state: "text" }
  | { readonly bytes: number | null; readonly state: "tooLarge" }
  | { readonly state: "binary" }
  | { readonly state: "missing" };

/** Parses `companion/pullRequest/fileContent/read`; a contract mismatch is `null`. */
export function parsePullRequestFileContent(value: unknown): PullRequestFileContent | null {
  return decodeOrNull((): PullRequestFileContent => {
    const result = record(value, "result");
    const state = oneOf(result.state, ["text", "tooLarge", "binary", "missing"], "state");
    if (state === "text") {
      return { content: text(result.content, "content"), state };
    }
    if (state === "tooLarge") {
      return { bytes: optionalCount(result.bytes, "bytes"), state };
    }
    return { state };
  });
}
