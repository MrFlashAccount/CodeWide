import Ionicons from "@expo/vector-icons/Ionicons";
import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";

import { retainCachedAttachment } from "../native/attachment-cache/cached-transfer";
import { useConstant } from "../react/useConstant";
import { useEvent } from "../react/useEvent";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  spacing,
  touchTarget,
  typeScale,
  typeWeight,
  iconSize,
  radii,
  controlSize,
} from "../theme";
import { ActionMenu, type ActionMenuItem } from "../ui/ActionMenu";
import { useAppDialog } from "../ui/AppDialog";
import {
  useAppFullscreenOverlay,
  type AppFullscreenOverlayController,
} from "../ui/AppFullscreenOverlay";
import { AppText as Text } from "../ui/Typography";
import { useOverlaySurface } from "../ui/OverlaySurfaceContext";
import { percentageDimension } from "../ui/percentageDimension";
import {
  ContentReviewComments,
  ContentReviewComposer,
  useContentReview,
  useImageReviewPoints,
} from "./ContentReviewHost";
import { imageReviewPoint } from "./image-review-point";
import { ImagePreviewContext, type ImagePreviewController } from "./imagePreviewController";
import type {
  ImageAnnotationHandler,
  ImagePreviewItem,
  ImagePreviewRequest,
} from "./imagePreviewTypes";
import { ProgressiveImageLayer } from "./ProgressiveImageLayer";
import { materializePrivateAsset } from "./private-asset";

export type { ImagePreviewItem, ImagePreviewRequest } from "./imagePreviewTypes";

type PreviewSession = { index: number; items: ImagePreviewItem[] };
type RegisteredPreviewItem = ImagePreviewItem & { sequence: number };
const ImagePreviewGroupContext = createContext<string | null>(null);

function createImagePreviewSessionNode(
  request: ImagePreviewRequest,
  onClose: () => void,
  getAnnotationHandler: () => ImageAnnotationHandler | null,
): React.ReactElement {
  const initialSession = { index: 0, items: [request] };
  return createElement(ImagePreviewSession, { getAnnotationHandler, initialSession, onClose });
}

/**
 * Owns preview state above the virtualized timeline. A row can be recycled or
 * unmounted while the modal is open without destroying the preview.
 */
