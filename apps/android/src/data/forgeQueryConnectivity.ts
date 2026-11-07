import { addEventListener } from "@react-native-community/netinfo";
import { onlineManager } from "@tanstack/react-query";

/** Installs the process-lifetime network source before persisted mutations restore. */
export function configureForgeQueryConnectivity(): void {
  // Start conservatively: a restored mutation must not run before NetInfo has
  // published the first real device state.
  onlineManager.setOnline(false);
  onlineManager.setEventListener((setOnline) =>
    addEventListener((state) => {
      setOnline(state.isConnected === true);
    }),
  );
}
