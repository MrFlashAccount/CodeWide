import { useEffect } from "react";

import { CodeWideScreen } from "../src/CodeWideScreen";
import { activateRuntime, stopRuntime } from "../src/boot/runtimeSlot";

export default function LegacyRoute(): React.JSX.Element {
  useEffect(() => {
    activateRuntime("legacy", () => ({ stop: () => undefined })).catch(() => undefined);
    return () => {
      stopRuntime("legacy").catch(() => undefined);
    };
  }, []);
  return <CodeWideScreen />;
}
