import { useContext, useEffect, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";

import { spacing } from "../theme";
import { AppNoticeContext } from "./appNoticeContext";
import { AppNoticeViewport } from "./AppNoticeViewport";
import { appNoticeStore } from "./appNoticeStore";

const NOTICE_LAYER = 9999;

/** Web renders the same toast stack above the document workspace. */
export function AppNoticeProvider({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  const insets = useContext(SafeAreaInsetsContext);
  useEffect(
    () => () => {
      appNoticeStore.clear();
    },
    [],
  );
  return (
    <AppNoticeContext.Provider value={appNoticeStore}>
      {children}
      <View
        pointerEvents="box-none"
        style={[styles.viewport, { top: (insets?.top ?? 0) + spacing.xxs }]}
      >
        <AppNoticeViewport />
      </View>
    </AppNoticeContext.Provider>
  );
}

const styles = StyleSheet.create({
  viewport: {
    left: spacing.xs,
    position: "absolute",
    right: spacing.xs,
    zIndex: NOTICE_LAYER,
  },
});
