import { focusManager, QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { type ReactNode, use, useEffect } from "react";
import { AppState, type AppStateStatus } from "react-native";

import { appLogger } from "../observability/logger";
import { useEvent } from "../react/useEvent";

/** Mounts the process query client and maps Android foreground state to Query focus. */
export function ForgeQueryProvider({
  children,
  client,
  restored,
}: {
  readonly children: ReactNode;
  readonly client: QueryClient;
  readonly restored: Promise<void>;
}): React.JSX.Element {
  use(restored);
  const publishFocus = useEvent((state: AppStateStatus): void => {
    focusManager.setFocused(state === "active");
  });
  useEffect(() => {
    publishFocus(AppState.currentState);
    client.resumePausedMutations().catch((error: unknown) => {
      appLogger.errorCaught({ error, event: "forge.mutation.resume_failed" });
    });
    const subscription = AppState.addEventListener("change", publishFocus);
    return () => {
      subscription.remove();
      focusManager.setFocused(undefined);
    };
  }, [client, publishFocus]);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
