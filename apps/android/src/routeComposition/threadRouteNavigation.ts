import type { useRouter } from "expo-router";

import type { ConversationRouteNavigation } from "../features/conversation/conversationRouteNavigation";
import { changesRouteSessions } from "../services/changes/changesRouteSession";
import { composerToolRouteSessions } from "../services/composer/composerToolRouteSession";
import { contentRouteSessions } from "../services/content/contentRouteSession";
import { documentRouteService } from "../services/documents/documentRouteService";
import { agentRouteSessions } from "../services/agents/agentRouteSession";
import { attachmentRouteSessions } from "../services/attachments/attachmentRouteSession";
import {
  drawingRouteSessions,
  type DrawingRouteRequest,
} from "../services/drawing/drawingRouteSession";
import { terminalRouteSessions } from "../services/terminal/terminalRouteSession";
import { taskOutputRouteSessions } from "../services/backgroundTasks/taskOutputRouteSession";
import { useEvent } from "../react/useEvent";
import {
  threadRouteSessionOwner,
  type V1ThreadRouteParams,
} from "../services/threads/threadRouteParams";

const TOOL_PATHS = {
  goal: "/threads/[connectionId]/[threadId]/goal",
  model: "/threads/[connectionId]/[threadId]/controls/model",
  permissions: "/threads/[connectionId]/[threadId]/controls/permissions",
  ports: "/threads/[connectionId]/[threadId]/ports",
  queue: "/threads/[connectionId]/[threadId]/queue",
  review: "/threads/[connectionId]/[threadId]/review",
  runtime: "/threads/[connectionId]/[threadId]/runtime",
  skills: "/threads/[connectionId]/[threadId]/controls/skills",
} as const;

/**
 * Presents a drawing as the workspace root's modal route. It sits above both catalog tabs, so
 * opening it never switches tabs and closing it returns to whichever destination opened it.
 */
export function pushDrawingRoute(
  router: ReturnType<typeof useRouter>,
  {
    owner,
    request,
    routeParams,
  }: {
    readonly owner: ReturnType<typeof threadRouteSessionOwner>;
    readonly request: DrawingRouteRequest;
    readonly routeParams: Readonly<Record<string, string>>;
  },
): void {
  const result = drawingRouteSessions.open(owner, request);
  if (result.status === "admitted") {
    router.push({
      params: { ...routeParams, sessionId: result.session.id },
      pathname: "/drawing/[sessionId]",
    });
  }
}

/** Owns stable thread-child route intents exposed through the conversation context. */
export function useThreadRouteNavigation(
  router: ReturnType<typeof useRouter>,
  thread: V1ThreadRouteParams,
  globalSearchSessionId: string | null = null,
): ConversationRouteNavigation {
  const connectionId = thread.connectionId.value;
  const threadId = thread.threadId.value;
  const owner = threadRouteSessionOwner(thread);
  const routeParams = {
    connectionId,
    ...(globalSearchSessionId === null ? {} : { globalSearchSessionId }),
    threadId,
  };
  const openAgents = useEvent<ConversationRouteNavigation["openAgents"]>((request) => {
    const session = agentRouteSessions.open(owner, request);
    router.push({
      params: { ...routeParams, sessionId: session.id },
      pathname: "/threads/[connectionId]/[threadId]/agents",
    });
  });
  const openAttachments = useEvent<ConversationRouteNavigation["openAttachments"]>((request) => {
    const session = attachmentRouteSessions.open(owner, request);
    router.push({
      params: { ...routeParams, sessionId: session.id },
      pathname: "/threads/[connectionId]/[threadId]/attachments",
    });
  });
  const openChanges = useEvent<ConversationRouteNavigation["openChanges"]>((request) => {
    const session = changesRouteSessions.open(owner, request);
    router.push({
      params: { ...routeParams, sessionId: session.id },
      pathname: "/threads/[connectionId]/[threadId]/changes",
    });
  });
  const openCodeDocument = useEvent<ConversationRouteNavigation["openCodeDocument"]>((request) => {
    const session = changesRouteSessions.open(owner, request);
    router.push({
      params: { ...routeParams, sessionId: session.id },
      pathname: "/threads/[connectionId]/[threadId]/documents/[sessionId]",
    });
  });
  const openContent = useEvent<ConversationRouteNavigation["openContent"]>((request) => {
    const session = contentRouteSessions.open(owner, request);
    router.push({
      params: { ...routeParams, sessionId: session.id },
      pathname: "/threads/[connectionId]/[threadId]/content/[sessionId]",
    });
  });
  const openTaskOutput = useEvent<ConversationRouteNavigation["openTaskOutput"]>((request) => {
    const session = taskOutputRouteSessions.open(owner, request);
    router.push({
      params: { ...routeParams, sessionId: session.id },
      pathname: "/threads/[connectionId]/[threadId]/task-output/[sessionId]",
    });
  });
  const openDocument = useEvent<ConversationRouteNavigation["openDocument"]>((request) => {
    const session = documentRouteService.open(owner, request);
    router.push({
      params: { ...routeParams, sessionId: session.id },
      pathname: "/threads/[connectionId]/[threadId]/documents/[sessionId]",
    });
  });
  const openDrawing = useEvent<ConversationRouteNavigation["openDrawing"]>((request) => {
    pushDrawingRoute(router, { owner, request, routeParams });
  });
  const openTerminal = useEvent<ConversationRouteNavigation["openTerminal"]>((request) => {
    const session = terminalRouteSessions.open(owner, request);
    router.push({
      params: { ...routeParams, sessionId: session.id },
      pathname: "/threads/[connectionId]/[threadId]/terminal",
    });
  });
  const openTool = useEvent<ConversationRouteNavigation["openTool"]>((request) => {
    const session = composerToolRouteSessions.open(owner, request);
    router.push({
      params: { ...routeParams, sessionId: session.id },
      pathname: TOOL_PATHS[request.kind],
    });
  });
  const openTurnChanges = useEvent<ConversationRouteNavigation["openTurnChanges"]>((request) => {
    const session = changesRouteSessions.open(owner, request);
    router.push({
      params: {
        ...routeParams,
        sessionId: session.id,
        turnId: request.target.turnId,
      },
      pathname: "/threads/[connectionId]/[threadId]/changes/turns/[turnId]",
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
    openTaskOutput,
    openTerminal,
    openTool,
    openTurnChanges,
  };
}
