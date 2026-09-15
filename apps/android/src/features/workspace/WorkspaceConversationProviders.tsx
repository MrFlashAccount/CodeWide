import { useEvent } from "../../react/useEvent";
import { useSelector } from "@legendapp/state/react";
import { workspaceFeatures as features } from "./createWorkspaceFeatures";
import { type ReactNode } from "react";
import { workspaceRuntime, type WorkspaceRuntimeSnapshot } from "../../data/workspace-runtime";
import { AppVoiceInputProvider, type AppVoiceInputRuntime } from "../../ui/VoiceInputRuntime";
import { workspaceConversationScope } from "../navigation/conversationScope";
import { type ThreadNavigationModel } from "../navigation/threadNavigation";
import { BrowserFeedbackContext } from "../ports/browser/BrowserFeedbackContext";
import type { BrowserFeedbackCapability } from "../ports/browser/feedback";

export function WorkspaceConversationProviders({
  navigation,
  runtime,
  fallbackServerId,
  feedback,
  children,
}: {
  navigation: ThreadNavigationModel;
  runtime: Pick<WorkspaceRuntimeSnapshot, "resources">;
  fallbackServerId: string;
  feedback: Omit<BrowserFeedbackCapability, "initialDestination">;
  children: ReactNode;
}) {
  const destination = useSelector(() => navigation.destination$.get());
  const { connectionId: activeConnectionId, composerThreadId } = workspaceConversationScope(
    destination,
    fallbackServerId,
  );
  const startRemote = useEvent<NonNullable<AppVoiceInputRuntime["startRemote"]>>(
    async (listener, options) =>
      await features.composer.startVoiceTranscription(
        activeConnectionId,
        composerThreadId ?? "",
        listener,
        options,
      ),
  );
  const voiceInputRuntime: AppVoiceInputRuntime = {
    controller: workspaceRuntime.voiceController,
    resources: runtime.resources,
    scopePrefix: `${activeConnectionId || "local"}\u0000${composerThreadId ?? "workspace"}`,
    // The workspace provider never materializes a selected chat. Each
    // ConversationPane installs its own thread-scoped provider below Suspense.
    thread: null,
    ...(workspaceRuntime.native && activeConnectionId !== ""
      ? {
          startRemote,
        }
      : {}),
  };

  return (
    <BrowserFeedbackContext.Provider
      value={{
        ...feedback,
        initialDestination: destination.kind === "thread" ? destination.key : "",
      }}
    >
      <AppVoiceInputProvider runtime={voiceInputRuntime}>{children}</AppVoiceInputProvider>
    </BrowserFeedbackContext.Provider>
  );
}
