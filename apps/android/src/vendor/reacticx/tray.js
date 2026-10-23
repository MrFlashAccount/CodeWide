// Generated from vendored Reacticx source. Do not edit.

// vendor/reacticx/src/components/organisms/tray/index.tsx
import {
  createContext as createContext2,
  memo,
  useContext as useContext2,
  useEffect,
  useMemo,
  useRef as useRef2,
  useState as useState3
} from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View
} from "react-native";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView
} from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  Extrapolation,
  interpolate,
  scrollTo,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

// src/react/useConstant.ts
import { useState } from "react";
function useConstant(create) {
  const [value] = useState(create);
  return value;
}

// src/react/useLatest.ts
import { useLayoutEffect, useRef } from "react";
function useLatest(value) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

// src/react/useEvent.ts
function useEvent(callback) {
  const ref = useLatest(callback);
  return useConstant(
    () => (...args) => {
      const current = ref.current;
      if (current === null || current === false || current === void 0) {
        return void 0;
      }
      const result = current(...args);
      return result;
    }
  );
}

// vendor/reacticx/src/components/organisms/tray/const.ts
import { Easing } from "react-native-reanimated";
var PRESENT_SPRING = {
  damping: 30,
  stiffness: 280,
  mass: 0.9,
  overshootClamping: false
};
var DISMISS_TIMING = {
  duration: 180,
  easing: Easing.out(Easing.cubic)
};
var HEIGHT_SPRING = {
  damping: 26,
  stiffness: 260,
  mass: 0.75,
  overshootClamping: true
};
var DETENT_SPRING = {
  damping: 32,
  stiffness: 320,
  mass: 0.9,
  overshootClamping: false
};
var GESTURE_ACTIVE_OFFSET = [-8, 8];
var GESTURE_FAIL_OFFSET = [-14, 14];
var DRAG_RETURN_SPRING = {
  damping: 26,
  stiffness: 300,
  mass: 0.9
};
var VIEW_IN_SPRING = {
  damping: 26,
  stiffness: 280,
  mass: 0.7
};
var VIEW_OUT_TIMING = {
  duration: 160,
  easing: Easing.out(Easing.quad)
};
var DEFAULT_RADIUS = 38;
var DEFAULT_CLOSE_THRESHOLD = 96;
var DEFAULT_CLOSE_VELOCITY = 900;
var PRESENT_START_SCALE = 0.9;
var TRAVEL_PADDING = 56;
var VIEW_SLIDE = 26;
var VIEW_START_SCALE = 0.9;
var BACKDROP_DRAG_FALLOFF = 0.45;
var SCROLL_DECELERATION = 0.998;
var DEFAULT_MOTION = {
  presentSpring: PRESENT_SPRING,
  dismissTiming: DISMISS_TIMING,
  startScale: PRESENT_START_SCALE,
  travelPadding: TRAVEL_PADDING,
  heightSpring: HEIGHT_SPRING,
  detentSpring: DETENT_SPRING,
  dragReturnSpring: DRAG_RETURN_SPRING,
  overDragFactor: 0.55,
  backdropFalloff: BACKDROP_DRAG_FALLOFF,
  flickProjection: 0.35,
  viewInSpring: VIEW_IN_SPRING,
  viewOutTiming: VIEW_OUT_TIMING,
  viewSlide: VIEW_SLIDE,
  viewStartScale: VIEW_START_SCALE,
  viewAxis: "x",
  activeOffsetY: GESTURE_ACTIVE_OFFSET,
  failOffsetX: GESTURE_FAIL_OFFSET,
  scrollDeceleration: SCROLL_DECELERATION
};
var LIGHT_PALETTE = {
  surface: "#ffffff",
  border: "#e3e7ec",
  handle: "rgba(60,60,67,0.3)",
  text: "#111111",
  mutedText: "#6d7480",
  backdrop: "rgba(0,0,0,0.4)"
};
var DARK_PALETTE = {
  surface: "#171716",
  border: "#2b2a25",
  handle: "rgba(246,243,236,0.28)",
  text: "#f6f3ec",
  mutedText: "#9a958a",
  backdrop: "rgba(0,0,0,0.55)"
};
var PALETTES = {
  light: LIGHT_PALETTE,
  dark: DARK_PALETTE
};

