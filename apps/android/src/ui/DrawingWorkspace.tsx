import { Ionicons } from "@expo/vector-icons";
import { Quickdraw, type QuickdrawRef } from "@quickdrawjs/react-native";
import { type ComponentProps, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import { useEvent } from "../react/useEvent";
import { colors, radii, spacing, touchTarget, typeScale } from "../theme";
import { AppText as Text } from "./Typography";

type QuickdrawSnapshot = NonNullable<ComponentProps<typeof Quickdraw>["snapshot"]>;

export type DrawingCommit = {
  pngDataUrl: string;
  snapshot: Record<string, unknown>;
};

export function DrawingWorkspace({
  editing,
  initialSnapshot,
  mode,
  onCommit,
  onClose,
}: {
  editing: boolean;
  initialSnapshot: Record<string, unknown> | null;
  mode: "drawing" | "image-annotation";
  onCommit(value: DrawingCommit): Promise<boolean>;
  onClose(): void;
}) {
  "use no memo";
  // Quickdraw is an imperative WebView bridge; React Compiler cannot lower
  // the guarded async ref transaction without changing its error semantics.
  const boardRef = useRef<QuickdrawRef>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const commit = useEvent(async (exportedPng?: string): Promise<void> => {
    if (!ready || saving) return;
    const board = boardRef.current;
    if (board === null) return;
    setSaving(true);
    setError(null);
    try {
      const [snapshot, pngDataUrl] = await Promise.all([
        board.getSnapshot(),
        exportedPng === undefined
          ? board.exportPng(mode === "image-annotation"
            ? { background: false, scale: 1, margin: 0 }
            : { scale: 2, margin: 24 })
          : Promise.resolve(exportedPng),
      ]);
      if (pngDataUrl === null) throw new Error("Add something to the drawing before attaching it");
      if (await onCommit({ pngDataUrl, snapshot: snapshot as unknown as Record<string, unknown> })) onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the drawing");
    } finally {
      setSaving(false);
    }
  });
  const markReady = useEvent(() => {
    if (mode === "image-annotation") boardRef.current?.setTool("draw");
    setReady(true);
  });
  const reportError = useEvent((message: string) => setError(message));
  // Always use the host-owned export settings. QuickDraw's toolbar export
  // otherwise adds its own background/margin and changes annotated pixels.
  const acceptToolbarSave = useEvent((_dataUrl: string) => { void commit(); });

  return (
    <View testID="drawing-workspace" style={styles.root}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close drawing"
          disabled={saving}
          onPress={onClose}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed, saving && styles.disabled]}
        >
          <Ionicons name="close" size={24} color={colors.text} />
        </Pressable>
        <View style={styles.titleBlock}>
          <Text numberOfLines={1} style={styles.title}>{mode === "image-annotation" ? "Annotate image" : "Drawing"}</Text>
          <Text numberOfLines={1} style={styles.subtitle}>{mode === "image-annotation" ? "Draw over the original" : initialSnapshot === null ? "New attachment" : "Editing attachment"}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={editing ? "Save drawing" : "Attach drawing"}
          accessibilityState={{ disabled: !ready || saving }}
          disabled={!ready || saving}
          onPress={() => void commit()}
          style={({ pressed }) => [styles.saveButton, pressed && styles.savePressed, (!ready || saving) && styles.disabled]}
        >
          {saving
            ? <ActivityIndicator size="small" color={colors.onPrimary} />
            : <Text style={styles.saveText}>{editing ? "Save" : "Attach"}</Text>}
        </Pressable>
      </View>
      {error !== null && (
        <View style={styles.errorBar}>
          <Ionicons name="alert-circle-outline" size={17} color={colors.red} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
      <View style={styles.board}>
        {!ready && <ActivityIndicator testID="drawing-loading" size="large" color={colors.accent} style={styles.loader} />}
        <Quickdraw
          ref={boardRef}
          theme="dark"
          grid={mode === "image-annotation" ? "none" : "dots"}
          watermark={false}
          onReady={markReady}
          onError={reportError}
          onSave={acceptToolbarSave}
          style={styles.quickdraw}
          {...(initialSnapshot === null ? {} : { snapshot: initialSnapshot as unknown as QuickdrawSnapshot })}
          webviewProps={{ overScrollMode: "never", setSupportMultipleWindows: false }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    minHeight: 64,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  iconButton: { width: touchTarget, height: touchTarget, borderRadius: radii.large, alignItems: "center", justifyContent: "center" },
  titleBlock: { flex: 1, minWidth: 0 },
  title: { color: colors.text, ...typeScale.titleMedium, fontWeight: "700" },
  subtitle: { color: colors.textMuted, ...typeScale.labelMedium },
  saveButton: { minWidth: 78, height: 38, paddingHorizontal: spacing.md, borderRadius: radii.large, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent },
  saveText: { color: colors.onPrimary, ...typeScale.labelLarge, fontWeight: "700" },
  errorBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, backgroundColor: colors.surfaceRaised },
  errorText: { flex: 1, color: colors.red, ...typeScale.labelMedium },
  board: { flex: 1, position: "relative" },
  quickdraw: { flex: 1 },
  loader: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 1 },
  pressed: { backgroundColor: colors.surfaceHover },
  savePressed: { opacity: 0.82 },
  disabled: { opacity: 0.45 },
});
