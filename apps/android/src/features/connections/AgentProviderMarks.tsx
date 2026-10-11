import { useSelector } from "@legendapp/state/react";
import { View } from "react-native";

import type { AgentProvidersResource } from "../../data/agentProvidersResource";
import { colors, iconSize } from "../../theme";
import { ProviderIcon } from "../../ui/ProviderIcon";
import { agentProviderStatusLines } from "./agentProviderPresentation";
import { styles } from "./ConnectionRowEditor.styles";

/**
 * Agents available on one server, as a compact row of provider marks beside the
 * connection switch. A mark needing attention is tinted; its status and sign-in
 * text stay available to assistive technology.
 */
export function AgentProviderMarks({
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
      {lines.map((line) => (
        <View
          accessibilityLabel={line.label}
          accessible
          key={line.id}
          testID={`agent-provider-${line.id}`}
        >
          <ProviderIcon
            color={line.warning ? colors.warning : colors.textMuted}
            provider={line.id}
            size={iconSize.inline}
          />
        </View>
      ))}
    </View>
  );
}
