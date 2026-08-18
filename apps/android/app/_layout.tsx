import "react-native-gesture-handler";

import { useFonts } from "expo-font";
import { Stack, type ErrorBoundaryProps } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { startOtaPrefetchRuntime } from "../src/data/use-ota-prefetch";
import {
  AppErrorBoundary,
  GlobalErrorBoundaryHost,
  RootFailure,
} from "../src/ui/AppErrorBoundary";
import {
  installGlobalErrorHandler,
  reportGlobalError,
} from "../src/ui/global-error-store";
import { HeroUIRoot } from "../src/ui/HeroUIRoot";

installGlobalErrorHandler();
try {
  startOtaPrefetchRuntime();
} catch (error) {
  reportGlobalError(error, "ota-prefetch", true);
}

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <RootFailure
      componentStack="Expo Router root layout boundary"
      error={error}
      onRetry={retry}
    />
  );
}

export default function RootLayout() {
  return (
    <GlobalErrorBoundaryHost>
      <AppErrorBoundary>
        <RootApplication />
      </AppErrorBoundary>
    </GlobalErrorBoundaryHost>
  );
}

function RootApplication() {
  const [fontsLoaded, fontError] = useFonts({
    "RobotoFlex-Regular": require("../assets/fonts/RobotoFlex-Regular.ttf"),
    "RobotoFlex-Medium": require("../assets/fonts/RobotoFlex-Medium.ttf"),
    "RobotoFlex-SemiBold": require("../assets/fonts/RobotoFlex-SemiBold.ttf"),
  });

  if (!fontsLoaded && fontError === null) {
    return (
      <View style={styles.boot} testID="root-boot-state">
        <View style={styles.bootMark}>
          <Text style={styles.bootPrompt}>›</Text>
          <View style={styles.bootCursor} />
        </View>
        <Text style={styles.bootTitle}>CodeWide</Text>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <SafeAreaProvider>
          <HeroUIRoot>
            <StatusBar style="light" />
            <Stack screenOptions={{ headerShown: false }} />
          </HeroUIRoot>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  boot: {
    alignItems: "center",
    backgroundColor: "#101011",
    flex: 1,
    gap: 12,
    justifyContent: "center",
  },
  bootMark: {
    alignItems: "center",
    borderColor: "#f4f4f5",
    borderRadius: 36,
    borderWidth: 2,
    flexDirection: "row",
    height: 72,
    justifyContent: "center",
    width: 72,
  },
  bootPrompt: {
    color: "#f4f4f5",
    fontSize: 34,
    fontWeight: "400",
    lineHeight: 38,
    marginLeft: -2,
    marginTop: -3,
  },
  bootCursor: {
    backgroundColor: "#58c7ff",
    borderRadius: 2,
    height: 3,
    marginLeft: 2,
    marginTop: 14,
    width: 14,
  },
  bootTitle: {
    color: "#f4f4f5",
    fontSize: 16,
    fontWeight: "600",
  },
});
