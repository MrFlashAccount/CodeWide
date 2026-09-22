import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";
import type { RenderBlock } from "@codewide/renderers";
import type { ReactElement } from "react";
import type { GetTransferAccess } from "../../data/private-transfer";
import type { DocumentPreviewRequest } from "../../rendering/DocumentPreviewHost";
import type { TurnChangedFile } from "../../rendering/turn-changes";
import type { TurnChangesTarget } from "../../rendering/TurnChangesContext";
import type { AppVoiceInputRuntime } from "../../ui/VoiceInputRuntime";
import type { ThreadListServer } from "../connections/connectionPresentation";
import type { ThreadListItem } from "../threadList/threadListTypes";
import type {
  useOverlayScrollOwnership,
  useOverlayScrollState,
} from "./timeline/overlayScrollOwnership";
import type { usePaginationTrim, useTimelineViewportState } from "./timeline/timelineViewport";

/** Authoritative data and navigation capabilities required by the read surface. */
export type ConversationReadSurfaceProps = {
  appVoiceInputRuntime: AppVoiceInputRuntime;
  compact: boolean;
  footerContent: ReactElement;
  getStableTransferAccess: GetTransferAccess;
  getTransferAccess: GetTransferAccess | undefined;
  onBack: (() => void) | undefined;
  onFixUnsupportedBlock: ((block: RenderBlock) => Promise<void>) | undefined;
  onOpenSubagentThread: (threadId: string) => void;
  openCodeDocument: (request: DocumentPreviewRequest) => void;
  openThreadDocumentLink: (href: string) => boolean;
  overlay: ReturnType<typeof useOverlayScrollOwnership>;
  overlayState: ReturnType<typeof useOverlayScrollState>;
  pagination: ReturnType<typeof usePaginationTrim>;
  presentTurnChanges: (target: TurnChangesTarget, files: readonly TurnChangedFile[]) => void;
  remoteThread: Thread;
  reviewContent: ReactElement;
  server: ThreadListServer | undefined;
  thread: ThreadListItem;
  viewport: ReturnType<typeof useTimelineViewportState>;
};
