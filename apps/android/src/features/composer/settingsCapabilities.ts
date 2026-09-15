import type { StoredComposerPreferences } from "../../data/thread-ui-state-types";
import type { ThreadSettings, TurnControlsValue } from "../../data/turn-controls-types";
import type { WorkspaceResourceDatabase } from "../../data/workspace-resource-database";
import type { ConversationOwner } from "../../ui/use-conversation-owner";
import type { useComposerDraftState } from "./draft";

/** Settings read and rollback share the captured draft preferences and mounted owner. */
export type ComposerSettingsCapabilities = {
  composerScope: string;
  newChat: boolean;
  cwd: string;
  draftConnectionId: string | null;
  draftThreadId: string | null;
  workspaceResources: WorkspaceResourceDatabase | null;
  controlsResourceId: string | null;
  composerPreferences: StoredComposerPreferences;
  latestComposerPreferencesRef: ReturnType<
    typeof useComposerDraftState
  >["latestComposerPreferencesRef"];
  conversationOwner: ConversationOwner;
  onLoadControls: ((cwd: string) => Promise<TurnControlsValue>) | undefined;
  onUpdateSettings: ((settings: ThreadSettings) => Promise<void>) | undefined;
  saveComposerPreferences:
    | ((
        connectionId: string,
        threadId: string,
        preferences: StoredComposerPreferences,
      ) => Promise<void>)
    | undefined;
};
