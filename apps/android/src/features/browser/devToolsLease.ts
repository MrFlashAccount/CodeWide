import {
  startNativeBrowserDevToolsBridge,
  stopNativeBrowserDevToolsBridge,
  type NativeBrowserDevToolsBridge,
} from "../../native/native-transport";

type SharedBridge = { readonly endpoint: Promise<NativeBrowserDevToolsBridge>; leases: number };
let sharedBridge: SharedBridge | null = null;

/** Holds the existing native bridge until every admitted inspection/capture has released it. */
export function retainBrowserDevToolsBridge(): {
  readonly endpoint: Promise<NativeBrowserDevToolsBridge>;
  readonly release: () => void;
} {
  sharedBridge ??= { endpoint: startNativeBrowserDevToolsBridge(), leases: 0 };
  const bridge = sharedBridge;
  bridge.leases += 1;
  let retained = true;
  return {
    endpoint: bridge.endpoint,
    release() {
      if (!retained) {
        return;
      }
      retained = false;
      bridge.leases -= 1;
      if (bridge.leases === 0 && sharedBridge === bridge) {
        // Native acquisition may still be pending when its page disappears.
        void bridge.endpoint.then(
          () => {
            if (bridge.leases === 0 && sharedBridge === bridge) {
              sharedBridge = null;
              stopNativeBrowserDevToolsBridge();
            }
          },
          () => {
            if (bridge.leases === 0 && sharedBridge === bridge) {
              sharedBridge = null;
            }
          },
        );
      }
    },
  };
}
