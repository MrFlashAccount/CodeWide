import { useState } from "react";
import type { StoredConnection } from "../../data/connection-profile-types";
import {
  isProfileOnlyConnectionUpdate,
  validateConnectionProfile,
  type ConnectionInput,
  type ConnectionUpdateInput,
} from "../../data/connection-validation";
import { useEvent } from "../../react/useEvent";

/** Connection intents preserve the lower credential/session authority. */
export type ConnectionActions = {
  addConnection(input: ConnectionInput): Promise<StoredConnection>;
  setConnectionEnabled(connectionId: string, enabled: boolean): Promise<void>;
  reconnectConnection(connectionId: string): Promise<void>;
  deleteConnection(connectionId: string): Promise<void>;
  updateConnectionProfile(connectionId: string, displayName: string, emoji: string): Promise<void>;
  updateConnection(connectionId: string, input: ConnectionUpdateInput): Promise<void>;
  moveConnection(connectionId: string, direction: -1 | 1): Promise<void>;
};

/** Owns pairing visibility and profile-only versus credential-changing edit admission. */
export function useConnectionActions(
  actions: ConnectionActions,
  connections: readonly StoredConnection[],
  onAdded: (connection: StoredConnection) => void,
) {
  const [connectionSheetVisible, setConnectionSheetVisible] = useState(false);
  const [pendingPairingCode, setPendingPairingCode] = useState<string | null>(null);
  const openConnectionSheet = useEvent(() => setConnectionSheetVisible(true));
  const openPairingCode = useEvent((code: string) => {
    setPendingPairingCode(code);
    setConnectionSheetVisible(true);
  });
  const closeConnectionSheet = useEvent(() => {
    setConnectionSheetVisible(false);
    setPendingPairingCode(null);
  });
  const saveConnection = useEvent(async (input: ConnectionInput): Promise<void> => {
    const added = await actions.addConnection(input);
    onAdded(added);
  });
  const toggleConnection = useEvent(
    async (connectionId: string, enabled: boolean): Promise<void> =>
      await actions.setConnectionEnabled(connectionId, enabled),
  );
  const reconnectSavedConnection = useEvent(
    async (connectionId: string): Promise<void> => await actions.reconnectConnection(connectionId),
  );
  const deleteSavedConnection = useEvent(
    async (connectionId: string): Promise<void> => await actions.deleteConnection(connectionId),
  );
  const updateSavedConnection = useEvent(
    async (connectionId: string, input: ConnectionUpdateInput): Promise<void> => {
      const current = connections.find((connection) => connection.id === connectionId);
      if (current === undefined) throw new Error("Connection not found");
      if (isProfileOnlyConnectionUpdate(input, current)) {
        const profile = validateConnectionProfile(input.displayName, input.emoji);
        return await actions.updateConnectionProfile(
          connectionId,
          profile.displayName,
          profile.emoji,
        );
      }
      await actions.updateConnection(connectionId, input);
    },
  );
  const moveSavedConnection = useEvent(
    async (connectionId: string, direction: -1 | 1): Promise<void> =>
      await actions.moveConnection(connectionId, direction),
  );
  return {
    connectionSheetVisible,
    pendingPairingCode,
    openConnectionSheet,
    openPairingCode,
    closeConnectionSheet,
    saveConnection,
    toggleConnection,
    reconnectSavedConnection,
    deleteSavedConnection,
    updateSavedConnection,
    moveSavedConnection,
  };
}
