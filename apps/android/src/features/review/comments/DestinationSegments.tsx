import { Pressable, View } from "react-native";

import type { DraftDestination } from "../../../data/reviewDraftContract";
import { AppText as Text } from "../../../ui/Typography";
import { commentSheetStyles as styles } from "./CommentSheet.styles";

const LABELS: Readonly<Record<DraftDestination, string>> = {
  agent: "Agent",
  both: "Both",
  pr: "PR",
};

/** Agent | PR | Both; destinations that need a thread are disabled without one, with the reason spoken. */
export function DestinationSegments({
  agentAvailable,
  destinations,
  onSelect,
  selected,
}: {
  readonly agentAvailable: boolean;
  readonly destinations: readonly DraftDestination[];
  readonly onSelect: (destination: DraftDestination) => void;
  readonly selected: DraftDestination;
}): React.JSX.Element {
  return (
    <View accessibilityRole="radiogroup" style={styles.segments}>
      {destinations.map((value) => (
        <DestinationSegment
          disabled={value !== "pr" && !agentAvailable}
          key={value}
          onSelect={onSelect}
          selected={value === selected}
          value={value}
        />
      ))}
    </View>
  );
}

function DestinationSegment({
  disabled,
  onSelect,
  selected,
  value,
}: {
  readonly disabled: boolean;
  readonly onSelect: (destination: DraftDestination) => void;
  readonly selected: boolean;
  readonly value: DraftDestination;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityHint={disabled ? "No linked thread can receive it" : undefined}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={() => {
        onSelect(value);
      }}
      style={[styles.segment, selected && styles.segmentSelected, disabled && styles.disabled]}
    >
      <Text numberOfLines={1} style={styles.segmentLabel}>
        {selected ? `✓ ${LABELS[value]}` : LABELS[value]}
      </Text>
    </Pressable>
  );
}
