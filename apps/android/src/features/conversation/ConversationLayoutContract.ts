import type { ReactElement } from "react";
import type { EdgeInsets } from "react-native-safe-area-context";
import type { DocumentPreviewRequest } from "../../rendering/DocumentPreviewHost";
import type { Dispatch, SetStateAction } from "react";
import type { PresentTurnChanges } from "../../rendering/TurnChangesContext";

/** Visual regions and layout state consumed by the conversation shell. */
export type ConversationLayoutProps = {
  bottomChrome: ReactElement;
  compact: boolean;
  conversationInsets: EdgeInsets;
  cwd: string;
  headerContent: ReactElement;
  jumpContent: ReactElement;
  openCodeDocument: (request: DocumentPreviewRequest) => void;
  presentTurnChanges: PresentTurnChanges;
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
