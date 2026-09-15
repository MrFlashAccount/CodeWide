import type { SearchComposerMentions } from "./composer-suggestions";

export type ComposerMentionInputProps = {
  readonly defaultValue: string;
  readonly onPreviewMarkdown: (markdown: string) => void;
  readonly search: SearchComposerMentions;
};
