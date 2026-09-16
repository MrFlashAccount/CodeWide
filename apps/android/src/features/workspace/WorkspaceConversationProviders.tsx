import { useEvent } from "../../react/useEvent";
import { workspaceFeatures as features } from "./createWorkspaceFeatures";
import type { ReactNode } from "react";
import { workspaceRuntime, type WorkspaceRuntimeSnapshot } from "../../data/workspace-runtime";
import { AppVoiceInputProvider, type AppVoiceInputRuntime } from "../../ui/VoiceInputRuntime";
import { BrowserFeedbackContext } from "../ports/browser/BrowserFeedbackContext";
import type { BrowserFeedbackCapability } from "../ports/browser/feedback";

export function WorkspaceConversationProviders({
  activeConnectionId,
  children,
  composerThreadId,
  feedback,
  initialBrowserDestination,
  runtime,
}: {
  activeConnectionId: string;
  children: ReactNode;
  composerThreadId: string | null;
  feedback: Omit<BrowserFeedbackCapability, "initialDestination">;
  initialBrowserDestination: string;
  runtime: Pick<WorkspaceRuntimeSnapshot, "resources">;
}) {
  const startRemote = useEvent<NonNullable<AppVoiceInputRuntime["startRemote"]>>(
    async (listener, options) =>
      features.composer.startVoiceTranscription(
        activeConnectionId,
        composerThreadId ?? "",
        listener,
        options,
      ),
  );
  const voiceInputRuntime: AppVoiceInputRuntime = {
    controller: workspaceRuntime.voiceController,
    resources: runtime.resources,
    scopePrefix: `${activeConnectionId === "" ? "local" : activeConnectionId}\u0000${composerThreadId ?? "workspace"}`,
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
        initialDestination: initialBrowserDestination,
      }}
    >
      <AppVoiceInputProvider runtime={voiceInputRuntime}>{children}</AppVoiceInputProvider>
    </BrowserFeedbackContext.Provider>
  );
}
