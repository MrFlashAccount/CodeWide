import Ionicons from "@expo/vector-icons/Ionicons";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, radii, spacing, touchTarget } from "../theme";
import { ActionMenu, type ActionMenuItem } from "../ui/ActionMenu";
import { useAppFullscreenOverlay, type AppFullscreenOverlayController } from "../ui/AppFullscreenOverlay";
import { AppText as Text, AppTextInput as TextInput } from "../ui/Typography";
import { clampNormalizedCoordinate, formatImageAnnotations, type ImagePointAnnotation } from "./image-annotations";

export type ImagePreviewItem = {
  id: string;
  label: string;
  source: { uri: string; headers?: Record<string, string> };
  link?: string | null;
  reference?: string | null;
  download?: (() => Promise<void>) | null;
  order?: number;
};

export type ImagePreviewRequest = ImagePreviewItem & {
  groupId?: string | null;
};

type PreviewSession = { items: ImagePreviewItem[]; index: number };
type RegisteredPreviewItem = ImagePreviewItem & { sequence: number };
type PreviewController = {
  open(request: ImagePreviewRequest, fullscreen: AppFullscreenOverlayController): void;
  register(groupId: string, item: ImagePreviewItem): () => void;
  registerAnnotationHandler(handler: (text: string) => void): () => void;
};

const ImagePreviewContext = createContext<PreviewController>({
  open: () => undefined,
  register: () => () => undefined,
  registerAnnotationHandler: () => () => undefined,
});
const ImagePreviewGroupContext = createContext<string | null>(null);

/**
 * Owns preview state above the virtualized timeline. A row can be recycled or
 * unmounted while the modal is open without destroying the preview.
 */
export function ImagePreviewHost({
  children,
}: {
  children: ReactNode;
}) {
  const registryRef = useRef(new Map<string, Map<string, RegisteredPreviewItem>>());
  const annotationHandlerRef = useRef<((text: string) => void) | null>(null);
  const sequenceRef = useRef(0);
  const [controller] = useState<PreviewController>(() => ({
    register(groupId, item) {
      let group = registryRef.current.get(groupId);
      if (group === undefined) {
        group = new Map();
        registryRef.current.set(groupId, group);
      }
      const sequence = sequenceRef.current;
      sequenceRef.current += 1;
      group.set(item.id, { ...item, sequence });
      return () => {
        const current = registryRef.current.get(groupId);
        current?.delete(item.id);
        if (current?.size === 0) registryRef.current.delete(groupId);
      };
    },
    open(request, fullscreen) {
      const registered = request.groupId === null || request.groupId === undefined
        ? []
        : [...(registryRef.current.get(request.groupId)?.values() ?? [])];
      const hasCurrent = registered.some((item) => item.id === request.id);
      const items = (hasCurrent ? registered : [...registered, { ...request, sequence: sequenceRef.current }])
        .sort((left, right) => (left.order ?? left.sequence) - (right.order ?? right.sequence))
        .map(({ sequence: _sequence, ...item }) => item);
      const index = Math.max(0, items.findIndex((item) => item.id === request.id));
      fullscreen.present(({ close }) => (
        <ImagePreviewSession
          initialSession={{ items, index }}
          getAnnotationHandler={() => annotationHandlerRef.current}
          onClose={close}
        />
      ));
    },
    registerAnnotationHandler(handler) {
      annotationHandlerRef.current = handler;
      return () => {
        if (annotationHandlerRef.current !== handler) return;
        annotationHandlerRef.current = null;
      };
    },
  }));

  return (
    <ImagePreviewContext.Provider value={controller}>
      <View style={styles.host}>{children}</View>
    </ImagePreviewContext.Provider>
  );
}

function ImagePreviewSession({
  initialSession,
  getAnnotationHandler,
  onClose,
}: {
  initialSession: PreviewSession;
  getAnnotationHandler(): ((text: string) => void) | null;
  onClose(): void;
}) {
  const [session, setSession] = useState(initialSession);
  const [annotations, setAnnotations] = useState<Record<string, ImagePointAnnotation[]>>({});
  const close = () => {
    onClose();
  };
  const annotationCount = session.items.reduce((count, item) => count + (annotations[item.id]?.length ?? 0), 0);
  const submitAnnotations = () => {
    const annotationHandler = getAnnotationHandler();
    if (annotationHandler === null) return;
    const text = formatImageAnnotations(session.items.map((item) => ({
      label: item.label,
      reference: item.reference ?? item.link ?? null,
      annotations: annotations[item.id] ?? [],
    })));
    if (text === "") return;
    annotationHandler(text);
    setAnnotations({});
    close();
  };
  return (
    <GestureHandlerRootView style={styles.overlay}>
      <ImageViewer
        session={session}
        annotations={annotations}
        annotationCount={annotationCount}
        onChangeIndex={(index) => setSession((current) => ({ ...current, index }))}
        onChangeAnnotations={(itemId, points) => setAnnotations((current) => ({ ...current, [itemId]: points }))}
        onClose={close}
        onSubmitAnnotations={submitAnnotations}
      />
    </GestureHandlerRootView>
  );
}

