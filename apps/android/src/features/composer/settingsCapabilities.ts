import type { StoredComposerPreferences } from "../../data/thread-ui-state-types";
import type { ThreadSettings, TurnControlsValue } from "../../data/turn-controls-types";
import type { WorkspaceResourceDatabase } from "../../data/workspace-resource-database";
import type { ConversationOwner } from "../../ui/use-conversation-owner";
import type { ComposerSessionBinding } from "./composerSession";

/** Settings read and rollback share the captured draft preferences and mounted owner. */
export type ComposerSettingsCapabilities = {
  composerPreferences: StoredComposerPreferences;
  composerScope: string;
  composerSession: ComposerSessionBinding;
  controlsResourceId: string | null;
  conversationOwner: ConversationOwner;
  cwd: string;
  draftConnectionId: string | null;
  draftThreadId: string | null;
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
