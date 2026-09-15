import { lazy, Suspense } from "react";
import { StyleSheet } from "react-native";
import { colors, typeScale } from "../../../theme";
import { useAppFullscreenOverlay } from "../../../ui/AppFullscreenOverlay";
import { AppListRow } from "../../../ui/AppListRow";
import { listRowHeight } from "../../../ui/AppListRow.types";
import { AppText } from "../../../ui/Typography";

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
    <AppListRow
      title="Try Markdown composer"
      description="Experimental editor · local preview, no sending"
      onPress={open}
      fixedHeight={listRowHeight.double}
    />
  );
}

const styles = StyleSheet.create({
  hint: {
    ...typeScale.caption,
    color: colors.textMuted,
  },
});
