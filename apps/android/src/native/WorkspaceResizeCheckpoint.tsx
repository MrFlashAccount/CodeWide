import type { ReactElement } from "react";
import {
  Platform,
  requireNativeComponent,
  StyleSheet,
  UIManager,
  type ViewProps,
} from "react-native";
import { V1_TWO_PANE_MIN_WIDTH } from "./window-layout";

/** The settled pane boxes expected by the same React commit that selects the workspace layout. */
export type WorkspaceResizeTarget = {
  readonly catalog: number;
  readonly destination: number;
  readonly left: number;
  readonly window: number;
};

type CheckpointProps = ViewProps & {
  readonly target: WorkspaceResizeTarget;
  readonly wideFrom: number;
};

const manager = "CodeWideWorkspaceResizeCheckpoint";
const NativeCheckpoint =
  Platform.OS === "android" && UIManager.hasViewManagerConfig(manager)
    ? requireNativeComponent<CheckpointProps>(manager)
    : null;

/** Lets Android present the first resized workspace once Fabric and the native Stack agree. */
export function WorkspaceResizeCheckpoint({
  target,
}: {
  readonly target: WorkspaceResizeTarget;
}): ReactElement | null {
  return NativeCheckpoint === null ? null : (
    <NativeCheckpoint
      accessible={false}
      importantForAccessibility="no"
      pointerEvents="none"
      style={styles.checkpoint}
      target={target}
      wideFrom={V1_TWO_PANE_MIN_WIDTH}
    />
  );
}

const styles = StyleSheet.create({
  checkpoint: {
    height: 0,
    position: "absolute",
    width: 0,
  },
});
