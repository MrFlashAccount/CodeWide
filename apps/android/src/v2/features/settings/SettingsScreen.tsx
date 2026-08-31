import type { ReactNode } from "react";
import { Text } from "react-native";

import { WorkspaceView } from "../../ui/layouts/WorkspaceView";
import { SettingsView } from "../../ui/settings/SettingsView";

export function SettingsScreen({
  generationControl,
}: {
  generationControl: ReactNode;
}): React.JSX.Element {
  return (
    <WorkspaceView title="Settings">
      <SettingsView>
        <Text style={{ color: "#fafafa" }}>Interface generation</Text>
        {generationControl}
      </SettingsView>
    </WorkspaceView>
  );
}
