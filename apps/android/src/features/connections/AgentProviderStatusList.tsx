import { useSelector } from "@legendapp/state/react";
import { View } from "react-native";

import type { AgentProvidersResource } from "../../data/agentProvidersResource";
import { colors, iconSize } from "../../theme";
import { AppListRow } from "../../ui/AppListRow";
import { listRowPosition } from "../../ui/AppListRow.types";
import { ProviderIcon } from "../../ui/ProviderIcon";
import { AppText as Text } from "../../ui/Typography";
import { agentProviderStatusLines } from "./agentProviderPresentation";
import { styles } from "./ConnectionRowEditor.styles";

/** Agent provider status of one server, read from the model-owned provider list. */
export function AgentProviderStatusList({
  agentProviders,
  connectionId,
}: {
  readonly agentProviders: Pick<AgentProvidersResource, "state$">;
  readonly connectionId: string;
}): React.JSX.Element | null {
  const state = useSelector(() => agentProviders.state$[connectionId]?.get());
  const lines = agentProviderStatusLines(state);
  if (lines.length === 0) {
    return null;
  }
  return (
    <View style={styles.agentProviders} testID="agent-provider-status">
      <Text style={styles.agentProvidersTitle}>Agents</Text>
      {lines.map((line, index) => (
        <AppListRow
          key={line.id}
          leading={
            <ProviderIcon
              color={line.warning ? colors.warning : colors.textMuted}
              provider={line.id}
              size={iconSize.action}
            />
          }
          multiline
          position={listRowPosition(index, lines.length)}
          testID={`agent-provider-${line.id}`}
          title={line.label}
        />
      ))}
    </View>
  );
}
