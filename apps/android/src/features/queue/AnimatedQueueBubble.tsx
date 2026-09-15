import { Pressable, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated from "react-native-reanimated";
import { colors } from "../../theme";
import { InlineIcon } from "../../ui/InlineIcon";
import { AppText as Text } from "../../ui/Typography";
import type { AnimatedQueueBubbleProps } from "./inlineQueueContract";
import { CARD_BORDER_WIDTH } from "./inlineQueueLayout";
import { styles } from "./InlineQueueOverlay.styles";
import { useQueueBubbleMotion } from "./queueBubbleMotion";

export function AnimatedQueueBubble(props: AnimatedQueueBubbleProps): React.JSX.Element {
  const { children, deleteEnabled, expanded, failed, index, raised, steerEnabled, onMeasure } =
    props;
  const {
    cardWidth,
    cardStyle,
    steerRevealStyle,
    deleteRevealStyle,
    steerItem,
    deleteItem,
    reorderGesture,
    swipeGesture,
    swipeStyle,
  } = useQueueBubbleMotion(props);

  return (
    <Reanimated.View
      onLayout={(event) => {
        cardWidth.set(event.nativeEvent.layout.width);
      }}
      pointerEvents={expanded ? "box-none" : index === 0 ? "auto" : "none"}
      style={[styles.cardSlot, cardStyle, raised && styles.raisedCardSlot]}
    >
      <Reanimated.View
        pointerEvents="box-none"
        style={[styles.swipeAction, styles.steerSwipeAction, steerRevealStyle]}
      >
        <Pressable
          accessibilityLabel="Steer queued prompt"
          disabled={!steerEnabled}
          onPress={() => {
            void steerItem();
          }}
          style={[styles.swipeActionContent, styles.steerSwipeActionContent]}
        >
          <InlineIcon name="navigate-outline" role="label" color={colors.onPrimary} />
          <Text style={[styles.swipeActionText, styles.steerSwipeActionText]}>Steer</Text>
        </Pressable>
      </Reanimated.View>
      <Reanimated.View
        pointerEvents="box-none"
        style={[styles.swipeAction, styles.deleteSwipeAction, deleteRevealStyle]}
      >
        <Pressable
          accessibilityLabel="Delete queued prompt"
          disabled={!deleteEnabled}
          onPress={() => {
            void deleteItem();
          }}
          style={[styles.swipeActionContent, styles.deleteSwipeActionContent]}
        >
          <InlineIcon name="trash-outline" role="label" color={colors.text} />
          <Text style={styles.swipeActionText}>Delete</Text>
        </Pressable>
      </Reanimated.View>
      <GestureDetector gesture={Gesture.Race(reorderGesture, swipeGesture)}>
        <Reanimated.View style={[styles.bubble, failed && styles.failedBubble, swipeStyle]}>
          <View
            onLayout={(event) => {
              onMeasure(event.nativeEvent.layout.height + CARD_BORDER_WIDTH * 2);
            }}
            style={expanded ? styles.expandedBubbleContent : styles.collapsedBubbleContent}
          >
            {children}
          </View>
        </Reanimated.View>
      </GestureDetector>
    </Reanimated.View>
  );
}
