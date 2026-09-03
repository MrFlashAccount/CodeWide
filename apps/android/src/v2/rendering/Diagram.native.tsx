import Ionicons from "@expo/vector-icons/Ionicons";
import { setStringAsync } from "expo-clipboard";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useEvent } from "../../react/useEvent";
import { colors, radii, spacing, touchTarget } from "../theme";
import { PresentationText as Text } from "../presentation/text/ProductText";
import { DiagramFullscreen } from "./DiagramFullscreen.native";
import { DiagramSurface } from "./DiagramSurface.native";
import { NativeCodeBlock } from "./NativeCodeBlock";
import {
  ASCII_ENGINE,
  MAX_DIAGRAM_SOURCE_CHARS,
  MERMAID_ENGINE,
  type DiagramEngine,
} from "./diagramModel";

interface DiagramProps {
  diagramId?: string;
  reviewTargetId?: string;
  source: string;
}

export function MermaidDiagram(props: DiagramProps): React.JSX.Element {
  return <LocalDiagram {...props} engine={MERMAID_ENGINE} />;
}

export function AsciiDiagram(props: DiagramProps): React.JSX.Element {
  return <LocalDiagram {...props} engine={ASCII_ENGINE} />;
}

function LocalDiagram(props: DiagramProps & { engine: DiagramEngine }): React.JSX.Element {
  const { diagramId, engine, reviewTargetId, source } = props;
  const [fullscreen, setFullscreen] = useState(false);
  const [height, setHeight] = useState(120);
  const openFullscreen = useEvent(() => setFullscreen(true));
  const closeFullscreen = useEvent(() => setFullscreen(false));
  const copySource = useEvent(() => {
    void setStringAsync(source).catch(() => undefined);
  });
  if (source.length > MAX_DIAGRAM_SOURCE_CHARS) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.secondary}>Diagram is too large to preview safely</Text>
        <NativeCodeBlock language="text" value={source} />
      </View>
    );
  }
  return (
    <View accessibilityLabel={`${engine.title} diagram`} style={styles.card}>
      <View style={styles.header}>
        <Ionicons color={colors.textMuted} name="git-network-outline" size={17} />
        <Text style={styles.title}>{engine.title}</Text>
        <Pressable
          accessibilityLabel={`Copy ${engine.title} source`}
          accessibilityRole="button"
          onPress={copySource}
          style={styles.iconButton}
        >
          <Ionicons color={colors.textMuted} name="copy-outline" size={17} />
        </Pressable>
        <Pressable
          accessibilityLabel="Open diagram fullscreen"
          accessibilityRole="button"
          onPress={openFullscreen}
          style={styles.iconButton}
        >
          <Ionicons color={colors.textMuted} name="expand-outline" size={18} />
        </Pressable>
      </View>
      <DiagramSurface
        engine={engine}
        mode="inline"
        onHeight={setHeight}
        source={source}
        style={{ height }}
      />
      <DiagramFullscreen
        engine={engine}
        onClose={closeFullscreen}
        source={source}
        visible={fullscreen}
        {...(diagramId === undefined ? {} : { diagramId })}
        {...(reviewTargetId === undefined ? {} : { reviewTargetId })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.small,
    gap: spacing.xxs,
    overflow: "hidden",
    width: "100%",
  },
  fallback: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.small,
    gap: spacing.xs,
    padding: spacing.xs,
    width: "100%",
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.xxs,
  },
  iconButton: {
    alignItems: "center",
    height: touchTarget,
    justifyContent: "center",
    marginVertical: -spacing.sm,
    width: touchTarget,
  },
  secondary: { color: colors.textMuted },
  title: { color: colors.textMuted, flex: 1 },
});
