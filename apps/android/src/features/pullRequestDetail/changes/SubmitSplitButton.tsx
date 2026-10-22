import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import { colors, iconSize } from "../../../theme";
import { ActionMenu } from "../../../ui/ActionMenu";
import { AppText as Text } from "../../../ui/Typography";
import { reviewDockStyles as styles } from "./ReviewDock.styles";

/** `Submit · Approve | ▾`: opens the Submit sheet, or picks another plugin verdict. */
export function SubmitSplitButton({
  disabled,
  label,
  onOpenSubmit,
  onSelectVerdict,
  verdict,
  verdicts,
}: {
  readonly disabled: boolean;
  readonly label: string;
  readonly onOpenSubmit: () => void;
  readonly onSelectVerdict: (actionId: string) => void;
  readonly verdict: ActionDescriptor | null;
  readonly verdicts: readonly ActionDescriptor[];
}): React.JSX.Element {
  const unavailable = disabled || verdict === null;
  const split = verdicts.length > 1;
  return (
    <View style={styles.split}>
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityState={{ disabled: unavailable }}
        disabled={unavailable}
        onPress={onOpenSubmit}
        style={[styles.main, !split && styles.mainSolo, unavailable && styles.disabled]}
        testID="review-dock-submit"
      >
        <Text
          numberOfLines={1}
          style={[styles.mainLabel, verdict?.confirm === "destructive" && styles.danger]}
        >
          {label}
        </Text>
      </Pressable>
      {split ? (
        <VerdictMenu onSelect={onSelectVerdict} verdict={verdict} verdicts={verdicts} />
      ) : null}
    </View>
  );
}

function VerdictMenu({
  onSelect,
  verdict,
  verdicts,
}: {
  readonly onSelect: (actionId: string) => void;
  readonly verdict: ActionDescriptor | null;
  readonly verdicts: readonly ActionDescriptor[];
}): React.JSX.Element {
  return (
    <ActionMenu
      accessibilityLabel="Verdict"
      actions={verdicts.map((item) => ({
        ...(item.availability.state === "disabled"
          ? { description: item.availability.reason, disabled: true }
          : {}),
        ...(item.confirm === "destructive" ? { destructive: true } : {}),
        id: item.actionId,
        label: item.label,
        selected: item.actionId === verdict?.actionId,
      }))}
      onSelect={onSelect}
    >
      <Pressable accessibilityLabel="Verdict" accessibilityRole="button" style={styles.toggle}>
        <Ionicons color={colors.onPrimary} name="chevron-down" size={iconSize.inline} />
      </Pressable>
    </ActionMenu>
  );
}
