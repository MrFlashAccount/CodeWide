import { useRouter } from "expo-router";

import { workspaceRuntime } from "../../../src/data/workspace-runtime";
import { SubscribedConnectionSettings } from "../../../src/features/settings/SettingsFeature";
import { workspaceFeatures as features } from "../../../src/features/workspace/createWorkspaceFeatures";
import { useWorkspaceRouteResources } from "../../../src/services/workspace/workspaceRouteResources";

const ACCOUNT_ACTIONS = {
  onActivateAccountProfile: features.accounts.activateAccountProfile.bind(features.accounts),
  onCancelAccountLogin: features.accounts.cancelAccountLogin.bind(features.accounts),
  onRefreshAccountPool: features.accounts.refreshAccountPool.bind(features.accounts),
  onRemoveAccountProfile: features.accounts.removeAccountProfile.bind(features.accounts),
  onStartAccountLogin: features.accounts.startAccountLogin.bind(features.accounts),
  onUpdateAccountProfile: features.accounts.updateAccountProfile.bind(features.accounts),
};
const NO_ACCOUNT_ACTIONS = {};

/** Composes V1 settings from existing command owners while the route owns dismissal. */
export default function V1SettingsRoute(): React.JSX.Element {
  const router = useRouter();
  const resources = useWorkspaceRouteResources();
  return (
    <SubscribedConnectionSettings
      accountRateLimitsDatabase={resources.runtime.accountRateLimits}
      connections={resources.list.settingsConnections}
      onAddServer={() => {
        router.push("/v1/settings/servers/new");
      }}
      onClose={() => {
        router.dismissTo("/v1");
      }}
      onDelete={resources.connectionActions.deleteSavedConnection}
      onMove={resources.connectionActions.moveSavedConnection}
      onReconnect={resources.connectionActions.reconnectSavedConnection}
      onToggle={resources.connectionActions.toggleConnection}
      onUpdate={resources.connectionActions.updateSavedConnection}
      {...(workspaceRuntime.native ? ACCOUNT_ACTIONS : NO_ACCOUNT_ACTIONS)}
    />
  );
}
