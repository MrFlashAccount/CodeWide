import Ionicons from "@expo/vector-icons/Ionicons";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
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

import { useEvent } from "../react/useEvent";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { spacing, touchTarget } from "../theme";
import { ActionMenu, type ActionMenuItem } from "../ui/ActionMenu";
import { useAppDialog } from "../ui/AppDialog";
import { useAppFullscreenOverlay, type AppFullscreenOverlayController } from "../ui/AppFullscreenOverlay";
import { AppText as Text } from "../ui/Typography";

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
type ImageAnnotationHandler = (item: ImagePreviewItem, onAttached: () => void) => Promise<void>;
type PreviewController = {
  open(request: ImagePreviewRequest, fullscreen: AppFullscreenOverlayController): void;
  register(groupId: string, item: ImagePreviewItem): () => void;
  registerAnnotationHandler(handler: ImageAnnotationHandler): () => void;
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
  const annotationRegistrationRef = useRef<ImageAnnotationHandler | null>(null);
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
          getAnnotationHandler={() => annotationRegistrationRef.current}
          onClose={close}
        />
      ));
    },
    registerAnnotationHandler(handler) {
      const registration = handler;
      annotationRegistrationRef.current = registration;
      return () => {
        if (annotationRegistrationRef.current !== registration) return;
        annotationRegistrationRef.current = null;
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
  getAnnotationHandler(): ImageAnnotationHandler | null;
  onClose(): void;
}) {
  const dialog = useAppDialog();
  const [session, setSession] = useState(initialSession);
  const [preparingAnnotation, setPreparingAnnotation] = useState(false);
  const annotate = async () => {
    const annotationHandler = getAnnotationHandler();
    const item = session.items[session.index];
    if (annotationHandler === null || item === undefined || preparingAnnotation) return;
    setPreparingAnnotation(true);
    await annotationHandler(item, onClose).catch((cause: unknown) => {
      dialog.alert("Could not annotate image", cause instanceof Error ? cause.message : "Image could not be opened in QuickDraw");
    });
    setPreparingAnnotation(false);
  };
  return (
    <GestureHandlerRootView style={styles.overlay}>
      <ImageViewer
        session={session}
        annotationPreparing={preparingAnnotation}
        onChangeIndex={(index) => setSession((current) => ({ ...current, index }))}
        onClose={onClose}
        {...(getAnnotationHandler() === null ? {} : { onAnnotate: () => void annotate() })}
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
  return useEvent((request: ImagePreviewRequest, fullscreenOverride?: AppFullscreenOverlayController) => {
    controller.open(request, fullscreenOverride ?? fullscreen);
  });
}

export function useImagePreviewGroup(): string | null {
  return useContext(ImagePreviewGroupContext);
}

export function useImagePreviewAnnotationHandler(handler: ImageAnnotationHandler): void {
  const { registerAnnotationHandler } = useContext(ImagePreviewContext);
  const handleAnnotation = useEvent(handler);
  useEffect(
    () => registerAnnotationHandler((item, onAttached) => handleAnnotation(item, onAttached)),
    [handleAnnotation, registerAnnotationHandler],
  );
}

export function useRegisterImagePreviewItem(groupId: string | null, item: ImagePreviewItem): void {
  const { register } = useContext(ImagePreviewContext);
  const headersKey = JSON.stringify(item.source.headers ?? {});
  const registerCurrentItem = useEvent(() => {
    if (groupId === null) return;
    return register(groupId, item);
  });
  useEffect(() => {
    return registerCurrentItem();
  }, [groupId, headersKey, item.id, item.label, item.link, item.order, item.reference, item.source.uri, register, registerCurrentItem]);
}

function ImageViewer({
  session,
  annotationPreparing,
  onChangeIndex,
  onClose,
  onAnnotate,
}: {
  session: PreviewSession;
  annotationPreparing: boolean;
  onChangeIndex(index: number): void;
  onClose(): void;
  onAnnotate?(): void;
}) {
  const insets = useSafeAreaInsets();
  const item = session.items[session.index];
  if (item === undefined) return null;
  const imageActions: ActionMenuItem[] = [
    ...(item.download === null || item.download === undefined ? [] : [{ id: "download", label: "Download", icon: "download-outline" as const }]),
    ...(item.link === null || item.link === undefined || item.link === item.source.uri ? [] : [{ id: "open", label: "Open link", icon: "open-outline" as const }]),
  ];
  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}> 
      <ZoomableImage
        key={item.id}
        item={item}
        canGoPrevious={session.index > 0}
        canGoNext={session.index < session.items.length - 1}
        onPrevious={() => onChangeIndex(session.index - 1)}
        onNext={() => onChangeIndex(session.index + 1)}
        onClose={onClose}
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
          {onAnnotate !== undefined && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Annotate image in QuickDraw"
              disabled={annotationPreparing}
              onPress={onAnnotate}
              style={[styles.roundButton, annotationPreparing && styles.disabled]}
            >
              {annotationPreparing
                ? <ActivityIndicator size="small" color="#ffffff" />
                : <Ionicons name="brush-outline" size={20} color="#ffffff" />}
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

function ZoomableImage({
  item,
  canGoPrevious,
  canGoNext,
  onPrevious,
  onNext,
  onClose,
}: {
  item: ImagePreviewItem;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onPrevious(): void;
  onNext(): void;
  onClose(): void;
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

  const gestures = Gesture.Simultaneous(pan, pinch, doubleTap);
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
  counterPill: { minHeight: 30, borderRadius: 16, backgroundColor: "rgba(36,36,36,0.82)", paddingHorizontal: 12, alignItems: "center", justifyContent: "center" },
  counterText: { color: "#ffffff", fontSize: 12, fontWeight: "600" },
  disabled: { opacity: 0.4 },
});
