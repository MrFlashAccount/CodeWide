import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from "react-native";

import {
  colors,
  controlHitSlop,
  controlSize,
  iconSize,
  radii,
  spacing,
  typeScale,
  typeWeight,
} from "../../theme";
import { surfaceToneCanvasColor, useSurfaceTone, type SurfaceTone } from "../../ui/surfaceTone";
import { AppText as Text } from "../../ui/Typography";
import { MessageBody } from "./MessageBody";
import type { MessageContent } from "./messageContent";

/** A body taller than this folds behind a fade and "Read more". */
const FOLDED_HEIGHT = 176;
const FADE_HEIGHT = 48;
/** The 32dp pill overlaps the fade by half its height. */
const PILL_OVERLAP = -spacing.md;

/** `fits` until the body measures taller than the fold; the reader may then unfold it. */
type Fold = "fits" | "folded" | "unfolded";

/**
 * A message body clipped at a fixed height while it is longer, with a fade
 * into the surface of the pane it sits on (`ui/surfaceTone`) and a "Read more" pill that unfolds it for this
 * mount. The renderer always receives the complete document; only the view
 * clips it.
 */
export function MessageFoldedBody({
  content,
  testID,
}: {
  readonly content: MessageContent;
  readonly testID: string;
}): React.JSX.Element {
  const [fold, setFold] = useState<Fold>("fits");
  const fade = fadeStyles[useSurfaceTone()];
  const measure = (event: LayoutChangeEvent): void => {
    const tall = event.nativeEvent.layout.height > FOLDED_HEIGHT;
    if (tall && fold === "fits") {
      setFold("folded");
    } else if (!tall && fold === "folded") {
      setFold("fits");
    }
  };
  return (
    <View>
      <View style={fold === "unfolded" ? null : styles.clamp}>
        <MeasuredBody content={content} onLayout={measure} testID={testID} />
        {fold === "folded" ? (
          <View pointerEvents="none" style={[styles.fade, fade]} testID={`${testID}-fade`} />
        ) : null}
      </View>
      {fold === "folded" ? (
        <ReadMorePill
          onPress={() => {
            setFold("unfolded");
          }}
          testID={`${testID}-read-more`}
        />
      ) : null}
    </View>
  );
}

function MeasuredBody({
  content,
  onLayout,
  testID,
}: {
  readonly content: MessageContent;
  readonly onLayout: (event: LayoutChangeEvent) => void;
  readonly testID: string;
}): React.JSX.Element {
  return (
    <View onLayout={onLayout} testID={`${testID}-body`}>
      <MessageBody content={content} />
    </View>
  );
}

function ReadMorePill({
  onPress,
  testID,
}: {
  readonly onPress: () => void;
  readonly testID: string;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityHint="Shows the whole message"
      accessibilityRole="button"
      hitSlop={controlHitSlop.compact}
      onPress={onPress}
      style={({ pressed }) => [styles.more, pressed && styles.pressed]}
      testID={testID}
    >
      <Ionicons color={colors.text} name="arrow-down" size={iconSize.inline} />
      <Text style={styles.moreLabel}>Read more</Text>
    </Pressable>
  );
}

function fadeInto(tone: SurfaceTone): string {
  return `linear-gradient(to bottom, transparent, ${surfaceToneCanvasColor(tone)})`;
}

/** The fade ends in the canvas color of each surface tone, so it melts into the pane behind it. */
const fadeStyles = StyleSheet.create({
  raised: { experimental_backgroundImage: fadeInto("raised") },
  recessed: { experimental_backgroundImage: fadeInto("recessed") },
});

const styles = StyleSheet.create({
  clamp: {
    maxHeight: FOLDED_HEIGHT,
    overflow: "hidden",
  },
  fade: {
    bottom: 0,
    height: FADE_HEIGHT,
    left: 0,
    position: "absolute",
    right: 0,
  },
  more: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.pill,
    columnGap: spacing.compact,
    flexDirection: "row",
    marginTop: PILL_OVERLAP,
    minHeight: controlSize.compact,
    paddingHorizontal: spacing.md,
  },
  moreLabel: {
    ...typeScale.body,
    color: colors.text,
    fontWeight: typeWeight.medium,
  },
  pressed: {
    backgroundColor: colors.surfaceContainerHighest,
  },
});