export function ImagePreviewGroup({ id, children }: { id: string; children: ReactNode }) {
  return <ImagePreviewGroupContext.Provider value={id}>{children}</ImagePreviewGroupContext.Provider>;
}

export function useImagePreview(): (request: ImagePreviewRequest, fullscreenOverride?: AppFullscreenOverlayController) => void {
  const controller = useContext(ImagePreviewContext);
  const fullscreen = useAppFullscreenOverlay();
  return (request, fullscreenOverride) => controller.open(request, fullscreenOverride ?? fullscreen);
}

export function useImagePreviewGroup(): string | null {
  return useContext(ImagePreviewGroupContext);
}

export function useImagePreviewAnnotationHandler(handler: (text: string) => void): void {
  const { registerAnnotationHandler } = useContext(ImagePreviewContext);
  const handleAnnotation = useEffectEvent(handler);
  useEffect(() => registerAnnotationHandler((text) => handleAnnotation(text)), [registerAnnotationHandler]);
}

export function useRegisterImagePreviewItem(groupId: string | null, item: ImagePreviewItem): void {
  const { register } = useContext(ImagePreviewContext);
  const headersKey = JSON.stringify(item.source.headers ?? {});
  const registerCurrentItem = useEffectEvent(() => {
    if (groupId === null) return;
    return register(groupId, item);
  });
  useEffect(() => {
    return registerCurrentItem();
  }, [groupId, headersKey, item.id, item.label, item.link, item.order, item.reference, item.source.uri, register]);
}

