import type { ReactNode } from "react";
import type { StoredConnection } from "../../data/connection-profile-types";
import {
  retryStartup,
  workspaceRuntime,
  type WorkspaceRuntimeSnapshot,
} from "../../data/workspace-runtime";
import { useConnectionActions } from "../connections/connectionActions";
import type { ThreadListServer } from "../connections/connectionPresentation";
import { ConnectionSheet } from "../connections/ConnectionSheet";
import { useNewChat } from "../projects/newChat";
import { NewThreadServerSheet } from "../projects/NewThreadServerSheet";
import { useProjectWorkspace } from "../projects/projectWorkspace";
import { SubscribedConnectionSettings } from "../settings/SettingsFeature";
import { workspaceFeatures as features } from "./createWorkspaceFeatures";
/** Arranges explicit connection, settings and new-thread overlays without owning their policies. */
export function WorkspaceOverlays({
  connectionActions,
  settingsVisible,
  setSettingsVisible,
  newThreadVisible,
  setNewThreadVisible,
  settingsConnections,
  runtime,
  projectManagementSheet,
  servers,
  openNewChat,
  defaultProjectCwd,
}: {
  connectionActions: ReturnType<typeof useConnectionActions>;
  settingsVisible: boolean;
  setSettingsVisible(visible: boolean): void;
  newThreadVisible: boolean;
  setNewThreadVisible(visible: boolean): void;
  settingsConnections: StoredConnection[];
  runtime: Pick<WorkspaceRuntimeSnapshot, "ready" | "error" | "accountRateLimits">;
  projectManagementSheet: ReactNode;
  servers: ThreadListServer[];
  openNewChat: ReturnType<typeof useNewChat>["openNewChat"];
  defaultProjectCwd: ReturnType<typeof useProjectWorkspace>["defaultProjectCwd"];
}) {
  return (
    <>
      {connectionActions.connectionSheetVisible && (
        <ConnectionSheet
          visible={connectionActions.connectionSheetVisible}
          localReady={runtime.ready && runtime.error === null}
          localError={runtime.error}
          onRetryStartup={retryStartup}
          onClose={connectionActions.closeConnectionSheet}
          onSave={connectionActions.saveConnection}
          initialCode={connectionActions.pendingPairingCode}
        />
      )}
      {projectManagementSheet}
      {settingsVisible && (
        <SubscribedConnectionSettings
          connections={settingsConnections}
          onClose={() => setSettingsVisible(false)}
          onAddServer={() => {
            setSettingsVisible(false);
            connectionActions.openConnectionSheet();
          }}
          onToggle={connectionActions.toggleConnection}
          onReconnect={connectionActions.reconnectSavedConnection}
          onDelete={connectionActions.deleteSavedConnection}
          onUpdate={connectionActions.updateSavedConnection}
          onMove={connectionActions.moveSavedConnection}
          accountRateLimitsDatabase={runtime.accountRateLimits}
          {...(!workspaceRuntime.native
            ? {}
            : {
                onRefreshAccountPool: features.accounts.refreshAccountPool,
                onStartAccountLogin: features.accounts.startAccountLogin,
                onCancelAccountLogin: features.accounts.cancelAccountLogin,
                onActivateAccountProfile: features.accounts.activateAccountProfile,
                onUpdateAccountProfile: features.accounts.updateAccountProfile,
                onRemoveAccountProfile: features.accounts.removeAccountProfile,
              })}
        />
      )}
      {newThreadVisible && (
        <NewThreadServerSheet
          visible={newThreadVisible}
          servers={servers}
          onClose={() => setNewThreadVisible(false)}
          onSelect={async (serverId) => await openNewChat(serverId, defaultProjectCwd(serverId))}
        />
      )}
    </>
  );
}
