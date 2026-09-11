import type { StyleProp, TextStyle } from "react-native";

import type { LargePasteEvent } from "../native/large-paste";
import type { GetTransferAccess } from "../data/private-transfer";
import type { ComposerMention } from "./composer-mentions";
import type { SearchComposerMentions } from "./composer-suggestions";

export type ComposerMarkdownInputHandle = {
  focus(): void;
  getMarkdown(): Promise<string>;
  insertCode(block: boolean): void;
  insertLinkedText(text: string, url: string): void;
  insertText(text: string): void;
  startMention(indicator: "/" | "@"): void;
  toggleOrderedList(): void;
  toggleUnorderedList(): void;
};

export type ComposerMarkdownInputProps = {
  readonly value: string;
  readonly accessibilityLabel: string;
  readonly placeholder: string;
  readonly mentionIndicators: readonly ("/" | "@")[];
  readonly search: SearchComposerMentions;
  readonly getTransferAccess?: GetTransferAccess;
  readonly onChangeText: (text: string) => void;
  readonly onChangeMarkdown?: (markdown: string) => void;
  readonly onSelectionChange?: (selection: { readonly start: number; readonly end: number }) => void;
  readonly onSelectMention?: (mention: ComposerMention) => void;
  readonly selection?: { readonly start: number; readonly end: number };
  readonly largePasteThreshold?: number;
  readonly onLargePaste?: (event: LargePasteEvent) => void;
  readonly scrollEnabled?: boolean;
  readonly style?: StyleProp<TextStyle>;
};
