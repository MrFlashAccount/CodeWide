import { observable, type Observable } from "@legendapp/state";
import { useSelector } from "@legendapp/state/react";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { useConstant } from "../react/useConstant";
import { useEvent } from "../react/useEvent";
import { colors, spacing, typeScale } from "../theme";
import {
  SLIDER_TRACK_INSET,
  sliderCenterAtProgress,
  sliderProgressAt,
  sliderStopAt,
} from "./sliderGeometry";
import { AppText as Text } from "./Typography";

// Reacticx Range Slider's track, ticks, thumb and spring motion.
const TRACK_HEIGHT = 40;
const TRACK_RADIUS = 10;
const THUMB_WIDTH = 6;
const THUMB_HEIGHT = 20;
const THUMB_RADIUS = 3;
const DOT_SIZE = 4;
const TOOLTIP_WIDTH = 96;
const CENTER_DIVISOR = 2;
const SLIDER_TOUCH_HEIGHT = 74;
const TRACK_TOP = 28;
const THUMB_TOP = TRACK_TOP + (TRACK_HEIGHT - THUMB_HEIGHT) / CENTER_DIVISOR;
const TOOLTIP_HEIGHT = 28;
const ACTIVE_SCALE_Y = 1.35;
const GLIDE_DAMPING = 50;
const GLIDE_MASS = 0.5;
const GLIDE_STIFFNESS = 700;
const BOUNCY_DAMPING = 14;
const BOUNCY_MASS = 0.7;
const BOUNCY_STIFFNESS = 500;
const SPRING_GLIDE = {
  damping: GLIDE_DAMPING,
  mass: GLIDE_MASS,
  stiffness: GLIDE_STIFFNESS,
};
const SPRING_BOUNCY = {
  damping: BOUNCY_DAMPING,
  mass: BOUNCY_MASS,
  stiffness: BOUNCY_STIFFNESS,
};
const TRACK_COLOR = "rgba(120,120,128,0.22)";
const FILL_COLOR = "rgba(255,255,255,0.16)";
const TICK_COLOR = "rgba(255,255,255,0.25)";

type CodeWideSliderProps = {
  readonly accessibilityLabel: string;
  readonly formatValue: (value: string) => string;
  readonly onSelect: (value: string) => void;
  readonly selected: string | null;
  readonly testID?: string;
  readonly values: readonly string[];
};

