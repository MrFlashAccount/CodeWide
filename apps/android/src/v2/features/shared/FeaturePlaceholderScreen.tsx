import { Text } from "react-native";

import { WorkspaceView } from "../../ui/layouts/WorkspaceView";

export function FeaturePlaceholderScreen({
  detail,
  title,
}: {
  detail: string;
  title: string;
}): React.JSX.Element {
  return (
    <WorkspaceView title={title}>
      <Text style={{ color: "#a1a1aa", padding: 20 }}>{detail}</Text>
    </WorkspaceView>
  );
}