function ImageViewer({
  session,
  annotations,
  annotationCount,
  onChangeIndex,
  onChangeAnnotations,
  onClose,
  onSubmitAnnotations,
}: {
  session: PreviewSession;
  annotations: Record<string, ImagePointAnnotation[]>;
  annotationCount: number;
  onChangeIndex(index: number): void;
  onChangeAnnotations(itemId: string, points: ImagePointAnnotation[]): void;
  onClose(): void;
  onSubmitAnnotations?(): void;
}) {
  const insets = useSafeAreaInsets();
  const item = session.items[session.index];
  const [annotating, setAnnotating] = useState(false);
  const [pendingPoint, setPendingPoint] = useState<{ x: number; y: number } | null>(null);
  const [caption, setCaption] = useState("");
  if (item === undefined) return null;
  const points = annotations[item.id] ?? [];
  const imageActions: ActionMenuItem[] = [
    ...(item.download === null || item.download === undefined ? [] : [{ id: "download", label: "Download", icon: "download-outline" as const }]),
    ...(item.link === null || item.link === undefined || item.link === item.source.uri ? [] : [{ id: "open", label: "Open link", icon: "open-outline" as const }]),
  ];
  const savePoint = () => {
    const text = caption.trim();
    if (pendingPoint === null || text === "") return;
    onChangeAnnotations(item.id, [...points, {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      x: pendingPoint.x,
      y: pendingPoint.y,
      text,
    }]);
    setPendingPoint(null);
    setCaption("");
  };
  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}> 
      <ZoomableImage
        key={item.id}
        item={item}
        points={points}
        pendingPoint={pendingPoint}
        annotating={annotating}
        canGoPrevious={session.index > 0}
        canGoNext={session.index < session.items.length - 1}
        onPrevious={() => onChangeIndex(session.index - 1)}
        onNext={() => onChangeIndex(session.index + 1)}
        onClose={onClose}
        onCreatePoint={(point) => {
          setPendingPoint(point);
          setCaption("");
        }}
      />
      <View pointerEvents="box-none" style={[styles.topBar, { top: insets.top + spacing.xs }]}> 
        <Pressable accessibilityRole="button" accessibilityLabel="Close image" onPress={onClose} style={styles.roundButton}>
          <Ionicons name="close" size={23} color="#ffffff" />
        </Pressable>
        <View style={styles.counterPill}>
          <Text style={styles.counterText}>{session.index + 1} / {session.items.length}</Text>
        </View>
        <View style={styles.topBarActions}>
          {imageActions.length > 0 && (
            <ActionMenu
              accessibilityLabel="Image actions"
              actions={imageActions}
              onSelect={(id) => {
                if (id === "download") void item.download?.();
                else if (id === "open" && item.link !== null && item.link !== undefined) void Linking.openURL(item.link);
              }}
              style={styles.imageMenuAnchor}
            >
              <Pressable style={styles.roundButton}>
                <Ionicons name="ellipsis-horizontal" size={20} color="#ffffff" />
              </Pressable>
            </ActionMenu>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={annotating ? "Stop annotating image" : "Annotate image"}
            onPress={() => setAnnotating((current) => !current)}
            style={[styles.roundButton, annotating && styles.activeButton]}
          >
            <Ionicons name="pin-outline" size={19} color={annotating ? "#0b0b0b" : "#ffffff"} />
          </Pressable>
        </View>
      </View>
      {points.length > 0 && (
        <View style={[styles.annotationStrip, { bottom: insets.bottom + spacing.lg }]}> 
          <View style={styles.annotationSummary}>
            <Ionicons name="pin" size={16} color={colors.accent} />
            <Text numberOfLines={1} style={styles.annotationSummaryText}>{points.length} · {points.at(-1)?.text ?? `${annotationCount} total`}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Remove last annotation"
            onPress={() => onChangeAnnotations(item.id, points.slice(0, -1))}
            style={styles.smallButton}
          >
            <Ionicons name="arrow-undo" size={17} color="#ffffff" />
          </Pressable>
          {onSubmitAnnotations !== undefined && (
            <Pressable accessibilityRole="button" accessibilityLabel="Add image annotations to message" onPress={onSubmitAnnotations} style={styles.submitButton}>
              <Ionicons name="return-down-back" size={18} color="#0b0b0b" />
              <Text style={styles.submitText}>Add to message</Text>
            </Pressable>
          )}
        </View>
      )}
      {annotating && pendingPoint === null && (
        <View pointerEvents="none" style={[styles.annotationHint, { bottom: insets.bottom + (points.length > 0 ? 82 : 24) }]}> 
          <Text style={styles.annotationHintText}>Tap the image to place a point</Text>
        </View>
      )}
      {pendingPoint !== null && (
        <KeyboardStickyView
          offset={{ closed: -Math.max(insets.bottom, spacing.sm), opened: -spacing.sm }}
          style={styles.captionEditorSticky}
        >
        <View style={styles.captionEditor}> 
          <TextInput
            autoFocus
            value={caption}
            onChangeText={setCaption}
            onSubmitEditing={savePoint}
            returnKeyType="done"
            placeholder="What should change here?"
            placeholderTextColor="#8f8f8f"
            style={styles.captionInput}
          />
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel annotation" onPress={() => setPendingPoint(null)} style={styles.smallButton}>
            <Ionicons name="close" size={19} color="#ffffff" />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Save annotation" disabled={caption.trim() === ""} onPress={savePoint} style={[styles.captionSave, caption.trim() === "" && styles.disabled]}>
            <Ionicons name="checkmark" size={20} color="#0b0b0b" />
          </Pressable>
        </View>
        </KeyboardStickyView>
      )}
    </View>
  );
}

