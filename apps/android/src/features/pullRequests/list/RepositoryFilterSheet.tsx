import { Pressable } from "react-native";

import { AppSheet, AppSheetScrollView } from "../../../ui/AppSheet";
import { AppText as Text } from "../../../ui/Typography";
import { listStyles as styles } from "./list.styles";

/** Picks one repository of the loaded list, or All repos. */
export function RepositoryFilterSheet({
  onDismiss,
  onSelect,
  open,
  repositories,
  selected,
}: {
  readonly onDismiss: () => void;
  readonly onSelect: (repository: string | null) => void;
  readonly open: boolean;
  readonly repositories: readonly string[];
  readonly selected: string | null;
}): React.JSX.Element {
  const options: readonly (string | null)[] = [null, ...repositories];
  return (
    <AppSheet
      contentProps={{ dismissLabel: "Close repository filter" }}
      isOpen={open}
      onOpenChange={(next) => {
        if (!next) {
          onDismiss();
        }
      }}
    >
      <Text accessibilityRole="header" style={[styles.title, styles.section]}>
        Repository
      </Text>
      <AppSheetScrollView>
        {options.map((repository) => (
          <RepositoryOption
            key={repository ?? "all"}
            onSelect={() => {
              onSelect(repository);
              onDismiss();
            }}
            repository={repository}
            selected={repository === selected}
          />
        ))}
      </AppSheetScrollView>
    </AppSheet>
  );
}

function RepositoryOption({
  onSelect,
  repository,
  selected,
}: {
  readonly onSelect: () => void;
  readonly repository: string | null;
  readonly selected: boolean;
}): React.JSX.Element {
  const label = repository ?? "All repos";
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onSelect}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Text ellipsizeMode="middle" numberOfLines={1} style={styles.title}>
        {selected ? `✓ ${label}` : label}
      </Text>
    </Pressable>
  );
}
