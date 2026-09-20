import type { StyleProp, TextStyle } from "react-native";

import type { GetTransferAccess } from "../../../data/private-transfer";
import type { LargePasteEvent } from "../../../native/large-paste";
import type { ComposerMention } from "./composer-mentions";
import type { SearchComposerMentions } from "./composer-suggestions";
import type { ComposerTextSnapshot } from "../composerSession";

export type ComposerMarkdownInputHandle = {
  focus: () => void;
  getValue: () => Promise<ComposerTextSnapshot>;
  insertCode: (block: boolean) => void;
  insertLinkedText: (text: string, url: string) => void;
  insertText: (text: string) => void;
  startMention: (indicator: "/" | "@") => void;
  toggleOrderedList: () => void;
  toggleUnorderedList: () => void;
};

export type ComposerMarkdownInputProps = {
  readonly accessibilityLabel: string;
  readonly getTransferAccess?: GetTransferAccess;
  readonly largePasteThreshold?: number;
  readonly mentionIndicators: readonly ("/" | "@")[];
  readonly onChangeValue: (value: ComposerTextSnapshot) => void;
  readonly onLargePaste?: (event: LargePasteEvent) => void;
  readonly onSelectionChange?: (selection: {
    readonly end: number;
    readonly start: number;
  }) => void;
  readonly onSelectMention?: (mention: ComposerMention) => void;
  readonly placeholder: string;
  readonly scrollEnabled?: boolean;
  readonly search: SearchComposerMentions;
  readonly selection?: { readonly end: number; readonly start: number };
  readonly style?: StyleProp<TextStyle>;
  readonly value: string;
};
