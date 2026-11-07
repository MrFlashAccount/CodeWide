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
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { retainCachedAttachment } from "../native/attachment-cache/cached-transfer";
import { useConstant } from "../react/useConstant";
import { useEvent } from "../react/useEvent";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { Gallery, type GalleryRefType, type TapGestureEvent } from "react-native-zoom-toolkit";
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
import type { ActionMenuItem } from "../ui/ActionMenu";
import { OverflowMenu } from "../ui/OverflowMenu";
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
      <ImageGallery
        activeItem={item}
        index={session.index}
        items={session.items}
        onChangeIndex={onChangeIndex}
        onClose={onClose}
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
          {imageActions.length > 0 && (
            <OverflowMenu
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
              tone="media"
            />
          )}
        </View>
      </View>
    </View>
  );
}

/** Dismisses a pulled image past this share of the viewport or this velocity. */
const DISMISS_DISTANCE_SHARE = 0.14;
const DISMISS_VELOCITY = 820;
const DISMISS_FADE_SHARE = 0.55;
const DISMISS_MIN_OPACITY = 0.35;
const DISMISS_MS = 130;
const MAX_IMAGE_ZOOM = 5;

/**
 * The session's images as one zoomable gallery: pinch and double tap zoom
 * under the fingers, paging between images, and a vertical pull that
 * dismisses the preview. In pin mode a tap pins a review comment instead of
 * paging.
 */
function ImageGallery({
  activeItem,
  index,
  items,
  onChangeIndex,
  onClose,
  pinMode,
}: {
  activeItem: ImagePreviewItem;
  index: number;
  items: ImagePreviewItem[];
  onChangeIndex: (index: number) => void;
  onClose: () => void;
  pinMode: boolean;
}) {
  const review = useContentReview();
  const gallery = useRef<GalleryRefType>(null);
  const [viewport, setViewport] = useState({ height: 0, width: 0 });
  const dismissOpacity = useSharedValue(1);
  const dismissing = useSharedValue(false);
  const placePin = useEvent((event: TapGestureEvent, itemIndex: number) => {
    const item = items[itemIndex];
    const state = gallery.current?.getState();
    if (!pinMode || item === undefined || state === undefined) {
      return;
    }
    // The tap lands on the active image itself, in its own unscaled frame.
    const x = event.x / state.childSize.width;
    const y = event.y / state.childSize.height;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
      return;
    }
    review({
      kind: "image",
      target: {
        id: imageReviewTargetId(item),
        label: item.label,
        reference: item.reference ?? null,
      },
      x,
      y,
    });
  });
  const backdropStyle = useAnimatedStyle(() => ({ opacity: dismissOpacity.get() }));
  const viewportHeight = viewport.height;

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
      {viewport.width > 0 && viewport.height > 0 && (
        <Gallery
          data={items}
          initialIndex={index}
          keyExtractor={(item) => item.id}
          maxScale={MAX_IMAGE_ZOOM}
          onIndexChange={onChangeIndex}
          onTap={placePin}
          onVerticalPull={({ released, translateY, velocityY }) => {
            "worklet";
            if (!released) {
              dismissing.set(false);
              dismissOpacity.set(
                Math.max(
                  DISMISS_MIN_OPACITY,
                  1 - Math.abs(translateY) / Math.max(1, viewportHeight * DISMISS_FADE_SHARE),
                ),
              );
              return;
            }
            if (dismissing.get()) {
              return;
            }
            dismissing.set(true);
            if (
              Math.abs(translateY) > viewportHeight * DISMISS_DISTANCE_SHARE ||
              Math.abs(velocityY) > DISMISS_VELOCITY
            ) {
              dismissOpacity.set(
                withTiming(0, { duration: DISMISS_MS, easing: Easing.out(Easing.cubic) }, () => {
                  scheduleOnRN(onClose);
                }),
              );
              return;
            }
            dismissOpacity.set(
              withTiming(1, { duration: DISMISS_MS, easing: Easing.out(Easing.cubic) }),
            );
          }}
          ref={gallery}
          renderItem={(item) => <GalleryImage item={item} viewport={viewport} />}
          tapOnEdgeToItem={!pinMode}
        />
      )}
      <ContentReviewComments presentation="overlay" targetId={imageReviewTargetId(activeItem)} />
      <ContentReviewComposer anchorKind="image" targetId={imageReviewTargetId(activeItem)} />
    </Animated.View>
  );
}

function imageReviewTargetId(item: ImagePreviewItem): string {
  return `image:${item.draft?.scope ?? ""}:${item.id}`;
}

/** One gallery cell: the image fitted to the viewport, its decode state and its pins. */
function GalleryImage({
  item,
  viewport,
}: {
  item: ImagePreviewItem;
  viewport: { height: number; width: number };
}) {
  const points = useImageReviewPoints(imageReviewTargetId(item));
  const [intrinsic, setIntrinsic] = useState({ height: 0, width: 0 });
  const [decodeState, setDecodeState] = useState<"loading" | "ready" | "error">("loading");
  const fit = containSize(intrinsic.width, intrinsic.height, viewport.width, viewport.height);
  return (
    <View
      style={[styles.imageLayer, { height: fit.height, width: fit.width }]}
      testID="image-preview-frame"
    >
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
      <ProgressiveImageLayer
        detail={item.detail}
        label={item.label}
        onDecodeStateChange={setDecodeState}
        onDimensions={setIntrinsic}
        preview={item.source}
      />
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
    </View>
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
