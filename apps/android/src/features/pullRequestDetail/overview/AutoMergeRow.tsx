import { useRef } from "react";
import { View, type Text as NativeText } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import { AppSwitch } from "../../../ui/AppSwitch";
import { TextShimmer } from "../../../ui/TextShimmer";
import { AppText as Text } from "../../../ui/Typography";
import { overviewStyles as styles } from "./overview.styles";

/**
 * Auto-merge switch. It never writes on tap alone: the runner asks first, then
 * the switch shows the requested state disabled with its label shimmering in
 * place until the forge answers; a refusal restores the forge's state.
 */
export function AutoMergeRow({
  action,
  host,
  methodLabel,
  onRun,
  pending,
  requested,
}: {
  readonly action: ActionDescriptor;
  readonly host: string;
  readonly methodLabel: string;
  readonly onRun: (action: ActionDescriptor, input: boolean | string | null) => void;
  readonly pending: boolean;
  /** Value requested by a pending run, else `null` to show the forge's state. */
  readonly requested: boolean | null;
}): React.JSX.Element {
  const label = useRef<NativeText>(null);
  const disabledReason =
    action.availability.state === "disabled" ? action.availability.reason : undefined;
  return (
    <View style={styles.toggleLine}>
      <View style={styles.lineBody}>
        <Text ref={label} style={styles.body}>
          {action.label}
        </Text>
        <Text style={styles.meta}>{`${methodLabel} · ${host}`}</Text>
      </View>
      <TextShimmer shimmering={pending} target={label} />
      <AppSwitch
        accessibilityHint={disabledReason}
        accessibilityLabel={action.label}
        disabled={disabledReason !== undefined || pending}
        onValueChange={() => {
          onRun(action, null);
        }}
        value={requested ?? action.toggle?.on ?? false}
      />
    </View>
  );
}
