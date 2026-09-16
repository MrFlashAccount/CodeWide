import type { ReactElement } from "react";
import type { EdgeInsets } from "react-native-safe-area-context";
import type { DocumentPreviewRequest } from "../../rendering/DocumentPreviewHost";
import type { Dispatch, SetStateAction } from "react";
import type { TurnChangedFile } from "../../rendering/turn-changes";
import type { TurnChangesTarget } from "../../rendering/TurnChangesContext";

/** Visual regions and layout state consumed by the conversation shell. */
export type ConversationLayoutProps = {
  searchContent: ReactElement;
  jumpContent: ReactElement;
  projectPickerContent: ReactElement;
  renameContent: ReactElement;
  compact: boolean;
  setConversationPaneHeight: Dispatch<SetStateAction<number>>;
  setNarrowConversationPane: Dispatch<SetStateAction<boolean>>;
  headerContent: ReactElement;
  threadSearchVisible: boolean;
  conversationInsets: EdgeInsets;
  setComposerTrayVisible: Dispatch<SetStateAction<boolean>>;
  cwd: string;
  openCodeDocument: (request: DocumentPreviewRequest) => void;
  presentTurnChanges: (target: TurnChangesTarget, knownFiles: readonly TurnChangedFile[]) => void;
  timelineSurface: ReactElement;
  conversationBackdropVisible: boolean;
  awayFromLatest: boolean;
  bottomChrome: ReactElement;
  reviewContent: ReactElement;
  projectPickerVisible: boolean;
  threadRenameVisible: boolean;
};
