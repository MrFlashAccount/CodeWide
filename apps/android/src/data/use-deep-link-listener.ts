import { useEffect } from "react";
import { Linking } from "react-native";

import { useEvent } from "../react/useEvent";

/** Owns the process-level React Native deep-link subscription. */
export function useDeepLinkListener(onUrl: (url: string | null) => void): void {
  const receive = useEvent(onUrl);
  useEffect(() => {
    let active = true;
    Linking.getInitialURL().then(
      (url) => {
        if (active) {
          receive(url);
        }
      },
      () => {
        if (active) {
          receive(null);
        }
      },
    );
    const subscription = Linking.addEventListener("url", ({ url }) => {
      receive(url);
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [receive]);
}
