// Generated from vendored Reacticx source. Do not edit.

// vendor/reacticx/src/components/organisms/masked-tab-bar/index.tsx
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  StyleSheet,
  Text,
  View
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withSpring as withSpring2
} from "react-native-reanimated";
import { scheduleOnRN as scheduleOnRN2 } from "react-native-worklets";

// vendor/reacticx/src/components/organisms/masked-tab-bar/const.ts
var DEFAULT_HEIGHT = 52;
var DEFAULT_PADDING = 5;
var DEFAULT_GAP = 6;
var DEFAULT_ICON_SIZE = 20;
var DEFAULT_FONT_SIZE = 15;
var DEFAULT_TRIGGER_PADDING_X = 14;
var DEFAULT_TRIGGER_GAP = 8;
var PRESS_GROW = 4;
var PILL_SPRING = {
  damping: 30,
  stiffness: 150,
  mass: 0.5
};
var PRESS_SPRING = {
  damping: 20,
  stiffness: 150,
  mass: 1
};
var FOLLOW_STIFFNESS = 220;
var FOLLOW_DAMPING = 24;
var MAX_FRAME_SECONDS = 1 / 30;
var LIGHT_PALETTE = {
  track: "rgba(118,118,128,0.12)",
  pill: "#ffffff",
  inactive: "rgba(60,60,67,0.5)",
  active: "#000000"
};
var DARK_PALETTE = {
  track: "rgba(118,118,128,0.24)",
  pill: "#ffffff",
  inactive: "rgba(235,235,245,0.55)",
  active: "#000000"
};
var PALETTES = {
  light: LIGHT_PALETTE,
  dark: DARK_PALETTE
};

// vendor/reacticx/src/components/organisms/masked-tab-bar/context.tsx
import { createContext, useContext } from "react";
var MaskedTabBarContext = createContext(null);
function useMaskedTabBar(part) {
  const ctx = useContext(MaskedTabBarContext);
  if (!ctx) {
    throw new Error(`<${part}> must be rendered inside <MaskedTabBar>`);
  }
  return ctx;
}
var MaskedTabLayerContext = createContext("base");
function useMaskedTabLayer() {
  return useContext(MaskedTabLayerContext);
}

// vendor/reacticx/src/components/organisms/masked-tab-bar/motion.ts
import { withSpring } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
function startPillSelectionOnUI(target, pillX, pillWidth, selectValue) {
  "worklet";
  pillX.value = withSpring(target.x, PILL_SPRING);
  pillWidth.value = withSpring(target.width, PILL_SPRING);
  scheduleOnRN(selectValue, target.value);
}

// vendor/reacticx/src/utils/create-compound-component/index.ts
function createCompoundComponent(name, component, compound = {}) {
  component.displayName = name;
  return Object.assign(component, compound);
}

