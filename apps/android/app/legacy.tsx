import { Redirect } from "expo-router";
import { useEffect } from "react";

import { CodeWideScreen } from "../src/CodeWideScreen";
import { activateRuntime, stopRuntime } from "../src/boot/runtimeSlot";
import { useUiGenerationSnapshot } from "../src/boot/useUiGenerationSnapshot";
import {
  startLegacyNativeRuntimeResources,
  stopLegacyNativeRuntimeResources,
} from "../src/native/native-transport";

export default function LegacyRoute(): React.JSX.Element {
  const generation = useUiGenerationSnapshot();
  if (generation.status === "loading") return <></>;
  if (generation.status === "error") return <Redirect href="/" />;
  if (generation.generation === "v2") return <Redirect href="/servers" />;
  return <LegacyApplication />;
}

function LegacyApplication(): React.JSX.Element {
  useEffect(() => {
    activateRuntime("legacy", () => ({
      start: startLegacyNativeRuntimeResources,
      stop: stopLegacyNativeRuntimeResources,
    })).catch(() => undefined);
    return () => {
      stopRuntime("legacy").catch(() => undefined);
    };
  }, []);
  return <CodeWideScreen />;
}
