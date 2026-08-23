import { useEffect } from "react";
import { Linking } from "react-native";

import { useEvent } from "../react/useEvent";

/** Owns the process-level React Native deep-link subscription. */
export function useDeepLinkListener(onUrl: (url: string | null) => void): void {
  const receive = useEvent(onUrl);
  useEffect(() => {
    let active = true;
    void Linking.getInitialURL().then((url) => {
      if (active) receive(url);
    });
    const subscription = Linking.addEventListener("url", ({ url }) => receive(url));
    return () => {
      active = false;
      subscription.remove();
    };
  }, [receive]);
}
