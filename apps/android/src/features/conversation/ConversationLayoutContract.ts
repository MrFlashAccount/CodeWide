import type { ReactElement } from "react";
import type { EdgeInsets } from "react-native-safe-area-context";
import type { DocumentPreviewRequest } from "../../rendering/DocumentPreviewHost";
import type { Dispatch, SetStateAction } from "react";
import type { TurnChangedFile } from "../../rendering/turn-changes";
import type { TurnChangesTarget } from "../../rendering/TurnChangesContext";

/** Visual regions and layout state consumed by the conversation shell. */
export type ConversationLayoutProps = {
  bottomChrome: ReactElement;
  compact: boolean;
  conversationBackdropVisible: boolean;
  conversationInsets: EdgeInsets;
  cwd: string;
  headerContent: ReactElement;
  jumpContent: ReactElement;
  openCodeDocument: (request: DocumentPreviewRequest) => void;
  presentTurnChanges: (target: TurnChangesTarget, knownFiles: readonly TurnChangedFile[]) => void;
  projectPickerContent: ReactElement;
  projectPickerVisible: boolean;
  renameContent: ReactElement;
  reviewContent: ReactElement;
  searchContent: ReactElement;
  setComposerTrayVisible: Dispatch<SetStateAction<boolean>>;
  setConversationPaneHeight: Dispatch<SetStateAction<number>>;
  setNarrowConversationPane: Dispatch<SetStateAction<boolean>>;
  threadRenameVisible: boolean;
  threadSearchVisible: boolean;
  timelineSurface: ReactElement;
};