function ZoomableImage({
  item,
  points,
  pendingPoint,
  annotating,
  canGoPrevious,
  canGoNext,
  onPrevious,
  onNext,
  onClose,
  onCreatePoint,
}: {
  item: ImagePreviewItem;
  points: ImagePointAnnotation[];
  pendingPoint: { x: number; y: number } | null;
  annotating: boolean;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onPrevious(): void;
  onNext(): void;
  onClose(): void;
  onCreatePoint(point: { x: number; y: number }): void;
}) {
  const [viewport, setViewport] = useState({ width: 1, height: 1 });
  const [intrinsic, setIntrinsic] = useState({ width: 1, height: 1 });
  const [decodeState, setDecodeState] = useState<"loading" | "ready" | "error">("loading");
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);
  const pageOffset = useSharedValue(0);
  const dismissOpacity = useSharedValue(1);
  const gestureAxis = useSharedValue<0 | 1 | 2 | 3>(0);
  const fit = containSize(intrinsic.width, intrinsic.height, viewport.width, viewport.height);

  const navigate = (direction: -1 | 1) => {
    if (direction < 0) onPrevious();
    else onNext();
  };

  const pan = Gesture.Pan()
    .minDistance(4)
    .averageTouches(true)
    .onBegin(() => {
      savedX.set(translateX.get());
      savedY.set(translateY.get());
      gestureAxis.set(scale.get() > 1.01 ? 3 : 0);
    })
    .onUpdate((event) => {
      if (scale.get() > 1.01 || event.numberOfPointers > 1) {
        gestureAxis.set(3);
        const maxX = Math.max(0, (fit.width * scale.get() - viewport.width) / 2);
        const maxY = Math.max(0, (fit.height * scale.get() - viewport.height) / 2);
        translateX.set(Math.max(-maxX, Math.min(maxX, savedX.get() + event.translationX)));
        translateY.set(Math.max(-maxY, Math.min(maxY, savedY.get() + event.translationY)));
        return;
      }
      if (gestureAxis.get() === 0) {
        const horizontalDistance = Math.abs(event.translationX);
        const verticalDistance = Math.abs(event.translationY);
        if (Math.max(horizontalDistance, verticalDistance) < 8) return;
        gestureAxis.set(horizontalDistance > verticalDistance ? 1 : 2);
      }
      if (gestureAxis.get() === 1) {
        translateY.set(0);
        dismissOpacity.set(1);
        pageOffset.set(event.translationX);
      } else if (gestureAxis.get() === 2) {
        pageOffset.set(0);
        translateY.set(event.translationY);
        dismissOpacity.set(Math.max(0.35, 1 - Math.abs(event.translationY) / Math.max(1, viewport.height * 0.55)));
      }
    })
    .onEnd((event) => {
      if (gestureAxis.get() === 3 || scale.get() > 1.01) {
        gestureAxis.set(0);
        return;
      }
      if (gestureAxis.get() === 1) {
        const direction = event.translationX < 0 ? 1 : -1;
        const allowed = direction > 0 ? canGoNext : canGoPrevious;
        if (allowed && (Math.abs(event.translationX) > viewport.width * 0.16 || Math.abs(event.velocityX) > 720)) {
          pageOffset.set(withTiming(direction > 0 ? -viewport.width : viewport.width, { duration: 120, easing: Easing.out(Easing.cubic) }, (finished) => {
            if (finished) runOnJS(navigate)(direction);
          }));
          gestureAxis.set(0);
          return;
        }
        pageOffset.set(withTiming(0, { duration: 110, easing: Easing.out(Easing.cubic) }));
        gestureAxis.set(0);
        return;
      }
      if (gestureAxis.get() === 2 && (Math.abs(event.translationY) > viewport.height * 0.14 || Math.abs(event.velocityY) > 820)) {
        translateY.set(withTiming(event.translationY < 0 ? -viewport.height : viewport.height, { duration: 130, easing: Easing.out(Easing.cubic) }, (finished) => {
          if (finished) runOnJS(onClose)();
        }));
        dismissOpacity.set(withTiming(0, { duration: 130, easing: Easing.out(Easing.cubic) }));
      } else {
        translateY.set(withTiming(0, { duration: 110, easing: Easing.out(Easing.cubic) }));
        dismissOpacity.set(withTiming(1, { duration: 110, easing: Easing.out(Easing.cubic) }));
      }
      gestureAxis.set(0);
    });

  const pinch = Gesture.Pinch()
    .onBegin(() => {
      savedScale.set(scale.get());
    })
    .onUpdate((event) => {
      scale.set(Math.max(1, Math.min(5, savedScale.get() * event.scale)));
    })
    .onEnd(() => {
      if (scale.get() < 1.04) {
        scale.set(withTiming(1, { duration: 100, easing: Easing.out(Easing.cubic) }));
        translateX.set(withTiming(0, { duration: 100, easing: Easing.out(Easing.cubic) }));
        translateY.set(withTiming(0, { duration: 100, easing: Easing.out(Easing.cubic) }));
        return;
      }
      const maxX = Math.max(0, (fit.width * scale.get() - viewport.width) / 2);
      const maxY = Math.max(0, (fit.height * scale.get() - viewport.height) / 2);
      translateX.set(withTiming(Math.max(-maxX, Math.min(maxX, translateX.get())), { duration: 100, easing: Easing.out(Easing.cubic) }));
      translateY.set(withTiming(Math.max(-maxY, Math.min(maxY, translateY.get())), { duration: 100, easing: Easing.out(Easing.cubic) }));
    });

  const doubleTap = Gesture.Tap().numberOfTaps(2).maxDuration(260).onEnd((event, success) => {
    if (!success) return;
    const zoomed = scale.get() > 1.01;
    const targetScale = zoomed ? 1 : 2.5;
    scale.set(withTiming(targetScale, { duration: 150, easing: Easing.out(Easing.cubic) }));
    if (zoomed) {
      translateX.set(withTiming(0, { duration: 150, easing: Easing.out(Easing.cubic) }));
      translateY.set(withTiming(0, { duration: 150, easing: Easing.out(Easing.cubic) }));
    } else {
      const nextX = (viewport.width / 2 - event.x) * (targetScale - 1);
      const nextY = (viewport.height / 2 - event.y) * (targetScale - 1);
      const maxX = Math.max(0, (fit.width * targetScale - viewport.width) / 2);
      const maxY = Math.max(0, (fit.height * targetScale - viewport.height) / 2);
      translateX.set(withTiming(Math.max(-maxX, Math.min(maxX, nextX)), { duration: 150, easing: Easing.out(Easing.cubic) }));
      translateY.set(withTiming(Math.max(-maxY, Math.min(maxY, nextY)), { duration: 150, easing: Easing.out(Easing.cubic) }));
    }
  });

  const annotationTap = Gesture.Tap().numberOfTaps(1).maxDistance(8).runOnJS(true).onEnd((event, success) => {
    if (!success || !annotating) return;
    const localX = (event.x - viewport.width / 2 - translateX.get()) / scale.get() + fit.width / 2;
    const localY = (event.y - viewport.height / 2 - translateY.get()) / scale.get() + fit.height / 2;
    if (localX < 0 || localY < 0 || localX > fit.width || localY > fit.height) return;
    onCreatePoint({
      x: clampNormalizedCoordinate(localX / fit.width),
      y: clampNormalizedCoordinate(localY / fit.height),
    });
  });

  const gestures = Gesture.Simultaneous(pan, pinch, Gesture.Exclusive(doubleTap, annotationTap));
  const imageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.get() + pageOffset.get() },
      { translateY: translateY.get() },
      { scale: scale.get() },
    ],
  }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: dismissOpacity.get() }));

  return (
    <Animated.View
      style={[styles.viewer, backdropStyle]}
      onLayout={({ nativeEvent }) => setViewport({
        width: Math.max(1, nativeEvent.layout.width),
        height: Math.max(1, nativeEvent.layout.height),
      })}
    >
      <GestureDetector gesture={gestures}>
        <View style={styles.gestureSurface}>
          {decodeState === "loading" && (
            <View pointerEvents="none" style={styles.imageStatus}>
              <ActivityIndicator color="#ffffff" />
            </View>
          )}
          {decodeState === "error" && (
            <View pointerEvents="none" style={styles.imageStatus}>
              <Ionicons name="image-outline" size={28} color="#ffffff" />
              <Text style={styles.imageError}>Image decode failed</Text>
            </View>
          )}
          <Animated.View style={[styles.imageLayer, { width: fit.width, height: fit.height }, imageStyle]}>
            <Image
              accessibilityLabel={`${item.label} full screen`}
              source={item.source}
              resizeMode="contain"
              resizeMethod="none"
              style={styles.image}
              onLoadStart={() => setDecodeState("loading")}
              onLoad={({ nativeEvent }) => {
                setDecodeState("ready");
                // React Native Web omits `source` from this event. Native
                // Android includes it, which is where intrinsic sizing matters.
                const loadedSource = nativeEvent.source;
                if (loadedSource === undefined) return;
                const width = loadedSource.width;
                const height = loadedSource.height;
                if (width > 0 && height > 0) setIntrinsic({ width, height });
              }}
              onError={() => setDecodeState("error")}
            />
            {points.map((point, index) => (
              <View
                key={point.id}
                accessible
                accessibilityLabel={`Annotation ${index + 1}: ${point.text}`}
                style={[styles.pin, { left: `${point.x * 100}%`, top: `${point.y * 100}%` }]}
              >
                <Text style={styles.pinText}>{index + 1}</Text>
              </View>
            ))}
            {pendingPoint !== null && (
              <View
                accessible
                accessibilityLabel="New annotation point"
                style={[styles.pin, styles.pendingPin, { left: `${pendingPoint.x * 100}%`, top: `${pendingPoint.y * 100}%` }]}
              >
                <Text style={styles.pinText}>{points.length + 1}</Text>
              </View>
            )}
          </Animated.View>
        </View>
      </GestureDetector>
    </Animated.View>
  );
}

