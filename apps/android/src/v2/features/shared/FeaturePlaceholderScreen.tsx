import { Text } from "react-native";

import { WorkspaceView } from "../../../presentation/layouts/WorkspaceView";

interface FeaturePlaceholderScreenProps {
  detail: string;
  title: string;
}

export function FeaturePlaceholderScreen({
  detail,
  title,
}: FeaturePlaceholderScreenProps): React.JSX.Element {
  return (
    <WorkspaceView title={title}>
      <Text style={{ color: "#a1a1aa", padding: 20 }}>{detail}</Text>
    </WorkspaceView>
  );
}
