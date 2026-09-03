import { Pressable, type PressableStateCallbackType, StyleSheet, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { spacing, touchTarget } from "../../theme";
import { ProductText } from "../text/ProductText";
import { ShimmerText } from "../text/ShimmerText";
import type { ThreadListPagingControl } from "./threadListTypes";

interface ThreadListFooterProps {
  paging: ThreadListPagingControl;
}

export function ThreadListFooter(props: ThreadListFooterProps): React.JSX.Element | null {
  const { paging } = props;
  const retry = useEvent(() => {
    if (paging.loading) return;
    paging.loadMore().catch(() => undefined);
  });
  if (paging.loading) {
    return (
      <View style={styles.pageStatus}>
        <ShimmerText text={paging.loadingLabel ?? "Loading threads…"} />
      </View>
    );
  }
  if (paging.error === null && (!paging.canLoadMore || paging.loadingLabel === undefined)) {
    return null;
  }
  const isRetry = paging.error !== null;
  const label = isRetry ? `${paging.error} · Retry` : "Load more search results";
  return (
    <Pressable
      accessibilityLabel={isRetry ? "Retry loading threads" : "Load more search results"}
      accessibilityRole="button"
      onPress={retry}
      style={pageRetryStyle}
    >
      <ProductText numberOfLines={2} style={styles.pageError} tone="muted">
        {label}
      </ProductText>
    </Pressable>
  );
}

function pageRetryStyle(state: PressableStateCallbackType) {
  const { pressed } = state;
  return [styles.pageStatus, pressed && styles.pressed];
}

const styles = StyleSheet.create({
  pageError: { textAlign: "center" },
  pageStatus: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: touchTarget,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  pressed: { opacity: 0.68 },
});
