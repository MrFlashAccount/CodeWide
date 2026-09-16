import { Ionicons } from "@expo/vector-icons";
import { Quickdraw, type QuickdrawRef } from "@quickdrawjs/react-native";
import { type ComponentProps, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import { useEvent } from "../../react/useEvent";
import {
  colors,
  controlHitSlop,
  controlSize,
  iconSize,
  layoutSize,
  radii,
  spacing,
  touchTarget,
  typeScale,
  typeWeight,
} from "../../theme";
import { AppText as Text } from "../../ui/Typography";

type QuickdrawSnapshot = NonNullable<ComponentProps<typeof Quickdraw>["snapshot"]>;

export type DrawingCommit = {
  pngDataUrl: string;
  snapshot: Record<string, unknown>;
};

/** Owns drawing-tool editing, preview, and explicit completion actions. */
export function DrawingWorkspace({
  editing,
  initialSnapshot,
  mode,
  onClose,
  onCommit,
}: {
  editing: boolean;
  initialSnapshot: Record<string, unknown> | null;
  mode: "drawing" | "image-annotation";
  onClose: () => void;
  onCommit: (value: DrawingCommit) => Promise<boolean>;
}) {
  "use no memo";
  // Quickdraw is an imperative WebView bridge; React Compiler cannot lower
  // the guarded async ref transaction without changing its error semantics.
  const boardRef = useRef<QuickdrawRef>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const commit = useEvent(async (exportedPng?: string): Promise<void> => {
    if (!ready || saving) {
      return;
    }
    const board = boardRef.current;
    if (board === null) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const [snapshot, pngDataUrl] = await Promise.all([
        board.getSnapshot(),
        exportedPng === undefined
          ? board.exportPng(
              mode === "image-annotation"
                ? { background: false, margin: 0, scale: 1 }
                : { margin: 24, scale: 2 },
            )
          : Promise.resolve(exportedPng),
      ]);
      if (pngDataUrl === null) {
        throw new Error("Add something to the drawing before attaching it");
      }
      // The library interface has no index signature; this structural view keeps the same object.
      const storedSnapshot: { document: typeof snapshot.document } = snapshot;
      if (await onCommit({ pngDataUrl, snapshot: storedSnapshot })) {
        onClose();
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save the drawing");
    } finally {
      setSaving(false);
    }
  });
  const markReady = useEvent(() => {
    if (mode === "image-annotation") {
      boardRef.current?.setTool("draw");
    }
    setReady(true);
  });
  const reportError = useEvent((message: string) => {
    setError(message);
  });
  // Always use the host-owned export settings. QuickDraw's toolbar export
  // otherwise adds its own background/margin and changes annotated pixels.
  const acceptToolbarSave = useEvent((_dataUrl: string) => {
    commit().catch((error: unknown) => {
      setError(error instanceof Error ? error.message : "Could not save the drawing");
    });
  });

  return (
    <View style={styles.root} testID="drawing-workspace">
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Close drawing"
          accessibilityRole="button"
          disabled={saving}
          onPress={onClose}
          style={({ pressed }) => [
            styles.iconButton,
            pressed && styles.pressed,
            saving && styles.disabled,
          ]}
        >
          <Ionicons color={colors.text} name="close" size={iconSize.navigation} />
        </Pressable>
        <View style={styles.titleBlock}>
          <Text numberOfLines={1} style={styles.title}>
            {mode === "image-annotation" ? "Annotate image" : "Drawing"}
          </Text>
          <Text numberOfLines={1} style={styles.subtitle}>
            {mode === "image-annotation"
              ? "Draw over the original"
              : initialSnapshot === null
                ? "New attachment"
                : "Editing attachment"}
          </Text>
        </View>
        <Pressable
          accessibilityLabel={editing ? "Save drawing" : "Attach drawing"}
          accessibilityRole="button"
          accessibilityState={{ disabled: !ready || saving }}
          disabled={!ready || saving}
          hitSlop={controlHitSlop.compact}
          onPress={() => void commit()}
          style={({ pressed }) => [
            styles.saveButton,
            pressed && styles.savePressed,
            (!ready || saving) && styles.disabled,
          ]}
        >
          {saving ? (
            <ActivityIndicator color={colors.onPrimary} size="small" />
          ) : (
            <Text style={styles.saveText}>{editing ? "Save" : "Attach"}</Text>
          )}
        </Pressable>
      </View>
      {error !== null && (
        <View style={styles.errorBar}>
          <Ionicons color={colors.red} name="alert-circle-outline" size={iconSize.inline} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
      <View style={styles.board}>
        {!ready && (
          <ActivityIndicator
            color={colors.accent}
            size="large"
            style={styles.loader}
            testID="drawing-loading"
          />
        )}
        <Quickdraw
          grid={mode === "image-annotation" ? "none" : "dots"}
          onError={reportError}
          onReady={markReady}
          onSave={acceptToolbarSave}
          ref={boardRef}
          style={styles.quickdraw}
          theme="dark"
          watermark={false}
          {...(initialSnapshot === null ? {} : { snapshot: quickdrawSnapshot(initialSnapshot) })}
          webviewProps={{ overScrollMode: "never", setSupportMultipleWindows: false }}
        />
      </View>
    </View>
  );
}

function quickdrawSnapshot(value: unknown): QuickdrawSnapshot {
  // WHY: Quickdraw owns this opaque persisted format and provides no runtime decoder; the app only
  // stores and restores the unchanged payload through the same library version.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return value as QuickdrawSnapshot;
}

const styles = StyleSheet.create({
  board: {
    flex: 1,
    position: "relative",
  },
  disabled: { opacity: 0.45 },
  errorBar: {
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  errorText: {
    color: colors.red,
    flex: 1,
    ...typeScale.label,
  },
  header: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: layoutSize.header,
    paddingHorizontal: spacing.md,
  },
  iconButton: {
    alignItems: "center",
    borderRadius: radii.large,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  loader: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 1,
  },
  pressed: { backgroundColor: colors.surfaceHover },
  quickdraw: { flex: 1 },
  root: {
    backgroundColor: colors.background,
    flex: 1,
  },
  saveButton: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radii.small,
    height: controlSize.compact,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  savePressed: { opacity: 0.82 },
  saveText: {
    color: colors.onPrimary,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  subtitle: {
    color: colors.textMuted,
    ...typeScale.label,
  },
  title: {
    color: colors.text,
    ...typeScale.title,
    fontWeight: typeWeight.semibold,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
  },
});