function containSize(imageWidth: number, imageHeight: number, viewportWidth: number, viewportHeight: number): { width: number; height: number } {
  const ratio = Math.min(viewportWidth / Math.max(1, imageWidth), viewportHeight / Math.max(1, imageHeight));
  return {
    width: Math.max(1, imageWidth * ratio),
    height: Math.max(1, imageHeight * ratio),
  };
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  host: { flex: 1, minWidth: 0, minHeight: 0, position: "relative" },
  overlay: { flex: 1, backgroundColor: "#000000" },
  root: { flex: 1, backgroundColor: "#000000" },
  viewer: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: "#000000" },
  gestureSurface: { flex: 1, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  imageStatus: { position: "absolute", alignItems: "center", justifyContent: "center", gap: spacing.sm, zIndex: 2 },
  imageError: { color: "#ffffff", fontSize: 13, fontWeight: "600" },
  imageLayer: { alignItems: "center", justifyContent: "center" },
  image: { width: "100%", height: "100%" },
  topBar: { position: "absolute", left: spacing.sm, right: spacing.sm, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  topBarActions: { flexDirection: "row", gap: spacing.xs },
  roundButton: { width: touchTarget, height: touchTarget, borderRadius: touchTarget / 2, backgroundColor: "rgba(36,36,36,0.9)", alignItems: "center", justifyContent: "center" },
  imageMenuAnchor: { width: touchTarget, height: touchTarget },
  activeButton: { backgroundColor: colors.accent, borderWidth: 1, borderColor: "rgba(255,255,255,0.72)" },
  counterPill: { minHeight: 30, borderRadius: 16, backgroundColor: "rgba(36,36,36,0.82)", paddingHorizontal: 12, alignItems: "center", justifyContent: "center" },
  counterText: { color: "#ffffff", fontSize: 12, fontWeight: "600" },
  pin: { position: "absolute", width: 30, height: 30, marginLeft: -15, marginTop: -15, borderRadius: 15, borderWidth: 2, borderColor: "#ffffff", backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", elevation: 4 },
  pinText: { color: "#0b0b0b", fontSize: 12, fontWeight: "800" },
  pendingPin: { borderStyle: "dashed", transform: [{ scale: 1.08 }] },
  annotationHint: { position: "absolute", alignSelf: "center", borderRadius: 18, backgroundColor: "rgba(36,36,36,0.9)", paddingHorizontal: 14, paddingVertical: 9 },
  annotationHintText: { color: "#ffffff", fontSize: 12, fontWeight: "600" },
  annotationStrip: { position: "absolute", left: spacing.sm, right: spacing.sm, minHeight: touchTarget, flexDirection: "row", alignItems: "center", gap: spacing.xs, borderRadius: radii.large, backgroundColor: "rgba(28,28,28,0.96)", padding: spacing.xs },
  annotationSummary: { minWidth: 0, flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.xs },
  annotationSummaryText: { minWidth: 0, flexShrink: 1, color: "#ffffff", fontSize: 12 },
  smallButton: { width: touchTarget, height: touchTarget, borderRadius: touchTarget / 2, backgroundColor: "#303030", alignItems: "center", justifyContent: "center" },
  submitButton: { minHeight: touchTarget, flexDirection: "row", alignItems: "center", gap: 6, borderRadius: touchTarget / 2, backgroundColor: colors.accent, paddingHorizontal: 14 },
  submitText: { color: "#0b0b0b", fontSize: 12, fontWeight: "700" },
  captionEditorSticky: { position: "absolute", left: 0, right: 0, bottom: 0 },
  captionEditor: { marginHorizontal: spacing.sm, minHeight: touchTarget + spacing.sm, flexDirection: "row", alignItems: "center", gap: spacing.xs, borderRadius: radii.large, backgroundColor: "#1c1c1c", padding: spacing.xs },
  captionInput: { minWidth: 0, flex: 1, minHeight: touchTarget, borderRadius: touchTarget / 2, backgroundColor: "#292929", color: "#ffffff", paddingHorizontal: 14, paddingVertical: spacing.xs, fontSize: 14 },
  captionSave: { width: touchTarget, height: touchTarget, borderRadius: touchTarget / 2, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  disabled: { opacity: 0.4 },
});
