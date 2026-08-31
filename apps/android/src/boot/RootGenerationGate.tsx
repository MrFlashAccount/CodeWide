import { Redirect } from "expo-router";
import { useEffect, useSyncExternalStore } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import {
  loadUiGeneration,
  subscribeUiGeneration,
  uiGenerationSnapshot,
} from "./uiGenerationResource";

export function RootGenerationGate(): React.JSX.Element {
  const snapshot = useSyncExternalStore(
    subscribeUiGeneration,
    uiGenerationSnapshot,
    uiGenerationSnapshot,
  );
  useEffect(loadUiGeneration, []);
  if (snapshot.status === "ready") {
    const destination = snapshot.generation === "v2" ? "/servers" : "/legacy";
    return <Redirect href={destination} />;
  }
  return (
    <View style={styles.root} testID="generation-boot-state">
      {snapshot.status === "loading" ? <ActivityIndicator color="#58c7ff" /> : null}
      <Text style={styles.text}>
        {snapshot.status === "error" ? snapshot.message : "Starting CodeWide…"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: "#101011",
  },
  text: { color: "#f4f4f5" },
});
