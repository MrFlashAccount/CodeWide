import { lazy, Suspense } from "react";
import { StyleSheet } from "react-native";
import { colors, typeScale } from "../theme";
import { AppListRow } from "./AppListRow";
import { listRowHeight } from "./AppListRow.types";
import { useAppFullscreenOverlay } from "./AppFullscreenOverlay";
import { AppText } from "./Typography";

const ComposerEditorTrial = lazy(() => import("./ComposerEditorTrial.native"));

export function ComposerEditorTrialEntry() {
  const fullscreen = useAppFullscreenOverlay();
  function open() {
    fullscreen.present((controls) => (
      <Suspense fallback={<AppText style={styles.hint}>Loading editor…</AppText>}>
        <ComposerEditorTrial onClose={controls.close} />
      </Suspense>
    ));
  }
  return (
    <AppListRow title="Try Markdown composer" description="Experimental editor · local preview, no sending" onPress={open} fixedHeight={listRowHeight.double} />
  );
}

const styles = StyleSheet.create({
  hint: { ...typeScale.caption, color: colors.textMuted },
});
