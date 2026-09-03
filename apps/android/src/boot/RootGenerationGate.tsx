import { Redirect } from "expo-router";
import { useSyncExternalStore } from "react";
import { StyleSheet, View } from "react-native";

import { ResourceStateView } from "../v2/presentation/feedback/ResourceStateView";
import {
  retryUiGeneration,
  subscribeUiGeneration,
  uiGenerationSnapshot,
  type UiGenerationSnapshot,
} from "./uiGenerationResource";

interface RootGenerationStatusViewProps {
  onRetry(): void;
  snapshot: Exclude<UiGenerationSnapshot, { status: "ready" }>;
}

export function RootGenerationGate(): React.JSX.Element {
  const snapshot = useSyncExternalStore(
    subscribeUiGeneration,
    uiGenerationSnapshot,
    uiGenerationSnapshot,
  );
  if (snapshot.status === "ready") {
    const destination = snapshot.generation === "v2" ? "/servers" : "/legacy";
    return <Redirect href={destination} />;
  }
  return <RootGenerationStatusView onRetry={retryUiGeneration} snapshot={snapshot} />;
}

export function RootGenerationStatusView(props: RootGenerationStatusViewProps): React.JSX.Element {
  const { onRetry, snapshot } = props;
  return (
    <View style={styles.root} testID="generation-boot-state">
      <ResourceStateView
        message={snapshot.status === "error" ? snapshot.message : "Starting CodeWide…"}
        onRetry={onRetry}
        status={snapshot.status}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
