import { useContext, useEffect, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";

import { isAppNoticeWindowAvailable } from "../native/appNoticeWindow";
import { spacing } from "../theme";
import { AppNoticeContext } from "./appNoticeContext";
import { AppNoticeViewport } from "./AppNoticeViewport";
import { appNoticeStore } from "./appNoticeStore";

const FALLBACK_LAYER = 9999;

/** Android renders notices in an application-attached window above native sheets. */
export function AppNoticeProvider({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  const insets = useContext(SafeAreaInsetsContext);
  const hasNativeWindow = isAppNoticeWindowAvailable();
  useEffect(
    () => () => {
      appNoticeStore.clear();
    },
    [],
  );
  return (
    <AppNoticeContext.Provider value={appNoticeStore}>
      {children}
      {hasNativeWindow ? null : (
        <View
          pointerEvents="box-none"
          style={[styles.fallback, { top: (insets?.top ?? 0) + spacing.xxs }]}
        >
          <AppNoticeViewport />
        </View>
      )}
    </AppNoticeContext.Provider>
  );
}

const styles = StyleSheet.create({
  fallback: {
    left: spacing.xs,
    position: "absolute",
    right: spacing.xs,
    zIndex: FALLBACK_LAYER,
  },
});
