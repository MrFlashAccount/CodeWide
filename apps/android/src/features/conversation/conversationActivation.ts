import type { MainThreadReadCapabilities } from "./mainThreadReadCapabilities";
import type { ConversationSurfaceCapabilities } from "./conversationSurfaceCapabilities";
import type { ComposerWorkspaceCapabilities } from "../composer/composerWorkspaceCapabilities";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useConversationOwner } from "../../ui/use-conversation-owner";
import { useAppVoiceInputRuntime, type AppVoiceInputRuntime } from "../../ui/VoiceInputRuntime";
import { useWindowLayout } from "../workspace/useWindowLayout";
import { useConversationPaneGeometry } from "./timeline/timelineViewport";

export function useConversationActivation({
  surfaceInputs,
  readInputs,
  composerInputs,
}: {
  surfaceInputs: ConversationSurfaceCapabilities;
  readInputs: MainThreadReadCapabilities;
  composerInputs: ComposerWorkspaceCapabilities;
}) {
  const windowLayout = useWindowLayout();
  const parentVoiceInputRuntime = useAppVoiceInputRuntime();
  const conversationInsets = useSafeAreaInsets();
  const draftConnectionId = surfaceInputs.server?.id ?? null;
  const draftThreadId = surfaceInputs.thread?.id ?? null;
  const animateLiveUpdates =
    surfaceInputs.server?.status === "live" && !readInputs.liveTextRecovery;
  const composerScope = `${draftConnectionId ?? "no-connection"}\u0000${draftThreadId ?? "no-thread"}`;
  const appVoiceInputRuntime: AppVoiceInputRuntime = {
    controller: parentVoiceInputRuntime?.controller ?? composerInputs.voiceController,
    resources: parentVoiceInputRuntime?.resources ?? null,
    scopePrefix: composerScope,
    thread: readInputs.remoteThread ?? null,
    ...(composerInputs.onStartVoiceTranscription === undefined
      ? {}
      : { startRemote: composerInputs.onStartVoiceTranscription }),
  };
  const conversationOwner = useConversationOwner(composerScope);
  const conversationPaneGeometryBinding = useConversationPaneGeometry();
  const timelineCompact =
    surfaceInputs.compact || conversationPaneGeometryBinding.narrowConversationPane;
  return {
    composerScope,
    draftConnectionId,
    draftThreadId,
    conversationOwner,
    conversationPaneGeometryBinding,
    appVoiceInputRuntime,
    timelineCompact,
    animateLiveUpdates,
    windowLayout,
    conversationInsets,
  };
}