// vendor/reacticx/src/components/organisms/tray/context.tsx
import { createContext, useContext } from "react";
var TrayContext = createContext(null);
function useTrayContext(part) {
  const ctx = useContext(TrayContext);
  if (!ctx) {
    throw new Error(`<${part}> must be rendered inside <Tray>`);
  }
  return ctx;
}
function useTray() {
  const { open, close, setView, goBack, canGoBack, view, visible } = useTrayContext("useTray");
  return { open, close, setView, goBack, canGoBack, view, visible };
}
var TrayTintContext = createContext(null);
function useTrayTint(fallback) {
  return useContext(TrayTintContext) ?? fallback;
}

// vendor/reacticx/src/components/organisms/tray/helper.ts
function projectPosition(position, velocity, seconds) {
  "worklet";
  return position + velocity * seconds;
}
function nearestOffsetIndex(offsets, position) {
  "worklet";
  let best = 0;
  let bestDistance = Number.MAX_VALUE;
  for (let i = 0; i < offsets.length; i += 1) {
    const distance = Math.abs(offsets[i] - position);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}
function rubberBand(distance, dimension, factor = 0.55) {
  "worklet";
  return (1 - 1 / (distance * factor / Math.max(dimension, 1) + 1)) * Math.max(dimension, 1);
}
function resolveDetent(detent, available) {
  if (typeof detent === "string") {
    const percent = parseFloat(detent);
    return Number.isFinite(percent) ? available * percent / 100 : available;
  }
  return detent <= 1 ? available * detent : detent;
}
function toOffsets(heights) {
  const tallest = Math.max(...heights);
  return heights.map((height) => tallest - height).sort((a, b) => a - b);
}
function shouldMountTrayView(active, retained) {
  return active || retained;
}

// vendor/reacticx/src/components/organisms/tray/hooks.ts
import { useState as useState2 } from "react";
function useTrayNavigation(defaultView, onViewChange) {
  const [state, setState] = useState2({
    stack: [defaultView],
    direction: 1
  });
  const view = state.stack[state.stack.length - 1];
  const setView = useEvent((next) => {
    setState((current) => {
      if (current.stack[current.stack.length - 1] === next) return current;
      return { stack: [...current.stack, next], direction: 1 };
    });
    onViewChange?.(next);
  });
  const goBack = useEvent(() => {
    setState((current) => {
      if (current.stack.length < 2) return current;
      const stack = current.stack.slice(0, -1);
      onViewChange?.(stack[stack.length - 1]);
      return { stack, direction: -1 };
    });
  });
  const reset = useEvent((next) => {
    setState({ stack: [next], direction: 1 });
  });
  return {
    view,
    direction: state.direction,
    canGoBack: state.stack.length > 1,
    setView,
    goBack,
    reset
  };
}

// vendor/reacticx/src/utils/create-compound-component/index.ts
function createCompoundComponent(name, component, compound = {}) {
  component.displayName = name;
  return Object.assign(component, compound);
}

// vendor/reacticx/src/components/organisms/tray/index.tsx
import { jsx, jsxs } from "react/jsx-runtime";
var TrayDismissContext = createContext2(true);
var TrayRoot = ({
  children,
  defaultView = "default",
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  onViewChange,
  theme = "light",
  palette: paletteProp,
  radius = DEFAULT_RADIUS,
  closeThreshold = DEFAULT_CLOSE_THRESHOLD,
  closeVelocity = DEFAULT_CLOSE_VELOCITY,
  dismissOnBackdropPress = true,
  enableDragToDismiss = true,
  detents,
  initialDetent = 0,
  onDetentChange,
  motion: motionProp
}) => {
  const isControlled = openProp !== void 0;
  const [internalOpen, setInternalOpen] = useState3(defaultOpen);
  const open = isControlled ? openProp : internalOpen;
  const [mounted, setMounted] = useState3(open);
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const { offsets, detentHeight } = useMemo(() => {
    if (!detents || detents.length === 0) {
      return { offsets: [0], detentHeight: 0 };
    }
    const available = screenHeight - insets.top - insets.bottom;
    const heights = detents.map((detent) => resolveDetent(detent, available));
    return { offsets: toOffsets(heights), detentHeight: Math.max(...heights) };
  }, [detents, screenHeight, insets.top, insets.bottom]);
  const reduceMotion = useReducedMotion();
  const motion = useMemo(
    () => ({ ...DEFAULT_MOTION, ...motionProp }),
    [motionProp]
  );
  const navigation = useTrayNavigation(defaultView, onViewChange);
  const present = useSharedValue(0);
  const offset = useSharedValue(0);
  const startOffset = useSharedValue(0);
  const detentIndex = useSharedValue(0);
  const travel = useSharedValue(0);
  const dismissY = useSharedValue(0);
  const scrollY = useSharedValue(0);
  const owns = useSharedValue(false);
  const origin = useSharedValue(0);
  const hasScrollable = useSharedValue(false);
  const isDragging = useSharedValue(false);
  const closing = useRef2(false);
  const transitionVersion = useRef2(0);
  const setOpen = useEvent((next) => {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  });
  const reset = useEvent(() => {
    closing.current = false;
    travel.value = 0;
    dismissY.value = 0;
    offset.value = 0;
    startOffset.value = 0;
    detentIndex.value = 0;
    scrollY.value = 0;
    owns.value = false;
    origin.value = 0;
    hasScrollable.value = false;
    isDragging.value = false;
    present.value = 0;
  });
  const finishClose = useEvent((version) => {
    if (open || transitionVersion.current !== version) return;
    setMounted(false);
    reset();
  });
  const requestClose = useEvent(() => {
    setOpen(false);
  });
  const close = useEvent(() => requestClose());
  const openTray = useEvent((view) => {
    setMounted(true);
    navigation.reset(view ?? defaultView);
    const index = Math.min(initialDetent, offsets.length - 1);
    offset.value = offsets[index] ?? 0;
    detentIndex.value = index;
    setOpen(true);
  });
  const dismiss = useEvent((_velocity) => requestClose());
  useEffect(() => {
    transitionVersion.current += 1;
    const version = transitionVersion.current;
    if (open) {
      setMounted(true);
      if (closing.current) {
        closing.current = false;
        cancelAnimation(present);
        cancelAnimation(dismissY);
        dismissY.value = reduceMotion ? 0 : withSpring(0, motion.presentSpring);
        present.value = reduceMotion ? 1 : withSpring(1, motion.presentSpring);
      }
      return;
    }
    cancelAnimation(present);
    cancelAnimation(dismissY);
    if (!mounted) {
      finishClose(version);
      return;
    }
    closing.current = true;
    if (reduceMotion) {
      present.value = 0;
      dismissY.value = travel.value;
      finishClose(version);
      return;
    }
    present.value = withTiming(0, motion.dismissTiming);
    dismissY.value = withTiming(travel.value, motion.dismissTiming, (finished) => {
      "worklet";
      if (finished) scheduleOnRN(finishClose, version);
    });
  }, [open, mounted, reduceMotion, motion, present, dismissY, travel, finishClose]);
  const settleTo = useEvent((index) => {
    onDetentChange?.(index);
  });
  const pan = useMemo(
    () => Gesture.Pan().enabled(enableDragToDismiss).activeOffsetY(motion.activeOffsetY).failOffsetX(motion.failOffsetX).onBegin(() => {
      "worklet";
      owns.value = false;
      origin.value = 0;
      startOffset.value = offset.value;
      isDragging.value = false;
    }).onUpdate((event) => {
      "worklet";
      if (!owns.value) {
        const expanded = startOffset.value <= 0.5;
        const canScroll = hasScrollable.value && expanded;
        const atTop = !canScroll || scrollY.value <= 0;
        if (!atTop || canScroll && event.translationY <= 0) {
          isDragging.value = false;
          return;
        }
        owns.value = true;
        origin.value = event.translationY;
      }
      const travelled = event.translationY - origin.value;
      const next = startOffset.value + travelled;
      if (next < 0) {
        offset.value = -rubberBand(
          -next,
          travel.value,
          motion.overDragFactor
        );
        isDragging.value = true;
        return;
      }
      offset.value = next;
      isDragging.value = true;
    }).onEnd((event) => {
      "worklet";
      if (!owns.value) return;
      const projected = projectPosition(
        offset.value,
        event.velocityY,
        motion.flickProjection
      );
      const last = offsets[offsets.length - 1];
      if (projected > last + closeThreshold || event.velocityY > closeVelocity && offset.value > 0) {
        scheduleOnRN(dismiss, event.velocityY);
        return;
      }
      const index = nearestOffsetIndex(offsets, projected);
      detentIndex.value = index;
      offset.value = withSpring(offsets[index], {
        ...motion.detentSpring,
        velocity: event.velocityY
      });
      scheduleOnRN(settleTo, index);
    }).onFinalize(() => {
      "worklet";
      owns.value = false;
      isDragging.value = false;
    }),
    [
      enableDragToDismiss,
      motion,
      isDragging,
      owns,
      origin,
      startOffset,
      offset,
      detentIndex,
      offsets,
      hasScrollable,
      scrollY,
      travel,
      closeThreshold,
      closeVelocity,
      dismiss,
      settleTo
    ]
  );
  const palette = useMemo(
    () => ({ ...PALETTES[theme], ...paletteProp }),
    [theme, paletteProp]
  );
  const ctx = useMemo(
    () => ({
      visible: open || mounted,
      view: navigation.view,
      direction: navigation.direction,
      canGoBack: navigation.canGoBack,
      open: openTray,
      close,
      setView: navigation.setView,
      goBack: navigation.goBack,
      present,
      dismissY,
      dragY: offset,
      offset,
      offsets,
      detentHeight,
      travel,
      scrollY,
      isDragging,
      hasScrollable,
      pan,
      palette,
      radius,
      motion,
      reduceMotion
    }),
    [
      mounted,
      open,
      navigation.view,
      navigation.direction,
      navigation.canGoBack,
      navigation.setView,
      navigation.goBack,
      openTray,
      close,
      present,
      dismissY,
      offset,
      offsets,
      detentHeight,
      travel,
      scrollY,
      isDragging,
      hasScrollable,
      pan,
      palette,
      radius,
      motion,
      reduceMotion
    ]
  );
  return /* @__PURE__ */ jsx(TrayContext.Provider, { value: ctx, children: /* @__PURE__ */ jsx(TrayDismissContext.Provider, { value: dismissOnBackdropPress, children }) });
};
var TrayTrigger = ({
  children,
  view,
  style
}) => {
  const { open, palette } = useTrayContext("Tray.Trigger");
  return /* @__PURE__ */ jsx(
    Pressable,
    {
      accessibilityRole: "button",
      onPress: () => open(view),
      style,
      children: /* @__PURE__ */ jsx(TrayTintContext.Provider, { value: palette.text, children })
    }
  );
};
var TrayContent = ({
  children,
  style
}) => {
  const {
    visible,
    close,
    present,
    dismissY,
    dragY,
    travel,
    pan,
    detentHeight,
    palette,
    radius,
    motion,
    reduceMotion
  } = useTrayContext("Tray.Content");
  const insets = useSafeAreaInsets();
  const dismissOnBackdropPress = useContext2(TrayDismissContext);
  const transformStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dismissY.value + dragY.value }]
  }));
  const sheetEntering = useMemo(
    () => (values) => {
      "worklet";
      travel.value = values.windowHeight + insets.bottom + motion.travelPadding;
      dismissY.value = 0;
      present.value = reduceMotion ? 1 : withSpring(1, motion.presentSpring);
      return {
        initialValues: {
          originY: reduceMotion ? values.targetOriginY : values.targetOriginY + values.targetHeight + insets.bottom + motion.travelPadding,
          transform: [{ scale: reduceMotion ? 1 : motion.startScale }]
        },
        animations: {
          originY: reduceMotion ? values.targetOriginY : withSpring(values.targetOriginY, motion.presentSpring),
          transform: [
            {
              scale: reduceMotion ? 1 : withSpring(1, motion.presentSpring)
            }
          ]
        }
      };
    },
    [
      dismissY,
      insets.bottom,
      motion.presentSpring,
      motion.startScale,
      motion.travelPadding,
      present,
      reduceMotion,
      travel
    ]
  );
  const sheetLayout = useMemo(
    () => (values) => {
      "worklet";
      return {
        initialValues: {
          originX: values.currentOriginX,
          originY: values.currentOriginY,
          width: values.currentWidth,
          height: values.currentHeight
        },
        animations: {
          originX: withSpring(values.targetOriginX, motion.heightSpring),
          originY: withSpring(values.targetOriginY, motion.heightSpring),
          width: withSpring(values.targetWidth, motion.heightSpring),
          height: withSpring(values.targetHeight, motion.heightSpring)
        }
      };
    },
    [motion.heightSpring]
  );
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: present.value * interpolate(
      dragY.value,
      [0, Math.max(travel.value, 1)],
      [1, motion.backdropFalloff],
      Extrapolation.CLAMP
    )
  }));
  if (!visible) return null;
  return /* @__PURE__ */ jsx(
    Modal,
    {
      transparent: true,
      statusBarTranslucent: true,
      visible: true,
      animationType: "none",
      onRequestClose: close,
      children: /* @__PURE__ */ jsx(GestureHandlerRootView, { style: styles.fill, unstable_forceActive: true, children: /* @__PURE__ */ jsx(
        KeyboardAvoidingView,
        {
          behavior: "padding",
          pointerEvents: "box-none",
          style: styles.fill,
          testID: "tray-keyboard-layout",
          children: /* @__PURE__ */ jsxs(View, { style: styles.fill, pointerEvents: "box-none", children: [
            /* @__PURE__ */ jsx(
              Pressable,
              {
                accessibilityLabel: "Dismiss tray",
                accessibilityRole: "button",
                onPress: dismissOnBackdropPress ? close : void 0,
                pointerEvents: dismissOnBackdropPress ? "auto" : "none",
                style: styles.backdrop,
                testID: "tray-backdrop",
                children: /* @__PURE__ */ jsx(
                  Animated.View,
                  {
                    pointerEvents: "none",
                    style: [
                      styles.backdropFill,
                      { backgroundColor: palette.backdrop },
                      backdropStyle
                    ]
                  }
                )
              }
            ),
            /* @__PURE__ */ jsx(
              View,
              {
                style: [
                  styles.wrap,
                  { paddingBottom: Math.max(insets.bottom, 12) }
                ],
                pointerEvents: "box-none",
                children: /* @__PURE__ */ jsx(GestureDetector, { gesture: pan, children: /* @__PURE__ */ jsx(
                  Animated.View,
                  {
                    entering: sheetEntering,
                    layout: reduceMotion ? void 0 : sheetLayout,
                    style: styles.layout,
                    children: /* @__PURE__ */ jsx(
                      Animated.View,
                      {
                        style: [
                          styles.sheet,
                          {
                            backgroundColor: palette.surface,
                            borderColor: palette.border,
                            borderRadius: radius
                          },
                          transformStyle,
                          style
                        ],
                        children: /* @__PURE__ */ jsxs(
                          View,
                          {
                            style: [
                              styles.clip,
                              detentHeight === 0 ? void 0 : { height: detentHeight }
                            ],
                            children: [
                              /* @__PURE__ */ jsx(View, { style: styles.handleArea, children: /* @__PURE__ */ jsx(
                                View,
                                {
                                  style: [
                                    styles.handle,
                                    { backgroundColor: palette.handle }
                                  ]
                                }
                              ) }),
                              children
                            ]
                          }
                        )
                      }
                    )
                  }
                ) })
              }
            )
          ] })
        }
      ) })
    }
  );
};
var TrayView = ({
  children,
  id,
  style
}) => {
  const { view, direction, reduceMotion, motion } = useTrayContext("Tray.View");
  const active = view === id;
  const [rendered, setRendered] = useState3(active);
  const progress = useSharedValue(active ? 1 : 0);
  const slideFrom = useSharedValue(0);
  useEffect(() => {
    if (active) {
      setRendered(true);
      slideFrom.value = direction;
      progress.value = reduceMotion ? 1 : withSpring(1, motion.viewInSpring);
      return;
    }
    if (progress.value === 0) return;
    slideFrom.value = -direction;
    if (reduceMotion) {
      progress.value = 0;
      setRendered(false);
      return;
    }
    progress.value = withTiming(0, motion.viewOutTiming, (finished) => {
      "worklet";
      if (finished) scheduleOnRN(setRendered, false);
    });
  }, [active, direction, progress, slideFrom, reduceMotion, motion]);
  const layerStyle = useAnimatedStyle(() => {
    const shift = (1 - progress.value) * motion.viewSlide * slideFrom.value;
    const scale = {
      scale: interpolate(
        progress.value,
        [0, 1],
        [motion.viewStartScale, 1],
        Extrapolation.CLAMP
      )
    };
    if (motion.viewAxis === "none") {
      return { opacity: progress.value, transform: [scale] };
    }
    return {
      opacity: progress.value,
      transform: [
        motion.viewAxis === "y" ? { translateY: shift } : { translateX: shift },
        scale
      ]
    };
  });
  if (!shouldMountTrayView(active, rendered)) return null;
  return /* @__PURE__ */ jsx(
    Animated.View,
    {
      pointerEvents: active ? "auto" : "none",
      style: [
        active ? styles.activeLayer : styles.idleLayer,
        layerStyle,
        style
      ],
      children
    }
  );
};
var TrayHeader = ({
  children,
  style
}) => /* @__PURE__ */ jsx(View, { style: [styles.header, style], children });
var TrayTitle = ({
  children,
  style
}) => {
  const { palette } = useTrayContext("Tray.Title");
  return /* @__PURE__ */ jsx(Text, { style: [styles.title, { color: palette.text }, style], children });
};
var TraySubtitle = ({
  children,
  style
}) => {
  const { palette } = useTrayContext("Tray.Subtitle");
  return /* @__PURE__ */ jsx(Text, { style: [styles.subtitle, { color: palette.mutedText }, style], children });
};
var TrayBody = ({
  children,
  style
}) => /* @__PURE__ */ jsx(View, { style: [styles.body, style], children });
var TrayFooter = ({
  children,
  style
}) => {
  const { palette } = useTrayContext("Tray.Footer");
  return /* @__PURE__ */ jsx(View, { style: [styles.footer, { borderTopColor: palette.border }, style], children });
};
var TrayClose = ({
  children,
  style
}) => {
  const { close, palette } = useTrayContext("Tray.Close");
  const state = { color: palette.mutedText, size: 20 };
  const content = typeof children === "function" ? children(state) : children ?? null;
  return /* @__PURE__ */ jsx(
    Pressable,
    {
      accessibilityRole: "button",
      accessibilityLabel: "Close",
      hitSlop: 12,
      onPress: close,
      style,
      children: /* @__PURE__ */ jsx(TrayTintContext.Provider, { value: palette.mutedText, children: content ?? /* @__PURE__ */ jsx(Text, { style: [styles.glyph, { color: palette.mutedText }], children: "\u2715" }) })
    }
  );
};
var TrayBack = ({
  children,
  style
}) => {
  const { goBack, canGoBack, palette } = useTrayContext("Tray.Back");
  if (!canGoBack) return null;
  const state = { color: palette.mutedText, size: 20 };
  const content = typeof children === "function" ? children(state) : children ?? null;
  return /* @__PURE__ */ jsx(
    Pressable,
    {
      accessibilityRole: "button",
      accessibilityLabel: "Back",
      hitSlop: 12,
      onPress: goBack,
      style,
      children: /* @__PURE__ */ jsx(TrayTintContext.Provider, { value: palette.mutedText, children: content ?? /* @__PURE__ */ jsx(Text, { style: [styles.glyph, { color: palette.mutedText }], children: "\u2039" }) })
    }
  );
};
var TrayScrollView = ({
  children,
  maxHeight,
  contentContainerStyle,
  style
}) => {
  const { scrollY, isDragging, hasScrollable, offset, pan, motion } = useTrayContext("Tray.ScrollView");
  const { height: screenHeight } = useWindowDimensions();
  const listRef = useAnimatedRef();
  const resolvedMax = maxHeight ?? screenHeight * 0.55;
  useEffect(() => {
    hasScrollable.value = true;
    return () => {
      hasScrollable.value = false;
      scrollY.value = 0;
    };
  }, [hasScrollable, scrollY]);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      "worklet";
      if (isDragging.value) {
        scrollTo(listRef, 0, 0, false);
        scrollY.value = 0;
        return;
      }
      scrollY.value = event.contentOffset.y;
    }
  });
  const nativeGesture = useMemo(
    () => Gesture.Native().simultaneousWithExternalGesture(pan),
    [pan]
  );
  return /* @__PURE__ */ jsx(GestureDetector, { gesture: nativeGesture, children: /* @__PURE__ */ jsx(
    Animated.ScrollView,
    {
      ref: listRef,
      style: [{ maxHeight: resolvedMax }, style],
      contentContainerStyle,
      onScroll,
      scrollEventThrottle: 16,
      decelerationRate: motion.scrollDeceleration,
      bounces: true,
      alwaysBounceVertical: false,
      overScrollMode: "never",
      keyboardShouldPersistTaps: "handled",
      showsVerticalScrollIndicator: false,
      children
    }
  ) });
};
var TrayIcon = ({ children }) => {
  const { palette } = useTrayContext("Tray.Icon");
  const color = useTrayTint(palette.text);
  return /* @__PURE__ */ jsx(TrayTintContext.Provider, { value: color, children });
};
var styles = StyleSheet.create({
  fill: {
    flex: 1,
    justifyContent: "flex-end"
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject
  },
  backdropFill: {
    ...StyleSheet.absoluteFillObject
  },
  wrap: {
    paddingHorizontal: 10
  },
  layout: {
    width: "100%"
  },
  sheet: {
    borderWidth: StyleSheet.hairlineWidth,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.18,
        shadowRadius: 12
      },
      android: { elevation: 12 }
    })
  },
  clip: {
    overflow: "hidden",
    justifyContent: "flex-end"
  },
  handleArea: {
    alignItems: "center",
    paddingTop: 10,
    paddingBottom: 2
  },
  handle: {
    width: 38,
    height: 5,
    borderRadius: 3
  },
  activeLayer: {
    width: "100%"
  },
  idleLayer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 12
  },
  title: { fontSize: 18, fontWeight: "600", flexShrink: 1 },
  subtitle: { fontSize: 13, marginTop: 2 },
  body: { paddingHorizontal: 20, paddingBottom: 16 },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 10
  },
  glyph: { fontSize: 18, fontWeight: "600" }
});
var Tray = createCompoundComponent("Tray", memo(TrayRoot), {
  Trigger: createCompoundComponent("Tray.Trigger", TrayTrigger),
  Content: createCompoundComponent("Tray.Content", TrayContent),
  View: createCompoundComponent("Tray.View", TrayView),
  Header: createCompoundComponent("Tray.Header", TrayHeader),
  Title: createCompoundComponent("Tray.Title", TrayTitle),
  Subtitle: createCompoundComponent("Tray.Subtitle", TraySubtitle),
  Body: createCompoundComponent("Tray.Body", TrayBody),
  Footer: createCompoundComponent("Tray.Footer", TrayFooter),
  Close: createCompoundComponent("Tray.Close", TrayClose),
  Back: createCompoundComponent("Tray.Back", TrayBack),
  ScrollView: createCompoundComponent("Tray.ScrollView", TrayScrollView),
  Icon: createCompoundComponent("Tray.Icon", TrayIcon)
});
var index_default = Tray;
export {
  Tray,
  TrayBack,
  TrayBody,
  TrayClose,
  TrayContent,
  TrayFooter,
  TrayHeader,
  TrayRoot,
  TrayScrollView,
  TraySubtitle,
  TrayTitle,
  TrayTrigger,
  TrayView,
  index_default as default,
  useTray
};
