import Ionicons from "@expo/vector-icons/Ionicons";
import { setStringAsync } from "expo-clipboard";
import { useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { WebView } from "react-native-webview";

import { useEvent } from "../../react/useEvent";
import { colors, radii, spacing, touchTarget } from "../theme";
import { PresentationText as Text } from "../presentation/text/ProductText";
import { DiagramSurface } from "./DiagramSurface.native";
import type { DiagramEngine } from "./diagramModel";
import { useV2RenderingCapabilities } from "./renderingCapabilities";

interface DiagramFullscreenProps {
  diagramId?: string;
  engine: DiagramEngine;
  onClose(): void;
  reviewTargetId?: string;
  source: string;
  visible: boolean;
}

export function DiagramFullscreen(props: DiagramFullscreenProps): React.JSX.Element {
  const { diagramId, engine, onClose, reviewTargetId, source, visible } = props;
  const insets = useSafeAreaInsets();
  const capabilities = useV2RenderingCapabilities();
  const diagramReview = capabilities.diagramReview;
  const reviewPoints =
    diagramId === undefined || reviewTargetId === undefined || diagramReview === undefined
      ? []
      : diagramReview.points.filter(
          (point) => point.diagramId === diagramId && point.targetId === reviewTargetId,
        );
  const webViewRef = useRef<WebView>(null);
  const [annotating, setAnnotating] = useState(false);
  const toggleAnnotation = useEvent(() => {
    const next = !annotating;
    setAnnotating(next);
    webViewRef.current?.injectJavaScript(
      `window.diagramSetAnnotationMode(${next ? "true" : "false"});true;`,
    );
  });
  const reviewPoint = useEvent((x: number, y: number) => {
    if (diagramId === undefined || reviewTargetId === undefined) return;
    const result = capabilities.beginReview?.({
      diagramId,
      kind: "diagram",
      source,
      targetId: reviewTargetId,
      x,
      y,
    });
    void Promise.resolve(result).catch(() => undefined);
  });
  const copySource = useEvent(() => {
    void setStringAsync(source).catch(() => undefined);
  });
  const zoomOut = useEvent(() => {
    webViewRef.current?.injectJavaScript("window.diagramZoom(.8,-1);true;");
  });
  const resetZoom = useEvent(() => {
    webViewRef.current?.injectJavaScript("window.diagramReset(-1);true;");
  });
  const zoomIn = useEvent(() => {
    webViewRef.current?.injectJavaScript("window.diagramZoom(1.25,-1);true;");
  });
  return (
    <Modal animationType="none" onRequestClose={onClose} transparent={false} visible={visible}>
      <View style={[styles.fullscreen, { paddingBottom: insets.bottom, paddingTop: insets.top }]}>
        <DiagramSurface
          annotationEnabled={annotating}
          engine={engine}
          mode="fullscreen"
          onReviewPoint={reviewPoint}
          reviewPoints={reviewPoints}
          source={source}
          style={styles.surface}
          webViewRef={webViewRef}
        />
        <View style={[styles.bar, { top: insets.top + spacing.xs }]}>
          <Pressable
            accessibilityLabel="Close diagram"
            accessibilityRole="button"
            onPress={onClose}
            style={styles.button}
          >
            <Ionicons color="#ffffff" name="close" size={22} />
          </Pressable>
          <Text numberOfLines={1} style={styles.title}>
            {engine.title} diagram
          </Text>
          {diagramId === undefined || reviewTargetId === undefined ? null : (
            <Pressable
              accessibilityLabel="Annotate diagram"
              accessibilityRole="button"
              onPress={toggleAnnotation}
              style={styles.button}
            >
              <Ionicons
                color={annotating ? colors.green : "#ffffff"}
                name="pin-outline"
                size={20}
              />
            </Pressable>
          )}
          <Pressable
            accessibilityLabel={`Copy ${engine.title} source`}
            accessibilityRole="button"
            onPress={copySource}
            style={styles.button}
          >
            <Ionicons color="#ffffff" name="copy-outline" size={20} />
          </Pressable>
        </View>
        <View style={[styles.zoomBar, { bottom: insets.bottom + spacing.md }]}>
          <Pressable
            accessibilityLabel="Zoom out"
            accessibilityRole="button"
            onPress={zoomOut}
            style={styles.button}
          >
            <Ionicons color="#ffffff" name="remove" size={20} />
          </Pressable>
          <Pressable
            accessibilityLabel="Reset zoom"
            accessibilityRole="button"
            onPress={resetZoom}
            style={styles.button}
          >
            <Ionicons color="#ffffff" name="scan-outline" size={20} />
          </Pressable>
          <Pressable
            accessibilityLabel="Zoom in"
            accessibilityRole="button"
            onPress={zoomIn}
            style={styles.button}
          >
            <Ionicons color="#ffffff" name="add" size={20} />
          </Pressable>
        </View>
        {diagramId === undefined ||
        reviewTargetId === undefined ||
        diagramReview === undefined ? null : (
          <>
            <diagramReview.Comments
              bottomOffset={insets.bottom + 76}
              diagramId={diagramId}
              targetId={reviewTargetId}
            />
            <diagramReview.Composer diagramId={diagramId} targetId={reviewTargetId} />
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bar: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    left: spacing.xs,
    position: "absolute",
    right: spacing.xs,
  },
  button: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,.68)",
    borderRadius: radii.pill,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  fullscreen: { backgroundColor: colors.background, flex: 1 },
  surface: { flex: 1 },
  title: { color: "#ffffff", flex: 1 },
  zoomBar: { alignSelf: "center", flexDirection: "row", gap: spacing.xs, position: "absolute" },
});