/** Shared one-thumb slider with CodeWide's track, stops, tooltip, gesture and accessibility. */
export function CodeWideSlider({
  accessibilityLabel,
  formatValue,
  onSelect,
  selected,
  testID,
  values,
}: CodeWideSliderProps): ReactNode {
  const selectedIndex = Math.max(0, values.indexOf(selected ?? values[0] ?? ""));
  const preview$ = useConstant(() => observable(selectedIndex));
  const committed$ = useConstant(() => observable(selectedIndex));
  const committedIndex = useSelector(() => committed$.get());
  const index = useSharedValue(selectedIndex);
  const position = useSharedValue(values.length > 1 ? selectedIndex / (values.length - 1) : 0);
  const thumbScale = useSharedValue(1);
  const stopCount = useSharedValue(values.length);
  const width = useSharedValue(0);
  const surfaceLeft = useSharedValue(0);
  const dragging = useSharedValue(false);
  // The tooltip may update at each stop; the menu draft changes only after the gesture ends.
  const previewStop = useEvent((next: number) => {
    preview$.set(next);
  });
  const publishStop = useEvent((next: number) => {
    preview$.set(next);
    if (committed$.get() === next) {
      return;
    }
    committed$.set(next);
    const value = values[next];
    if (value !== undefined) {
      onSelect(value);
    }
  });
  const onLayout = useEvent((event: { nativeEvent: { layout: { width: number } } }) => {
    width.set(event.nativeEvent.layout.width);
  });
  const onAccessibilityAction = useEvent((event: { nativeEvent: { actionName: string } }) => {
    const direction = event.nativeEvent.actionName === "increment" ? 1 : -1;
    const next = Math.max(0, Math.min(values.length - 1, preview$.get() + direction));
    if (next !== preview$.get()) {
      index.set(next);
      position.set(withSpring(values.length > 1 ? next / (values.length - 1) : 0, SPRING_GLIDE));
      publishStop(next);
    }
  });
  const syncSelection = useEvent((next: number, count: number) => {
    stopCount.set(count);
    if (dragging.get()) {
      return;
    }
    if (index.get() === next && preview$.get() === next && committed$.get() === next) {
      return;
    }
    index.set(next);
    position.set(withSpring(count > 1 ? next / (count - 1) : 0, SPRING_GLIDE));
    preview$.set(next);
    committed$.set(next);
  });
  useEffect(() => {
    syncSelection(selectedIndex, values.length);
  }, [selectedIndex, syncSelection, values.length]);
  const pan = useConstant(() =>
    Gesture.Pan()
      .withTestId(testID === undefined ? "codewide-slider-pan" : `${testID}-pan`)
      .minDistance(0)
      .maxPointers(1)
      .onBegin((event) => {
        surfaceLeft.set(event.absoluteX - event.x);
      })
      .onStart((event) => {
        dragging.set(true);
        thumbScale.set(withSpring(ACTIVE_SCALE_Y, SPRING_BOUNCY));
        const next = sliderStopAt(
          event.absoluteX - surfaceLeft.get(),
          width.get(),
          stopCount.get(),
        );
        position.set(sliderProgressAt(event.absoluteX - surfaceLeft.get(), width.get()));
        if (next !== index.get()) {
          index.set(next);
          scheduleOnRN(previewStop, next);
        }
      })
      .onUpdate((event) => {
        const next = sliderStopAt(
          event.absoluteX - surfaceLeft.get(),
          width.get(),
          stopCount.get(),
        );
        position.set(sliderProgressAt(event.absoluteX - surfaceLeft.get(), width.get()));
        if (next !== index.get()) {
          index.set(next);
          scheduleOnRN(previewStop, next);
        }
      })
      .onFinalize((event) => {
        const wasDragging = dragging.get();
        dragging.set(false);
        if (wasDragging) {
          // A quick pan can end past its last update; settle at the lift point.
          index.set(
            sliderStopAt(event.absoluteX - surfaceLeft.get(), width.get(), stopCount.get()),
          );
        }
        position.set(
          withSpring(stopCount.get() > 1 ? index.get() / (stopCount.get() - 1) : 0, SPRING_GLIDE),
        );
        thumbScale.set(withSpring(1, SPRING_BOUNCY));
        if (wasDragging) {
          scheduleOnRN(publishStop, index.get());
        }
      }),
  );
  const fillStyle = useAnimatedStyle<ViewStyle>(() => ({
    width: sliderCenterAtProgress(position.get(), width.get(), stopCount.get()),
  }));
  const thumbStyle = useAnimatedStyle<ViewStyle>(() => ({
    transform: [
      {
        translateX:
          sliderCenterAtProgress(position.get(), width.get(), stopCount.get()) -
          THUMB_WIDTH / CENTER_DIVISOR,
      },
      { scaleY: thumbScale.get() },
    ],
  }));
  const tooltipStyle = useAnimatedStyle<ViewStyle>(() => ({
    transform: [
      {
        translateX: Math.max(
          0,
          Math.min(
            width.get() - TOOLTIP_WIDTH,
            sliderCenterAtProgress(position.get(), width.get(), stopCount.get()) -
              TOOLTIP_WIDTH / CENTER_DIVISOR,
          ),
        ),
      },
    ],
  }));
  const committedValue = values[committedIndex];
  const committedLabel = committedValue === undefined ? "" : formatValue(committedValue);
  return (
    <GestureHandlerRootView style={styles.root} unstable_forceActive>
      <Text style={styles.label}>{accessibilityLabel}</Text>
      <SliderGestureSurface
        accessibilityLabel={accessibilityLabel}
        fillStyle={fillStyle}
        formatValue={formatValue}
        gesture={pan}
        label={committedLabel}
        onAccessibilityAction={onAccessibilityAction}
        onLayout={onLayout}
        preview$={preview$}
        testID={testID}
        thumbStyle={thumbStyle}
        tooltipStyle={tooltipStyle}
        values={values}
      />
      <SliderEndLabels formatValue={formatValue} values={values} />
    </GestureHandlerRootView>
  );
}

type SliderSurfaceProps = {
  accessibilityLabel: string;
  fillStyle: ReturnType<typeof useAnimatedStyle<ViewStyle>>;
  formatValue: (value: string) => string;
  gesture: ReturnType<typeof Gesture.Pan>;
  label: string;
  onAccessibilityAction: (event: { nativeEvent: { actionName: string } }) => void;
  onLayout: (event: { nativeEvent: { layout: { width: number } } }) => void;
  preview$: Observable<number>;
  testID: string | undefined;
  thumbStyle: ReturnType<typeof useAnimatedStyle<ViewStyle>>;
  tooltipStyle: ReturnType<typeof useAnimatedStyle<ViewStyle>>;
  values: readonly string[];
};

