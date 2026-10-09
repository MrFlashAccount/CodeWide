/** "Fork into" picker: the same agent or another agent from the provider-aware catalog. */
import type { ReactElement } from "react";
import { AppSheet, AppSheetScrollView } from "../../ui/AppSheet";
import { MenuAction } from "../../ui/MenuAction";
import { AppText as Text } from "../../ui/Typography";
import type { ForkTargetChoice } from "./forkTargets";
import { styles } from "./ThreadActions.styles";

/** Shows `choices`; selecting one closes the sheet and reports the choice. */
export function ForkTargetSheet({
  choices,
  onClose,
  onSelect,
}: {
  readonly choices: readonly ForkTargetChoice[];
  readonly onClose: () => void;
  readonly onSelect: (choice: ForkTargetChoice) => void;
}): ReactElement {
  return (
    <AppSheet
      contentProps={{ enableDynamicSizing: true, index: 0 }}
      isOpen
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <Text style={styles.sheetTitle}>Fork into</Text>
      <AppSheetScrollView keyboardShouldPersistTaps="handled" testID="fork-target-sheet">
        {choices.length === 0 ? (
          <Text style={styles.sheetEmpty}>No other agent is available for this thread.</Text>
        ) : (
          choices.map((choice) => (
            <MenuAction
              icon={choice.target === null ? "git-branch-outline" : "swap-horizontal-outline"}
              key={choice.id}
              onPress={() => {
                onSelect(choice);
              }}
              subtitle={choice.subtitle}
              title={choice.title}
            />
          ))
        )}
      </AppSheetScrollView>
    </AppSheet>
  );
}
