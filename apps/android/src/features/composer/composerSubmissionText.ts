import { markdownForComposerSubmission } from "./skills/composer-skill-suggestions";
import type { ComposerTextSnapshot } from "./composerSession";

/** Converts one composer text snapshot into the wire-facing prompt. */
export function composerTextForSubmission(text: ComposerTextSnapshot): string {
  const markdown = markdownForComposerSubmission(text.markdown);
  return markdown.trim() === "" && text.plainText.trim() !== "" ? text.plainText : markdown;
}
