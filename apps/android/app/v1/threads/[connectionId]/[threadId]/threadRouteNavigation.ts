import type { useRouter } from "expo-router";

import type { ConversationRouteNavigation } from "../../../../../src/features/conversation/conversationRouteNavigation";
import { changesRouteSessions } from "../../../../../src/services/changes/changesRouteSession";
import { composerToolRouteSessions } from "../../../../../src/services/composer/composerToolRouteSession";
import { contentRouteSessions } from "../../../../../src/services/content/contentRouteSession";
import { documentRouteService } from "../../../../../src/services/documents/documentRouteService";
import { drawingRouteSessions } from "../../../../../src/services/drawing/drawingRouteSession";
import { terminalRouteSessions } from "../../../../../src/services/terminal/terminalRouteSession";
import { useEvent } from "../../../../../src/react/useEvent";
import {
  threadRouteSessionOwner,
  type V1ThreadRouteParams,
} from "../../../../../src/services/threads/threadRouteParams";

const TOOL_PATHS = {
  goal: "/v1/threads/[connectionId]/[threadId]/goal",
  model: "/v1/threads/[connectionId]/[threadId]/controls/model",
  permissions: "/v1/threads/[connectionId]/[threadId]/controls/permissions",
  ports: "/v1/threads/[connectionId]/[threadId]/ports",
  queue: "/v1/threads/[connectionId]/[threadId]/queue",
  review: "/v1/threads/[connectionId]/[threadId]/review",
  runtime: "/v1/threads/[connectionId]/[threadId]/runtime",
  skills: "/v1/threads/[connectionId]/[threadId]/controls/skills",
} as const;

/** Owns stable thread-child route intents exposed through the conversation context. */
export function useThreadRouteNavigation(
  router: ReturnType<typeof useRouter>,
  thread: V1ThreadRouteParams,
): ConversationRouteNavigation {
  const connectionId = thread.connectionId.value;
  const threadId = thread.threadId.value;
  const owner = threadRouteSessionOwner(thread);
  const openAgents = useEvent<ConversationRouteNavigation["openAgents"]>(
    (initialThreadId, parentThreadId) => {
      const parentParams =
        parentThreadId === undefined || parentThreadId === threadId
          ? {}
          : { parentAgentThreadId: parentThreadId };
      if (initialThreadId === null) {
        router.push({
          params: { connectionId, threadId, ...parentParams },
          pathname: "/v1/threads/[connectionId]/[threadId]/agents",
        });
        return;
      }
      router.push({
        params: { agentThreadId: initialThreadId, connectionId, threadId, ...parentParams },
        pathname: "/v1/threads/[connectionId]/[threadId]/agents/[agentThreadId]",
      });
    },
  );
  const openAttachments = useEvent<ConversationRouteNavigation["openAttachments"]>(() => {
    router.push({
      params: { connectionId, threadId },
      pathname: "/v1/threads/[connectionId]/[threadId]/attachments",
    });
  });
  const openChanges = useEvent<ConversationRouteNavigation["openChanges"]>((request) => {
    const session = changesRouteSessions.open(owner, request);
    router.push({
      params: { connectionId, sessionId: session.id, threadId },
      pathname: "/v1/threads/[connectionId]/[threadId]/changes",
    });
  });
  const openCodeDocument = useEvent<ConversationRouteNavigation["openCodeDocument"]>((request) => {
    const session = changesRouteSessions.open(owner, request);
    router.push({
      params: { connectionId, sessionId: session.id, threadId },
      pathname: "/v1/threads/[connectionId]/[threadId]/documents/[sessionId]",
    });
  });
  const openContent = useEvent<ConversationRouteNavigation["openContent"]>((request) => {
    const session = contentRouteSessions.open(owner, request);
    router.push({
      params: { connectionId, sessionId: session.id, threadId },
      pathname: "/v1/threads/[connectionId]/[threadId]/content/[sessionId]",
    });
  });
  const openDocument = useEvent<ConversationRouteNavigation["openDocument"]>((request) => {
    const session = documentRouteService.open(owner, request);
    router.push({
      params: { connectionId, sessionId: session.id, threadId },
      pathname: "/v1/threads/[connectionId]/[threadId]/documents/[sessionId]",
    });
  });
  const openDrawing = useEvent<ConversationRouteNavigation["openDrawing"]>((request) => {
    const result = drawingRouteSessions.open(owner, request);
    if (result.status === "admitted") {
      router.push({
        params: { sessionId: result.session.id },
        pathname: "/v1/drawing/[sessionId]",
      });
    }
  });
  const openTerminal = useEvent<ConversationRouteNavigation["openTerminal"]>((request) => {
    const session = terminalRouteSessions.open(owner, request);
    router.push({
      params: { connectionId, sessionId: session.id, threadId },
      pathname: "/v1/threads/[connectionId]/[threadId]/terminal",
    });
  });
  const openTool = useEvent<ConversationRouteNavigation["openTool"]>((request) => {
    const session = composerToolRouteSessions.open(owner, request);
    router.push({
      params: { connectionId, sessionId: session.id, threadId },
      pathname: TOOL_PATHS[request.kind],
    });
  });
  const openTurnChanges = useEvent<ConversationRouteNavigation["openTurnChanges"]>((request) => {
    const session = changesRouteSessions.open(owner, request);
    router.push({
      params: {
        connectionId,
        sessionId: session.id,
        threadId,
        turnId: request.target.turnId,
      },
      pathname: "/v1/threads/[connectionId]/[threadId]/changes/turns/[turnId]",
    });
  });
  return {
    openAgents,
    openAttachments,
    openChanges,
    openCodeDocument,
    openContent,
    openDocument,
    openDrawing,
    openTerminal,
    openTool,
    openTurnChanges,
  };
}
