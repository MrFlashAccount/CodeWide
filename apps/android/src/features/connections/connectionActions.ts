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
  addConnection: (input: ConnectionInput) => Promise<StoredConnection>;
  deleteConnection: (connectionId: string) => Promise<void>;
  moveConnection: (connectionId: string, direction: -1 | 1) => Promise<void>;
  reconnectConnection: (connectionId: string) => Promise<void>;
  setConnectionEnabled: (connectionId: string, enabled: boolean) => Promise<void>;
  updateConnection: (connectionId: string, input: ConnectionUpdateInput) => Promise<void>;
  updateConnectionProfile: (
    connectionId: string,
    displayName: string,
    emoji: string,
  ) => Promise<void>;
};

/** Binds connection commands; route-local pairing state is owned by the pairing service. */
export function useConnectionActions(
  actions: ConnectionActions,
  connections: readonly StoredConnection[],
  onAdded: (connection: StoredConnection) => void,
) {
  const saveConnection = useEvent(async (input: ConnectionInput): Promise<void> => {
    const added = await actions.addConnection(input);
    onAdded(added);
  });
  const toggleConnection = useEvent(
    async (connectionId: string, enabled: boolean): Promise<void> => {
      await actions.setConnectionEnabled(connectionId, enabled);
    },
  );
  const reconnectSavedConnection = useEvent(async (connectionId: string): Promise<void> => {
    await actions.reconnectConnection(connectionId);
  });
  const deleteSavedConnection = useEvent(async (connectionId: string): Promise<void> => {
    await actions.deleteConnection(connectionId);
  });
  const updateSavedConnection = useEvent(
    async (connectionId: string, input: ConnectionUpdateInput): Promise<void> => {
      const current = connections.find((connection) => connection.id === connectionId);
      if (current === undefined) {
        throw new Error("Connection not found");
      }
      if (isProfileOnlyConnectionUpdate(input, current)) {
        const profile = validateConnectionProfile(input.displayName, input.emoji);
        await actions.updateConnectionProfile(connectionId, profile.displayName, profile.emoji);
        return;
      }
      await actions.updateConnection(connectionId, input);
    },
  );
  const moveSavedConnection = useEvent(
    async (connectionId: string, direction: -1 | 1): Promise<void> => {
      await actions.moveConnection(connectionId, direction);
    },
  );
  return {
    deleteSavedConnection,
    moveSavedConnection,
    reconnectSavedConnection,
    saveConnection,
    toggleConnection,
    updateSavedConnection,
  };
}