// vendor/reacticx/src/components/organisms/masked-tab-bar/index.tsx
import { jsx, jsxs } from "react/jsx-runtime";
function clampValue(value, min, max) {
  "worklet";
  return Math.min(Math.max(value, min), max);
}
function boxAtX(list, x) {
  "worklet";
  for (let i = 0; i < list.length; i += 1) {
    const box = list[i];
    if (x >= box.x && x <= box.x + box.width) {
      return box.disabled ? null : box;
    }
  }
  return null;
}
function nearestBox(list, center) {
  "worklet";
  let best = null;
  let bestDistance = Number.MAX_VALUE;
  for (let i = 0; i < list.length; i += 1) {
    const box = list[i];
    if (box.disabled) continue;
    const distance = Math.abs(box.x + box.width / 2 - center);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = box;
    }
  }
  return best;
}
var MaskedTabBarRoot = ({
  children,
  value: valueProp,
  defaultValue,
  onValueChange,
  theme = "light",
  palette: paletteProp,
  height = DEFAULT_HEIGHT,
  radius,
  padding = DEFAULT_PADDING,
  gap = DEFAULT_GAP,
  iconSize = DEFAULT_ICON_SIZE,
  fontSize = DEFAULT_FONT_SIZE,
  fontWeight = "600",
  draggable = true,
  style
}) => {
  const isControlled = valueProp !== void 0;
  const [internalValue, setInternalValue] = useState(
    defaultValue ?? ""
  );
  const value = isControlled ? valueProp : internalValue;
  const [boxMap, setBoxMap] = useState({});
  const [listWidth, setListWidth] = useState(0);
  const pillX = useSharedValue(0);
  const pillWidth = useSharedValue(0);
  const press = useSharedValue(0);
  const grabbed = useSharedValue(false);
  const palette = useMemo(
    () => ({ ...PALETTES[theme], ...paletteProp }),
    [theme, paletteProp]
  );
  const setValue = useCallback(
    (next) => {
      if (next === value) return;
      if (!isControlled) setInternalValue(next);
      onValueChange?.(next);
    },
    [value, isControlled, onValueChange]
  );
  const registerTrigger = useCallback(
    (key, box, disabled) => {
      setBoxMap((prev) => {
        const current = prev[key];
        if (current && current.disabled === disabled && Math.abs(current.x - box.x) < 0.5 && Math.abs(current.width - box.width) < 0.5) {
          return prev;
        }
        return { ...prev, [key]: { ...box, disabled } };
      });
    },
    []
  );
  const boxes = useMemo(
    () => Object.entries(boxMap).map(([key, box]) => ({ ...box, value: key })).sort((a, b) => a.x - b.x),
    [boxMap]
  );
  useEffect(() => {
    if (value || boxes.length === 0) return;
    setValue(boxes[0].value);
  }, [value, boxes, setValue]);
  const activeBox = boxMap[value];
  const placedRef = useRef(false);
  useEffect(() => {
    if (!activeBox) return;
    if (grabbed.value) return;
    if (!placedRef.current) {
      placedRef.current = true;
      pillX.value = activeBox.x;
      pillWidth.value = activeBox.width;
      return;
    }
    pillX.value = withSpring2(activeBox.x, PILL_SPRING);
    pillWidth.value = withSpring2(activeBox.width, PILL_SPRING);
  }, [activeBox, pillX, pillWidth, grabbed]);
  const ctx = useMemo(
    () => ({
      value,
      setValue,
      registerTrigger,
      boxes,
      listWidth,
      setListWidth,
      pillX,
      pillWidth,
      press,
      grabbed,
      palette,
      height,
      radius: radius ?? height / 2,
      padding,
      gap,
      iconSize,
      fontSize,
      fontWeight,
      draggable
    }),
    [
      value,
      setValue,
      registerTrigger,
      boxes,
      listWidth,
      pillX,
      pillWidth,
      press,
      grabbed,
      palette,
      height,
      radius,
      padding,
      gap,
      iconSize,
      fontSize,
      fontWeight,
      draggable
    ]
  );
  return /* @__PURE__ */ jsx(MaskedTabBarContext.Provider, { value: ctx, children: /* @__PURE__ */ jsx(
    View,
    {
      style: [
        styles.root,
        {
          height,
          borderRadius: radius ?? height / 2,
          backgroundColor: palette.track,
          padding
        },
        style
      ],
      children
    }
  ) });
};
var MaskedTabBarList = ({
  children,
  style
}) => {
  const {
    boxes,
    setValue,
    setListWidth,
    listWidth,
    pillX,
    pillWidth,
    press,
    grabbed,
    palette,
    radius,
    padding,
    gap,
    draggable
  } = useMaskedTabBar("MaskedTabBar.List");
  const boxesValue = useSharedValue([]);
  useEffect(() => {
    boxesValue.value = boxes;
  }, [boxes, boxesValue]);
  const onLayout = useCallback(
    (e) => setListWidth(e.nativeEvent.layout.width),
    [setListWidth]
  );
  const grabOffset = useSharedValue(0);
  const dragTarget = useSharedValue(0);
  const dragVelocity = useSharedValue(0);
  const hoveredValue = useSharedValue("");
  const listWidthValue = useSharedValue(0);
  useEffect(() => {
    listWidthValue.value = listWidth;
  }, [listWidth, listWidthValue]);
  const follow = useFrameCallback((frame) => {
    if (!grabbed.value) return;
    const dt = Math.min(
      (frame.timeSincePreviousFrame ?? 16) / 1e3,
      MAX_FRAME_SECONDS
    );
    const displacement = dragTarget.value - pillX.value;
    const velocity = dragVelocity.value + (FOLLOW_STIFFNESS * displacement - FOLLOW_DAMPING * dragVelocity.value) * dt;
    dragVelocity.value = velocity;
    pillX.value = pillX.value + velocity * dt;
  }, false);
  const setFollowActive = useCallback(
    (active) => follow.setActive(active),
    [follow]
  );
  useAnimatedReaction(
    () => grabbed.value,
    (isGrabbed, wasGrabbed) => {
      if (isGrabbed !== wasGrabbed) scheduleOnRN2(setFollowActive, isGrabbed);
    }
  );
  const gesture = useMemo(
    () => Gesture.Pan().minDistance(0).shouldCancelWhenOutside(false).onBegin((e) => {
      press.value = withSpring2(1, PRESS_SPRING);
      hoveredValue.value = "";
      const inside = e.x >= pillX.value && e.x <= pillX.value + pillWidth.value;
      grabbed.value = draggable && inside;
      grabOffset.value = pillX.value - e.x;
      if (grabbed.value) {
        dragTarget.value = pillX.value;
        dragVelocity.value = 0;
      }
    }).onStart((e) => {
      if (grabbed.value) return;
      const tapped = boxAtX(boxesValue.value, e.x);
      if (tapped) startPillSelectionOnUI(tapped, pillX, pillWidth, setValue);
    }).onUpdate((e) => {
      if (!grabbed.value) return;
      dragTarget.value = clampValue(
        e.x + grabOffset.value,
        0,
        Math.max(listWidthValue.value - pillWidth.value, 0)
      );
      const over = nearestBox(
        boxesValue.value,
        dragTarget.value + pillWidth.value / 2
      );
      if (over && over.value !== hoveredValue.value) {
        hoveredValue.value = over.value;
        pillWidth.value = withSpring2(over.width, PILL_SPRING);
      }
    }).onFinalize(() => {
      press.value = withSpring2(0, PRESS_SPRING);
      if (!grabbed.value) return;
      grabbed.value = false;
      const box = nearestBox(
        boxesValue.value,
        pillX.value + pillWidth.value / 2
      );
      if (!box) return;
      pillX.value = withSpring2(box.x, {
        ...PILL_SPRING,
        velocity: dragVelocity.value
      });
      pillWidth.value = withSpring2(box.width, PILL_SPRING);
      dragVelocity.value = 0;
      scheduleOnRN2(setValue, box.value);
    }),
    [
      boxesValue,
      listWidthValue,
      grabbed,
      grabOffset,
      dragTarget,
      dragVelocity,
      hoveredValue,
      pillX,
      pillWidth,
      press,
      setValue,
      draggable
    ]
  );
  const clipStyle = useAnimatedStyle(
    () => {
      const grow = press.value * PRESS_GROW;
      return {
        width: pillWidth.value + grow * 2,
        transform: [{ translateX: pillX.value - grow }]
      };
    }
  );
  const innerStyle = useAnimatedStyle(() => {
    const grow = press.value * PRESS_GROW;
    return { transform: [{ translateX: -(pillX.value - grow) }] };
  });
  const rowStyle = useMemo(() => ({ gap }), [gap]);
  return /* @__PURE__ */ jsx(GestureDetector, { gesture, children: /* @__PURE__ */ jsxs(View, { style: [styles.list, style], onLayout, children: [
    /* @__PURE__ */ jsx(MaskedTabLayerContext.Provider, { value: "base", children: /* @__PURE__ */ jsx(View, { style: [styles.row, rowStyle], children }) }),
    /* @__PURE__ */ jsx(
      Animated.View,
      {
        pointerEvents: "none",
        style: [
          styles.clip,
          {
            borderRadius: Math.max(radius - padding, 0),
            backgroundColor: palette.pill
          },
          clipStyle
        ],
        children: /* @__PURE__ */ jsx(
          Animated.View,
          {
            style: [styles.row, rowStyle, { width: listWidth }, innerStyle],
            children: /* @__PURE__ */ jsx(MaskedTabLayerContext.Provider, { value: "active", children })
          }
        )
      }
    )
  ] }) });
};
var MaskedTabBarTrigger = ({
  children,
  value,
  disabled = false,
  style
}) => {
  const { registerTrigger } = useMaskedTabBar("MaskedTabBar.Trigger");
  const layer = useMaskedTabLayer();
  const onLayout = useCallback(
    (e) => {
      if (layer !== "base") return;
      const { x, width } = e.nativeEvent.layout;
      registerTrigger(value, { x, width }, disabled);
    },
    [layer, registerTrigger, value, disabled]
  );
  return /* @__PURE__ */ jsx(
    View,
    {
      onLayout,
      style: [styles.trigger, disabled ? styles.disabled : null, style],
      children
    }
  );
};
var MaskedTabBarLabel = ({
  children,
  style
}) => {
  const { palette, fontSize, fontWeight } = useMaskedTabBar("MaskedTabBar.Label");
  const layer = useMaskedTabLayer();
  return /* @__PURE__ */ jsx(
    Text,
    {
      numberOfLines: 1,
      style: [
        {
          fontSize,
          fontWeight,
          color: layer === "active" ? palette.active : palette.inactive
        },
        style
      ],
      children
    }
  );
};
var MaskedTabBarIcon = ({
  children,
  size,
  style
}) => {
  const { palette, iconSize } = useMaskedTabBar("MaskedTabBar.Icon");
  const layer = useMaskedTabLayer();
  const active = layer === "active";
  const resolvedSize = size ?? iconSize;
  const content = typeof children === "function" ? children({
    color: active ? palette.active : palette.inactive,
    size: resolvedSize,
    active
  }) : children;
  return /* @__PURE__ */ jsx(
    View,
    {
      style: [
        styles.icon,
        { width: resolvedSize, height: resolvedSize },
        style
      ],
      children: content
    }
  );
};
var styles = StyleSheet.create({
  root: {
    alignSelf: "stretch",
    justifyContent: "center",
    overflow: "hidden"
  },
  list: {
    flex: 1,
    justifyContent: "center"
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    height: "100%"
  },
  clip: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    overflow: "hidden"
  },
  trigger: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: DEFAULT_TRIGGER_GAP,
    paddingHorizontal: DEFAULT_TRIGGER_PADDING_X,
    height: "100%"
  },
  icon: {
    alignItems: "center",
    justifyContent: "center"
  },
  disabled: {
    opacity: 0.4
  }
});
var MaskedTabBar = createCompoundComponent(
  "MaskedTabBar",
  memo(MaskedTabBarRoot),
  {
    List: createCompoundComponent("MaskedTabBar.List", MaskedTabBarList),
    Trigger: createCompoundComponent(
      "MaskedTabBar.Trigger",
      MaskedTabBarTrigger
    ),
    Label: createCompoundComponent("MaskedTabBar.Label", MaskedTabBarLabel),
    Icon: createCompoundComponent("MaskedTabBar.Icon", MaskedTabBarIcon)
  }
);
var index_default = MaskedTabBar;
export {
  MaskedTabBar,
  MaskedTabBarIcon,
  MaskedTabBarLabel,
  MaskedTabBarList,
  MaskedTabBarRoot,
  MaskedTabBarTrigger,
  index_default as default
};
