import "react-native-gesture-handler";

import { useFonts } from "expo-font";
import { Stack, type ErrorBoundaryProps } from "expo-router";
import { useEffect, useSyncExternalStore } from "react";
import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { startOtaPrefetchRuntime } from "../src/data/use-ota-prefetch";
import { PerformanceExperimentProvider } from "../src/data/performance-experiments";
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
import { AppLockGate } from "../src/ui/AppLockGate";
import {
  loadUiGeneration,
  subscribeUiGeneration,
  uiGenerationSnapshot,
} from "../src/boot/uiGenerationResource";
import { V2Application } from "../src/v2/V2Application";

installGlobalErrorHandler();
try {
  startOtaPrefetchRuntime();
} catch (error) {
  reportGlobalError(error, "ota-prefetch", true);
}

const APPLICATION_BACKGROUND = "#101011";
const ROOT_SCREEN_OPTIONS = {
  contentStyle: { backgroundColor: APPLICATION_BACKGROUND },
  headerShown: false,
} as const;
const V2_ROUTE_SCREEN_OPTIONS = { animation: "none" } as const;
const V2_MODAL_SCREEN_OPTIONS = {
  animation: "none",
  contentStyle: { backgroundColor: "transparent" },
  presentation: "transparentModal",
} as const;

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <RootFailure
      componentStack="Expo Router root layout boundary"
      error={error}
      onRetry={retry}
    />
  );
}

export function SuspenseFallback() {
  return (
    <View style={styles.boot} testID="root-suspense-state">
      <View style={styles.bootMark}>
        <Text style={styles.bootPrompt}>›</Text>
        <View style={styles.bootCursor} />
      </View>
      <Text style={styles.bootTitle}>CodeWide</Text>
    </View>
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
  const generation = useSyncExternalStore(
    subscribeUiGeneration,
    uiGenerationSnapshot,
    uiGenerationSnapshot,
  );
  useEffect(loadUiGeneration, []);

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
    <GestureHandlerRootView style={styles.application}>
      <KeyboardProvider>
        <SafeAreaProvider>
          <HeroUIRoot>
            <PerformanceExperimentProvider>
              <AppLockGate>
                <StatusBar style="light" />
                <V2Application
                  active={generation.status === "ready" && generation.generation === "v2"}
                >
                  <Stack screenOptions={ROOT_SCREEN_OPTIONS}>
                    <Stack.Screen name="(workspace)" options={V2_ROUTE_SCREEN_OPTIONS} />
                    <Stack.Screen name="(modal)" options={V2_MODAL_SCREEN_OPTIONS} />
                  </Stack>
                </V2Application>
              </AppLockGate>
            </PerformanceExperimentProvider>
          </HeroUIRoot>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  application: { backgroundColor: APPLICATION_BACKGROUND, flex: 1 },
  boot: {
    alignItems: "center",
    backgroundColor: APPLICATION_BACKGROUND,
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
