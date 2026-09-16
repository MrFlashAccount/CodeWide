import type { StoredComposerPreferences } from "../../data/thread-ui-state-types";
import type { ThreadSettings, TurnControlsValue } from "../../data/turn-controls-types";
import type { WorkspaceResourceDatabase } from "../../data/workspace-resource-database";
import type { ConversationOwner } from "../../ui/use-conversation-owner";
import type { useComposerDraftState } from "./draft";

/** Settings read and rollback share the captured draft preferences and mounted owner. */
export type ComposerSettingsCapabilities = {
  composerPreferences: StoredComposerPreferences;
  composerScope: string;
  controlsResourceId: string | null;
  conversationOwner: ConversationOwner;
  cwd: string;
  draftConnectionId: string | null;
  draftThreadId: string | null;
  latestComposerPreferencesRef: ReturnType<
    typeof useComposerDraftState
  >["latestComposerPreferencesRef"];
  newChat: boolean;
  onLoadControls: ((cwd: string) => Promise<TurnControlsValue>) | undefined;
  onUpdateSettings: ((settings: ThreadSettings) => Promise<void>) | undefined;
  saveComposerPreferences:
    | ((
        connectionId: string,
        threadId: string,
        preferences: StoredComposerPreferences,
      ) => Promise<void>)
    | undefined;
  workspaceResources: WorkspaceResourceDatabase | null;
};
