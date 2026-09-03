import { router, useGlobalSearchParams, usePathname } from "expo-router";
import type { PropsWithChildren } from "react";

import { useEvent } from "../../../react/useEvent";
import type { CommandSettlement } from "../../application/commandCorrelation";
import { useV2Runtime } from "../../application/react/V2RuntimeContext";
import type { V2Runtime } from "../../application/v2Runtime";
import { threadId, type SavedServerId } from "../../domain/ids";
import { qualifiedThread } from "../../domain/qualifiedThread";
import { threadDestination } from "../navigation/routeDestinations";
import { savedServerRouteParam, type RawRouteParam } from "../navigation/routeParams";
import { defaultNewThreadSettings } from "../threadList/newThreadControls";
import { completedThreadId, newThreadTerminalMessage } from "../threadList/newThreadWorkspace";
import { RenderRecoveryProvider, type RecoveryHandler } from "../../ui/RecoverableRenderBoundary";
import { createRenderRecoveryHandler } from "../../ui/renderRecoveryCapability";
import type { RenderRepairChatRequest } from "../../ui/renderRecoveryCapability";
import { selectRecoveryServer } from "./renderRecoveryServer";

interface RecoveryRouteParams {
  savedServerId?: RawRouteParam;
  threadId?: RawRouteParam;
}

/** Owns the authoritative V2 command and typed route used by render-repair actions. */
export function V2RenderRecoveryProvider(props: PropsWithChildren): React.JSX.Element {
  const runtime = useV2Runtime();
  const pathname = usePathname();
  const routeParams = useGlobalSearchParams();
  const params: RecoveryRouteParams = {
    savedServerId: routeParams.savedServerId,
    threadId: routeParams.threadId,
  };
  const openRepairChat = useEvent((request: RenderRepairChatRequest) =>
    createRepairChat(runtime, preferredSavedServerId(runtime, params.savedServerId), request),
  );
  const recover = useEvent<RecoveryHandler>(async (failure) => {
    const handler = createRenderRecoveryHandler({
      context: () => recoveryRouteContext(pathname, params),
      openRepairChat,
    });
    await handler(failure);
  });
  return <RenderRecoveryProvider onFix={recover}>{props.children}</RenderRecoveryProvider>;
}

async function createRepairChat(
  runtime: V2Runtime,
  preferredId: SavedServerId | null,
  request: RenderRepairChatRequest,
): Promise<void> {
  const server = selectRecoveryServer(runtime.savedServers.snapshot().value, preferredId);
  if (server === null) {
    throw new Error("Open one enabled server before creating a repair chat.");
  }
  const settlement = await runtime.commands.executeCorrelated(
    { savedServerId: server.id, surface: "newThread", threadId: null },
    {
      input: [{ kind: "text", text: request.prompt }],
      intent: "chat",
      kind: "turn.submit",
      settings: defaultNewThreadSettings(),
      threadId: null,
      workspace: null,
    },
  );
  const createdThreadId = createdThread(settlement);
  const owner = qualifiedThread(server.id, threadId(createdThreadId));
  router.push(threadDestination(owner));
  await renameRepairThread(runtime, server.id, createdThreadId, request.title);
}

function createdThread(settlement: CommandSettlement): string {
  if (settlement.kind !== "terminal") throw new Error(settlement.failure.message);
  const created = completedThreadId(settlement.frame);
  if (created === null) throw new Error(newThreadTerminalMessage(settlement.frame));
  return created;
}

async function renameRepairThread(
  runtime: V2Runtime,
  savedServerId: SavedServerId,
  createdThreadId: string,
  title: string,
): Promise<void> {
  try {
    await runtime.commandActivations.execute(savedServerId, {
      change: { kind: "title", title },
      kind: "thread.update",
      threadId: createdThreadId,
    });
  } catch {
    // The repair thread is already authoritative; title decoration must not hide or duplicate it.
  }
}

function preferredSavedServerId(
  runtime: V2Runtime,
  routeValue: RawRouteParam,
): SavedServerId | null {
  const routeId = savedServerRouteParam(routeValue);
  if (routeId !== null) return routeId;
  const selection = runtime.selection.snapshot().value;
  return selection.kind === "savedServer" ? selection.savedServerId : null;
}

function recoveryRouteContext(pathname: string, params: RecoveryRouteParams): string {
  const context = [`Route: ${pathname}`];
  if (typeof params.savedServerId === "string") {
    context.push(`Saved server: ${params.savedServerId}`);
  }
  if (typeof params.threadId === "string") context.push(`Thread: ${params.threadId}`);
  return context.join("\n");
}
