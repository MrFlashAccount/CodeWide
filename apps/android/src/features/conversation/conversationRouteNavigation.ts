import { createContext, useContext } from "react";
import type { LargeContentRouteRequest } from "../../services/content/contentRouteSession";
import type {
  CurrentChangesRouteRequest,
  CodeDocumentRouteRequest,
  TurnChangesRouteRequest,
} from "../../services/changes/changesRouteSession";
import type { DrawingRouteRequest } from "../../services/drawing/drawingRouteSession";
import type { TerminalRouteRequest } from "../../services/terminal/terminalRouteSession";
import type { ComposerToolRouteRequest } from "../../services/composer/composerToolRouteSession";
import type { DocumentPreviewRequest } from "../../rendering/DocumentPreviewHost";

/** Commands exposed by the qualified V1 thread route layout to conversation features. */
export type ConversationRouteNavigation = {
  readonly openAgents: (initialThreadId: string | null, parentThreadId?: string) => void;
  readonly openAttachments: () => void;
  readonly openChanges: (request: CurrentChangesRouteRequest) => void;
  readonly openCodeDocument: (request: CodeDocumentRouteRequest) => void;
  readonly openContent: (request: LargeContentRouteRequest) => void;
  readonly openDocument: (request: DocumentPreviewRequest) => void;
  readonly openDrawing: (request: DrawingRouteRequest) => void;
  readonly openTerminal: (request: TerminalRouteRequest) => void;
  readonly openTool: (request: ComposerToolRouteRequest) => void;
  readonly openTurnChanges: (request: TurnChangesRouteRequest) => void;
};

/** Injects Router-owned V1 destination intents without importing Expo Router into features. */
export const ConversationRouteNavigationContext = createContext<ConversationRouteNavigation | null>(
  null,
);

/** Reads route intents at the mounted conversation composition boundary. */
export function useConversationRouteNavigation(): ConversationRouteNavigation {
  const navigation = useContext(ConversationRouteNavigationContext);
  if (navigation === null) {
    throw new Error("Conversation route navigation is unavailable");
  }
  return navigation;
}
