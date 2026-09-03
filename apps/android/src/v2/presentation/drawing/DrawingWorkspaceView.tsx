import { Ionicons } from "@expo/vector-icons";
import { Quickdraw, type QuickdrawRef } from "@quickdrawjs/react-native";
import { useRef, useState, type ComponentProps } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useEvent } from "../../../react/useEvent";
import type { QuickdrawImageSnapshot } from "../../application/drawing/quickdrawImage";
import { colors, spacing } from "../../theme";
import { ProductText } from "../text/ProductText";
import { ShimmerText } from "../text/ShimmerText";
import {
  closeButtonStyle,
  drawingWorkspaceStyles as styles,
  saveButtonStyle,
} from "./drawingWorkspaceStyles";

type QuickdrawSnapshot = NonNullable<ComponentProps<typeof Quickdraw>["snapshot"]>;
export type DrawingSnapshot = QuickdrawImageSnapshot;

export interface DrawingCommit {
  pngDataUrl: string;
  snapshot: unknown;
}

interface DrawingWorkspaceViewProps {
  editing: boolean;
  initialSnapshot: DrawingSnapshot | null;
  mode: "drawing" | "image-annotation";
  onClose(): void;
  onCommit(value: DrawingCommit): Promise<boolean>;
}

export function DrawingWorkspaceView(props: DrawingWorkspaceViewProps): React.JSX.Element {
  const { editing, initialSnapshot, mode, onClose, onCommit } = props;
  const insets = useSafeAreaInsets();
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
    const failure = await commitDrawing({ board, exportedPng, mode, onClose, onCommit });
    setSaving(false);
    if (failure !== null) setError(failure);
  });
  const markReady = useEvent(() => {
    if (mode === "image-annotation") boardRef.current?.setTool("draw");
    setReady(true);
  });
  const reportError = useEvent((message: string) => setError(message));
  const acceptToolbarSave = useEvent((_dataUrl: string) => {
    commit().catch(() => undefined);
  });
  const activateCommit = useEvent(() => {
    commit().catch(() => undefined);
  });

  return (
    <View testID="v2-drawing-workspace" style={styles.root}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, spacing.sm) }]}>
        <Pressable
          accessibilityLabel="Close drawing"
          accessibilityRole="button"
          disabled={saving}
          onPress={onClose}
          style={closeButtonStyle}
        >
          <Ionicons color={colors.text} name="close" size={24} />
        </Pressable>
        <View style={styles.titleBlock}>
          <ProductText numberOfLines={1} style={styles.title} weight="semibold">
            {mode === "image-annotation" ? "Annotate image" : "Drawing"}
          </ProductText>
          <ProductText numberOfLines={1} style={styles.subtitle} tone="muted">
            {drawingSubtitle(mode, initialSnapshot)}
          </ProductText>
        </View>
        <Pressable
          accessibilityLabel={editing ? "Save drawing" : "Attach drawing"}
          accessibilityRole="button"
          accessibilityState={{ busy: saving, disabled: !ready || saving }}
          disabled={!ready || saving}
          onPress={activateCommit}
          style={saveButtonStyle}
        >
          {saving ? (
            <ShimmerText
              style={styles.saveText}
              testID="v2-drawing-commit-shimmer"
              text={editing ? "Saving drawing" : "Attaching drawing"}
              widthPolicy="intrinsic"
            />
          ) : (
            <ProductText style={styles.saveText} weight="semibold">
              {editing ? "Save" : "Attach"}
            </ProductText>
          )}
        </Pressable>
      </View>
      {error === null ? null : (
        <View accessibilityLiveRegion="polite" style={styles.errorBar}>
          <Ionicons color={colors.red} name="alert-circle-outline" size={17} />
          <ProductText style={styles.errorText} tone="danger">
            {error}
          </ProductText>
        </View>
      )}
      <View style={[styles.board, { paddingBottom: insets.bottom }]}>
        {ready ? null : (
          <View style={styles.loader} testID="v2-drawing-loading">
            <ShimmerText
              style={styles.loadingText}
              testID="v2-drawing-loading-shimmer"
              text="Preparing drawing"
              widthPolicy="intrinsic"
            />
          </View>
        )}
        <Quickdraw
          ref={boardRef}
          grid={mode === "image-annotation" ? "none" : "dots"}
          onError={reportError}
          onReady={markReady}
          onSave={acceptToolbarSave}
          {...(initialSnapshot === null
            ? {}
            : {
                // WHY: QuickDraw accepts its serialized document snapshot at runtime, but its
                // public type exposes internal store-schema details unavailable at this boundary.
                snapshot: initialSnapshot as unknown as QuickdrawSnapshot,
              })}
          style={styles.quickdraw}
          theme="dark"
          watermark={false}
          webviewProps={{ overScrollMode: "never", setSupportMultipleWindows: false }}
        />
      </View>
    </View>
  );
}

interface CommitDrawingInput {
  board: QuickdrawRef;
  exportedPng: string | undefined;
  mode: DrawingWorkspaceViewProps["mode"];
  onClose(): void;
  onCommit(value: DrawingCommit): Promise<boolean>;
}

async function commitDrawing(input: CommitDrawingInput): Promise<string | null> {
  try {
    const [snapshot, pngDataUrl] = await Promise.all([
      input.board.getSnapshot(),
      input.exportedPng === undefined
        ? input.board.exportPng(
            input.mode === "image-annotation"
              ? { background: false, margin: 0, scale: 1 }
              : { margin: spacing.lg, scale: 2 },
          )
        : Promise.resolve(input.exportedPng),
    ]);
    if (pngDataUrl === null) {
      throw new Error("Add something to the drawing before attaching it");
    }
    if (await input.onCommit({ pngDataUrl, snapshot })) input.onClose();
    return null;
  } catch (cause: unknown) {
    return cause instanceof Error ? cause.message : "Could not save the drawing";
  }
}

function drawingSubtitle(
  mode: DrawingWorkspaceViewProps["mode"],
  initialSnapshot: DrawingSnapshot | null,
): string {
  if (mode === "image-annotation") return "Draw over the original";
  return initialSnapshot === null ? "New attachment" : "Editing attachment";
}