function SliderGestureSurface(props: SliderSurfaceProps): ReactNode {
  return (
    <GestureDetector gesture={props.gesture}>
      <View
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        accessibilityLabel={`${props.accessibilityLabel}, ${props.label}`}
        accessibilityRole="adjustable"
        collapsable={false}
        onAccessibilityAction={props.onAccessibilityAction}
        onLayout={props.onLayout}
        style={styles.sliderTouch}
      >
        <SliderTooltip
          formatValue={props.formatValue}
          preview$={props.preview$}
          style={props.tooltipStyle}
          values={props.values}
        />
        <SliderTrack fillStyle={props.fillStyle} testID={props.testID} values={props.values} />
        <Animated.View
          style={[styles.thumb, props.thumbStyle]}
          testID={props.testID === undefined ? undefined : `${props.testID}-thumb`}
        />
      </View>
    </GestureDetector>
  );
}

function SliderTooltip({
  formatValue,
  preview$,
  style,
  values,
}: {
  formatValue: (value: string) => string;
  preview$: Observable<number>;
  style: ReturnType<typeof useAnimatedStyle<ViewStyle>>;
  values: readonly string[];
}): ReactNode {
  const previewIndex = useSelector(() => preview$.get());
  const previewValue = values[previewIndex];
  const label = previewValue === undefined ? "" : formatValue(previewValue);
  return (
    <Animated.View style={[styles.tooltip, style]}>
      <Text style={styles.tooltipText}>{label}</Text>
    </Animated.View>
  );
}

function SliderTrack({
  fillStyle,
  testID,
  values,
}: {
  fillStyle: ReturnType<typeof useAnimatedStyle<ViewStyle>>;
  testID: string | undefined;
  values: readonly string[];
}): ReactNode {
  return (
    <View style={styles.track} testID={testID === undefined ? undefined : `${testID}-track`}>
      <Animated.View
        style={[styles.trackFill, fillStyle]}
        testID={testID === undefined ? undefined : `${testID}-fill`}
      />
      <SliderDots values={values} />
    </View>
  );
}

function SliderDots({ values }: { values: readonly string[] }): ReactNode {
  return (
    <View style={[styles.dots, values.length === 1 && styles.singleDot]}>
      {values.map((value) => (
        <View key={value} style={styles.dot} />
      ))}
    </View>
  );
}

function SliderEndLabels({
  formatValue,
  values,
}: {
  formatValue: (value: string) => string;
  values: readonly string[];
}): ReactNode {
  const first = values[0];
  const last = values.at(-1);
  return (
    <View style={styles.endLabels}>
      <Text style={styles.smallText}>{first === undefined ? "" : formatValue(first)}</Text>
      <Text style={styles.smallText}>{last === undefined ? "" : formatValue(last)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  dot: {
    backgroundColor: TICK_COLOR,
    borderRadius: DOT_SIZE / CENTER_DIVISOR,
    height: DOT_SIZE,
    width: DOT_SIZE,
  },
  dots: {
    alignItems: "center",
    bottom: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    left: 0,
    paddingHorizontal: SLIDER_TRACK_INSET - DOT_SIZE / CENTER_DIVISOR,
    position: "absolute",
    right: 0,
    top: 0,
  },
  endLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xs,
  },
  label: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  root: {
    marginTop: spacing.lg,
  },
  singleDot: {
    justifyContent: "center",
    paddingHorizontal: 0,
  },
  sliderTouch: {
    height: SLIDER_TOUCH_HEIGHT,
    justifyContent: "center",
    marginTop: spacing.xxs,
  },
  smallText: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  thumb: {
    backgroundColor: "#ffffff",
    borderRadius: THUMB_RADIUS,
    height: THUMB_HEIGHT,
    position: "absolute",
    top: THUMB_TOP,
    width: THUMB_WIDTH,
  },
  tooltip: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerHighest,
    borderRadius: TOOLTIP_HEIGHT / CENTER_DIVISOR,
    height: TOOLTIP_HEIGHT,
    justifyContent: "center",
    position: "absolute",
    top: 0,
    width: TOOLTIP_WIDTH,
  },
  tooltipText: {
    ...typeScale.label,
    color: colors.text,
  },
  track: {
    backgroundColor: TRACK_COLOR,
    borderRadius: TRACK_RADIUS,
    height: TRACK_HEIGHT,
    overflow: "hidden",
    position: "absolute",
    top: TRACK_TOP,
    width: "100%",
  },
  trackFill: {
    backgroundColor: FILL_COLOR,
    height: "100%",
    left: 0,
    position: "absolute",
    top: 0,
  },
});
