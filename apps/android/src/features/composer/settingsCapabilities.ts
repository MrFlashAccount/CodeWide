import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";
import type { StoredComposerPreferences } from "../../data/thread-ui-state-types";
import type { LoadTurnControls, ThreadSettings } from "../../data/turn-controls-types";
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
  onLoadControls: LoadTurnControls | undefined;
  /**
   * Resolves when the server accepts the change and rejects when it refuses
   * it; stays pending while the durable command waits for a connection.
   */
  onUpdateSettings: ((settings: ThreadSettings) => Promise<void>) | undefined;
  /** The conversation's thread with its server settings; absent in a new chat. */
  remoteThread: Thread | null | undefined;
  saveComposerPreferences:
    | ((
        connectionId: string,
        threadId: string,
        preferences: StoredComposerPreferences,
      ) => Promise<void>)
    | undefined;
  workspaceResources: WorkspaceResourceDatabase | null;
};
