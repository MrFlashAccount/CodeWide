import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
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
export type ConversationReadSurfaceProps = {
  thread: ThreadListItem;
  server: ThreadListServer | undefined;
  remoteThread: Thread;
  compact: boolean;
  onBack: (() => void) | undefined;
  onOpenSubagentThread(threadId: string): void;
  getTransferAccess: GetTransferAccess | undefined;
  getStableTransferAccess: GetTransferAccess;
  onFixUnsupportedBlock: ((block: RenderBlock) => Promise<void>) | undefined;
  openThreadDocumentLink(href: string): boolean;
  openCodeDocument(request: DocumentPreviewRequest): void;
  presentTurnChanges(target: TurnChangesTarget, files: readonly TurnChangedFile[]): void;
  footerContent: ReactElement;
  reviewContent: ReactElement;
  appVoiceInputRuntime: AppVoiceInputRuntime;
  viewport: ReturnType<typeof useTimelineViewportState>;
  overlayState: ReturnType<typeof useOverlayScrollState>;
  overlay: ReturnType<typeof useOverlayScrollOwnership>;
  pagination: ReturnType<typeof usePaginationTrim>;
};
