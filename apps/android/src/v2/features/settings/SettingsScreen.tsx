import type { ReactNode } from "react";
import { Text } from "react-native";

import { WorkspaceView } from "../../../presentation/layouts/WorkspaceView";
import { SettingsView } from "../../../presentation/settings/SettingsView";

interface SettingsScreenProps {
  generationControl: ReactNode;
}

export function SettingsScreen({ generationControl }: SettingsScreenProps): React.JSX.Element {
  return (
    <WorkspaceView title="Settings">
      <SettingsView>
        <Text style={{ color: "#fafafa" }}>Interface generation</Text>
        {generationControl}
      </SettingsView>
    </WorkspaceView>
  );
}
