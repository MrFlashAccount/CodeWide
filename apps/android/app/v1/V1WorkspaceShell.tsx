import { Slot } from "expo-router";
import { View } from "react-native";

import { workspaceRuntime } from "../../src/data/workspace-runtime";
import {
  WorkspaceRouteResourcesContext,
  type WorkspaceRouteResources,
} from "../../src/services/workspace/workspaceRouteResources";
import { RenderRecoveryProvider } from "../../src/ui/RecoverableRenderBoundary";
import { WorkspaceVoiceAura } from "../../src/ui/WorkspaceVoiceAura";
import { v1WorkspaceShellStyles as styles } from "./V1WorkspaceShell.styles";

type V1WorkspaceShellProps = {
  readonly children: React.JSX.Element;
  readonly pathname: string;
  readonly resources: WorkspaceRouteResources;
};

/** Owns the persistent V1 visual shell around route destinations. */
export function V1WorkspaceShell(props: V1WorkspaceShellProps): React.JSX.Element {
  const { resources } = props;
  return (
    <WorkspaceRouteResourcesContext.Provider value={resources}>
      <V1WorkspaceRecovery {...props} />
    </WorkspaceRouteResourcesContext.Provider>
  );
}

function V1WorkspaceRecovery(props: V1WorkspaceShellProps): React.JSX.Element {
  return (
    <RenderRecoveryProvider onFix={props.resources.recovery.createRenderFailureFixThread}>
      <V1WorkspaceChrome {...props} />
    </RenderRecoveryProvider>
  );
}

function V1WorkspaceChrome(props: V1WorkspaceShellProps): React.JSX.Element {
  const { resources } = props;
  return (
    <WorkspaceVoiceAura
      controller={workspaceRuntime.voiceController}
      resources={resources.runtime.resources}
    >
      <View
        // WHY: This style is render-derived from safe-area state; React Compiler owns its identity.
        // oxlint-disable-next-line react-doctor/jsx-no-new-array-as-prop
        style={[
          styles.root,
          {
            paddingBottom: resources.insets.bottom,
            paddingTop: resources.insets.top,
          },
        ]}
        testID="v1-workspace-shell"
      >
        <V1WorkspaceDestinations {...props} />
      </View>
    </WorkspaceVoiceAura>
  );
}

function V1WorkspaceDestinations(props: V1WorkspaceShellProps): React.JSX.Element {
  return (
    <View style={props.resources.desktop ? styles.desktopWorkspace : styles.flex}>
      {props.resources.desktop || props.pathname === "/v1" ? props.children : null}
      {props.resources.desktop || props.pathname !== "/v1" ? <Slot /> : null}
    </View>
  );
}