export function ImagePreviewHost({ children }: { children: ReactNode }) {
  const registryRef = useRef(new Map<string, Map<string, RegisteredPreviewItem>>());
  const annotationRegistrationRef = useRef<ImageAnnotationHandler | null>(null);
  const sequenceRef = useRef(0);
  const controller = useConstant<ImagePreviewController>(() => ({
    createSession(request, onClose) {
      return createImagePreviewSessionNode(
        request,
        onClose,
        () => annotationRegistrationRef.current,
      );
    },
    open(request, fullscreen) {
      const registered =
        request.groupId === null || request.groupId === undefined
          ? []
          : [...(registryRef.current.get(request.groupId)?.values() ?? [])];
      const hasCurrent = registered.some((item) => item.id === request.id);
      const items = (
        hasCurrent ? registered : [...registered, { ...request, sequence: sequenceRef.current }]
      )
        .sort((left, right) => (left.order ?? left.sequence) - (right.order ?? right.sequence))
        .map(({ sequence: _sequence, ...item }) => item);
      const index = Math.max(
        0,
        items.findIndex((item) => item.id === request.id),
      );
      fullscreen.present(({ close }) => (
        <ImagePreviewSession
          getAnnotationHandler={() => annotationRegistrationRef.current}
          initialSession={{ index, items }}
          onClose={close}
        />
      ));
    },
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

async function annotatePreviewImage(
  item: ImagePreviewItem,
  handler: ImageAnnotationHandler,
  onClose: () => void,
): Promise<void> {
  let annotationItem = item;
  if (item.detail !== null && item.detail !== undefined) {
    const source = await materializePrivateAsset(item.detail.source, {
      getAccess: item.detail.getAccess,
      variant: "detail",
    });
    annotationItem = { ...item, source };
  }
  await handler(annotationItem, onClose);
}

function ImagePreviewSession({
  getAnnotationHandler,
  initialSession,
  onClose,
}: {
  getAnnotationHandler: () => ImageAnnotationHandler | null;
  initialSession: PreviewSession;
  onClose: () => void;
}) {
  const dialog = useAppDialog();
  const [session, setSession] = useState(initialSession);
  useEffect(() => {
    const releases = initialSession.items.map((item) => retainCachedAttachment(item.source.uri));
    return () => {
      for (const release of releases) release();
    };
  }, [initialSession]);
  const [preparingAnnotation, setPreparingAnnotation] = useState(false);
  const requestAnnotation = useEvent(() => {
    const annotationHandler = getAnnotationHandler();
    const item = session.items[session.index];
    if (annotationHandler === null || item === undefined || preparingAnnotation) return;
    setPreparingAnnotation(true);
    annotatePreviewImage(item, annotationHandler, onClose).then(
      () => {
        setPreparingAnnotation(false);
      },
      (error: unknown) => {
        setPreparingAnnotation(false);
        dialog.alert(
          "Could not annotate image",
          error instanceof Error ? error.message : "Image could not be opened in QuickDraw",
        );
      },
    );
  });
  return (
    <GestureHandlerRootView style={styles.overlay}>
      <ImageViewer
        annotationPreparing={preparingAnnotation}
        onChangeIndex={(index) => {
          setSession((current) => ({ ...current, index }));
        }}
        onClose={onClose}
        session={session}
        {...(getAnnotationHandler() === null ? {} : { onAnnotate: requestAnnotation })}
      />
    </GestureHandlerRootView>
  );
}

export function ImagePreviewGroup({ children, id }: { children: ReactNode; id: string }) {
  return (
    <ImagePreviewGroupContext.Provider value={id}>{children}</ImagePreviewGroupContext.Provider>
  );
}

export function useImagePreview(): (
  request: ImagePreviewRequest,
  fullscreenOverride?: AppFullscreenOverlayController,
) => void {
  const controller = useContext(ImagePreviewContext);
  const fullscreen = useAppFullscreenOverlay();
  return useEvent(
    (request: ImagePreviewRequest, fullscreenOverride?: AppFullscreenOverlayController) => {
      controller.open(request, fullscreenOverride ?? fullscreen);
    },
  );
}

export function useImagePreviewGroup(): string | null {
  return useContext(ImagePreviewGroupContext);
}

export function useImagePreviewAnnotationHandler(handler: ImageAnnotationHandler): void {
  const { registerAnnotationHandler } = useContext(ImagePreviewContext);
  const handleAnnotation = useEvent(handler);
  useEffect(
    () => registerAnnotationHandler(async (item, onAttached) => handleAnnotation(item, onAttached)),
    [handleAnnotation, registerAnnotationHandler],
  );
}

export function useRegisterImagePreviewItem(groupId: string | null, item: ImagePreviewItem): void {
  const { register } = useContext(ImagePreviewContext);
  const headersKey = JSON.stringify(item.source.headers ?? {});
  const registerCurrentItem = useEvent(() => {
    if (groupId === null) return undefined;
    return register(groupId, item);
  });
  useEffect(
    () => registerCurrentItem(),
    [
      groupId,
      headersKey,
      item.id,
      item.label,
      item.link,
      item.order,
      item.reference,
      item.source.uri,
      item.draft?.scope,
      item.draft?.attachmentId,
      item.detail?.getAccess,
      item.detail?.resourceKey,
      register,
      registerCurrentItem,
    ],
  );
}

function ImageViewer({
  annotationPreparing,
  onAnnotate,
  onChangeIndex,
  onClose,
  session,
}: {
  annotationPreparing: boolean;
  onAnnotate?: () => void;
  onChangeIndex: (index: number) => void;
  onClose: () => void;
  session: PreviewSession;
}) {
  const dialog = useAppDialog();
  const insets = useSafeAreaInsets();
  const { surface } = useOverlaySurface();
  // The fullscreen host has already inset its entire content, including the toolbar.
  const topInset = surface === "fullscreen-modal" ? 0 : insets.top;
  const bottomInset = surface === "fullscreen-modal" ? 0 : insets.bottom;
  const [pinMode, setPinMode] = useState(false);
  const item = session.items[session.index];
  if (item === undefined) return null;
  const imageActions: ActionMenuItem[] = [
    ...(item.download === null || item.download === undefined
      ? []
      : [{ icon: "download-outline" as const, id: "download", label: "Download" }]),
    ...(item.link === null || item.link === undefined || item.link === item.source.uri
      ? []
      : [{ icon: "open-outline" as const, id: "open", label: "Open link" }]),
  ];
  return (
    <View
      style={[styles.root, { paddingBottom: bottomInset, paddingTop: topInset }]}
      testID="image-preview-surface"
    >
      <ZoomableImage
        canGoNext={session.index < session.items.length - 1}
        canGoPrevious={session.index > 0}
        item={item}
        key={item.id}
        onClose={onClose}
        onNext={() => {
          onChangeIndex(session.index + 1);
        }}
        onPrevious={() => {
          onChangeIndex(session.index - 1);
        }}
        pinMode={pinMode}
      />
      <View
        pointerEvents="box-none"
        style={[styles.topBar, { top: topInset + spacing.xs }]}
        testID="image-preview-controls"
      >
        <Pressable
          accessibilityLabel="Close image"
          accessibilityRole="button"
          onPress={onClose}
          style={styles.roundButton}
        >
          <Ionicons color="#ffffff" name="close" size={iconSize.navigation} />
        </Pressable>
        <View style={styles.counterPill}>
          <Text style={styles.counterText}>
            {session.index + 1} / {session.items.length}
          </Text>
        </View>
        <View style={styles.topBarActions}>
          <Pressable
            accessibilityLabel="Pin a comment on image"
            accessibilityRole="button"
            accessibilityState={{ selected: pinMode }}
            onPress={() => {
              setPinMode(!pinMode);
            }}
            style={styles.roundButton}
          >
            <Ionicons
              color={pinMode ? "#B794F6" : "#ffffff"}
              name={pinMode ? "pin" : "pin-outline"}
              size={iconSize.action}
            />
          </Pressable>
          {imageActions.length > 0 && (
            <ActionMenu
              accessibilityLabel="Image actions"
              actions={imageActions}
              onSelect={(id) => {
                if (id === "download") {
                  item.download?.().catch((error: unknown) => {
                    dialog.alert(
                      "Download failed",
                      error instanceof Error ? error.message : "Could not download image",
                    );
                  });
                } else if (id === "open" && item.link !== null && item.link !== undefined) {
                  Linking.openURL(item.link).catch((error: unknown) => {
                    dialog.alert(
                      "Could not open link",
                      error instanceof Error ? error.message : "Could not open link",
                    );
                  });
                }
              }}
              style={styles.imageMenuAnchor}
            >
              <Pressable style={styles.roundButton}>
                <Ionicons color="#ffffff" name="ellipsis-horizontal" size={iconSize.action} />
              </Pressable>
            </ActionMenu>
          )}
          {onAnnotate !== undefined && (
            <Pressable
              accessibilityLabel="Annotate image in QuickDraw"
              accessibilityRole="button"
              disabled={annotationPreparing}
              onPress={onAnnotate}
              style={[styles.roundButton, annotationPreparing && styles.disabled]}
            >
              {annotationPreparing ? (
                <ActivityIndicator color="#ffffff" size="small" />
              ) : (
                <Ionicons color="#ffffff" name="brush-outline" size={iconSize.action} />
              )}
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

function ZoomableImage({
  canGoNext,
  canGoPrevious,
  item,
  onClose,
  onNext,
  onPrevious,
  pinMode,
}: {
  canGoNext: boolean;
  canGoPrevious: boolean;
  item: ImagePreviewItem;
  onClose: () => void;
  onNext: () => void;
  onPrevious: () => void;
  pinMode: boolean;
}) {
  const reviewTargetId = `image:${item.draft?.scope ?? ""}:${item.id}`;
  const review = useContentReview();
  const points = useImageReviewPoints(reviewTargetId);
  const placePin = useEvent((x: number, y: number) => {
    review({
      kind: "image",
      target: { id: reviewTargetId, label: item.label, reference: item.reference ?? null },
      x,
      y,
    });
  });
  const [viewport, setViewport] = useState({ height: 0, width: 0 });
  const [intrinsic, setIntrinsic] = useState({ height: 0, width: 0 });
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
        dismissOpacity.set(
          Math.max(0.35, 1 - Math.abs(event.translationY) / Math.max(1, viewport.height * 0.55)),
        );
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
        if (
          allowed &&
          (Math.abs(event.translationX) > viewport.width * 0.16 || Math.abs(event.velocityX) > 720)
        ) {
          pageOffset.set(
            withTiming(
              direction > 0 ? -viewport.width : viewport.width,
              { duration: 120, easing: Easing.out(Easing.cubic) },
              (finished) => {
                if (finished === true) runOnJS(navigate)(direction);
              },
            ),
          );
          gestureAxis.set(0);
          return;
        }
        pageOffset.set(withTiming(0, { duration: 110, easing: Easing.out(Easing.cubic) }));
        gestureAxis.set(0);
        return;
      }
      if (
        gestureAxis.get() === 2 &&
        (Math.abs(event.translationY) > viewport.height * 0.14 || Math.abs(event.velocityY) > 820)
      ) {
        translateY.set(
          withTiming(
            event.translationY < 0 ? -viewport.height : viewport.height,
            { duration: 130, easing: Easing.out(Easing.cubic) },
            (finished) => {
              if (finished === true) runOnJS(onClose)();
            },
          ),
        );
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
      translateX.set(
        withTiming(Math.max(-maxX, Math.min(maxX, translateX.get())), {
          duration: 100,
          easing: Easing.out(Easing.cubic),
        }),
      );
      translateY.set(
        withTiming(Math.max(-maxY, Math.min(maxY, translateY.get())), {
          duration: 100,
          easing: Easing.out(Easing.cubic),
        }),
      );
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(260)
    .onEnd((event, success) => {
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
        translateX.set(
          withTiming(Math.max(-maxX, Math.min(maxX, nextX)), {
            duration: 150,
            easing: Easing.out(Easing.cubic),
          }),
        );
        translateY.set(
          withTiming(Math.max(-maxY, Math.min(maxY, nextY)), {
            duration: 150,
            easing: Easing.out(Easing.cubic),
          }),
        );
      }
    });

  const pinTap = Gesture.Tap()
    .withTestId("image-review-pin-tap")
    .enabled(pinMode && decodeState === "ready")
    .onEnd((event, success) => {
      if (!success) return;
      const point = imageReviewPoint(event, {
        height: fit.height,
        scale: scale.get(),
        translateX: translateX.get() + pageOffset.get(),
        translateY: translateY.get(),
        viewportHeight: viewport.height,
        viewportWidth: viewport.width,
        width: fit.width,
      });
      if (point !== null) runOnJS(placePin)(point.x, point.y);
    });
  const gestures = Gesture.Simultaneous(pan, pinch, Gesture.Exclusive(doubleTap, pinTap));
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
      onLayout={({ nativeEvent }) => {
        setViewport({
          height: Math.max(0, nativeEvent.layout.height),
          width: Math.max(0, nativeEvent.layout.width),
        });
      }}
      style={[styles.viewer, backdropStyle]}
      testID="image-preview-viewport"
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
              <Ionicons color="#ffffff" name="image-outline" size={iconSize.illustration} />
              <Text style={styles.imageError}>Image decode failed</Text>
            </View>
          )}
          <Animated.View
            style={[styles.imageLayer, { height: fit.height, width: fit.width }, imageStyle]}
            testID="image-preview-frame"
          >
            {viewport.width > 0 && viewport.height > 0 && (
              <ProgressiveImageLayer
                detail={item.detail}
                label={item.label}
                onDecodeStateChange={setDecodeState}
                onDimensions={setIntrinsic}
                preview={item.source}
              />
            )}
            {points.map((point, index) => (
              <View
                key={point.id}
                pointerEvents="none"
                style={[
                  styles.pin,
                  {
                    left: percentageDimension(point.x * 100),
                    opacity: point.pending ? 0.6 : 1,
                    top: percentageDimension(point.y * 100),
                  },
                ]}
              >
                <Text style={styles.pinText}>{index + 1}</Text>
              </View>
            ))}
          </Animated.View>
        </View>
      </GestureDetector>
      <ContentReviewComments presentation="overlay" targetId={reviewTargetId} />
      <ContentReviewComposer anchorKind="image" targetId={reviewTargetId} />
    </Animated.View>
  );
}

function containSize(
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): { height: number; width: number } {
  // Before decode reports the aspect ratio, use the measured viewport as the decode budget.
  if (imageWidth <= 0 || imageHeight <= 0) {
    return { height: viewportHeight, width: viewportWidth };
  }
  const ratio = Math.min(
    viewportWidth / Math.max(1, imageWidth),
    viewportHeight / Math.max(1, imageHeight),
  );
  return {
    height: Math.max(1, imageHeight * ratio),
    width: Math.max(1, imageWidth * ratio),
  };
}

const styles = StyleSheet.create({
  counterPill: {
    alignItems: "center",
    backgroundColor: "rgba(36,36,36,0.82)",
    borderRadius: radii.medium,
    justifyContent: "center",
    minHeight: controlSize.compact,
    paddingHorizontal: spacing.sm,
  },
  counterText: {
    color: "#ffffff",
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  disabled: { opacity: 0.4 },
  fill: { flex: 1 },
  gestureSurface: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    overflow: "hidden",
  },
  host: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    position: "relative",
  },
  imageError: {
    color: "#ffffff",
    ...typeScale.body,
    fontWeight: typeWeight.semibold,
  },
  imageLayer: {
    alignItems: "center",
    justifyContent: "center",
  },
  imageMenuAnchor: {
    height: touchTarget,
    width: touchTarget,
  },
  imageStatus: {
    alignItems: "center",
    gap: spacing.sm,
    justifyContent: "center",
    position: "absolute",
    zIndex: 2,
  },
  overlay: {
    backgroundColor: "#000000",
    flex: 1,
  },
  pin: {
    alignItems: "center",
    backgroundColor: "#B794F6",
    borderRadius: radii.pill,
    height: controlSize.compact,
    justifyContent: "center",
    marginLeft: -controlSize.compact / 2,
    marginTop: -controlSize.compact / 2,
    position: "absolute",
    width: controlSize.compact,
  },
  pinText: {
    color: "#000000",
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  root: {
    backgroundColor: "#000000",
    flex: 1,
  },
  roundButton: {
    alignItems: "center",
    backgroundColor: "rgba(36,36,36,0.9)",
    borderRadius: radii.pill,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  topBar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    left: spacing.sm,
    position: "absolute",
    right: spacing.sm,
  },
  topBarActions: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  viewer: {
    backgroundColor: "#000000",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
});
