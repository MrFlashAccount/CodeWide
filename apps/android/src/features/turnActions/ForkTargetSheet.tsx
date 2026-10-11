/** "Fork into" picker: the same agent or another agent from the provider-aware catalog. */
import type { ReactElement } from "react";
import { useEvent } from "../../react/useEvent";
import { iconSize } from "../../theme";
import { AppListRow } from "../../ui/AppListRow";
import { listRowHeight } from "../../ui/AppListRow.types";
import { AppSheet, AppSheetScrollView } from "../../ui/AppSheet";
import { MenuAction } from "../../ui/MenuAction";
import { ProviderIcon } from "../../ui/ProviderIcon";
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
            <ForkTargetRow choice={choice} key={choice.id} onSelect={onSelect} />
          ))
        )}
      </AppSheetScrollView>
    </AppSheet>
  );
}

/** The same-agent fork, or another agent's model led by its provider's mark. */
function ForkTargetRow({
  choice,
  onSelect,
}: {
  readonly choice: ForkTargetChoice;
  readonly onSelect: (choice: ForkTargetChoice) => void;
}): ReactElement {
  const select = useEvent(() => {
    onSelect(choice);
  });
  return choice.target === null ? (
    <MenuAction
      icon="git-branch-outline"
      onPress={select}
      subtitle={choice.subtitle}
      title={choice.title}
    />
  ) : (
    <AppListRow
      description={choice.subtitle}
      fixedHeight={listRowHeight.double}
      leading={<ProviderIcon provider={choice.target.provider} size={iconSize.action} />}
      onPress={select}
      title={choice.title}
    />
  );
}
