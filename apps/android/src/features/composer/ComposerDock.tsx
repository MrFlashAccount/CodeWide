import type { ReactNode } from "react";
import { View } from "react-native";
import { styles } from "./ComposerFeature.styles";

/** Shows known thread controls while the draft is restored before mounting an editable input. */
export function ComposerDock({
  children,
  controls,
  restoringDraft,
}: {
  children: ReactNode;
  controls: ReactNode;
  restoringDraft: boolean;
}): React.JSX.Element {
  return (
    <View
      style={styles.composerDock}
      testID={restoringDraft ? "composer-loading-placeholder" : "composer-dock"}
    >
      {controls}
      {restoringDraft ? (
        <View style={styles.composer}>
          <View style={styles.composerInputShell} />
        </View>
      ) : (
        children
      )}
    </View>
  );
}
