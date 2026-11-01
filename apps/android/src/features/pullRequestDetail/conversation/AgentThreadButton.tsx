import { PillButton } from "../sections/PillButton";

/**
 * "Address in agent" for one review thread or issue, as a filled pill with the
 * agent glyph. A pending start keeps its label and shimmers in place.
 */
export function AgentThreadButton({
  onPress,
  pending,
  testID,
}: {
  readonly onPress: () => void;
  readonly pending: boolean;
  readonly testID: string;
}): React.JSX.Element {
  return (
    <PillButton
      icon="sparkles"
      label="Address in agent"
      onPress={onPress}
      pending={pending}
      testID={testID}
      variant="filled"
    />
  );
}
