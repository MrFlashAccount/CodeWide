import { Pressable, ScrollView, View } from "react-native";
import type { InlineQueueOverlayProps } from "./inlineQueueContract";
import { renderInlineQueueItem } from "./InlineQueueItem";
import { STACK_VIEWPORT_HEIGHT } from "./inlineQueueLayout";
import { styles } from "./InlineQueueOverlay.styles";
import { useInlineQueueOverlay } from "./inlineQueueState";

import { AppText as Text } from "../../ui/Typography";

/** One persistent set of measured cards that springs between a two-card stack and a list. */
export function InlineQueueOverlay(props: InlineQueueOverlayProps): React.JSX.Element {
  const overlay = useInlineQueueOverlay(props);

  const { listRef } = overlay;
  return (
    <View
      pointerEvents="box-none"
      testID="inline-queue-tail"
      style={[
        styles.tail,
        props.expanded && styles.expandedTail,
        props.expanded && {
          height: props.maxHeight,
          marginTop: STACK_VIEWPORT_HEIGHT - props.maxHeight,
        },
      ]}
    >
      <Pressable
        accessible={props.expanded}
        accessibilityLabel="Close queue"
        pointerEvents={props.expanded ? "auto" : "none"}
        onPress={props.onClose}
        style={styles.backdrop}
      />
      <View pointerEvents="box-none" testID="inline-queue-overlay" style={styles.overlay}>
        <ScrollView
          ref={listRef}
          testID="inline-queue-list"
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          scrollEnabled={props.expanded && overlay.contentHeight > overlay.listMaxHeight}
          showsVerticalScrollIndicator={false}
          style={[
            styles.list,
            props.expanded ? { maxHeight: overlay.listMaxHeight } : styles.collapsedList,
          ]}
          contentContainerStyle={[styles.listContent, { height: overlay.contentHeight }]}
        >
          {overlay.layouts.map((layout, index) =>
            renderInlineQueueItem(layout, index, props, overlay),
          )}
        </ScrollView>
        {props.expanded && overlay.actionError !== null && (
          <Text accessibilityLiveRegion="polite" style={styles.actionError}>
            {overlay.actionError}
          </Text>
        )}
      </View>
    </View>
  );
}
