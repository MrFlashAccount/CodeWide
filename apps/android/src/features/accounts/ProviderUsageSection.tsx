import { useConstant } from "../../react/useConstant";
import { View } from "react-native";

import { accountPlanLabel } from "../../data/account-usage-presentation";
import type { AgentProviderStatusEntry } from "../../data/agentProviders";
import { iconSize } from "../../theme";
import { ProviderIcon } from "../../ui/ProviderIcon";
import { AppText as Text } from "../../ui/Typography";
import { LimitWindowRow } from "./LimitWindowRow";
import { providerLimitRemaining } from "./providerAccountPresentation";
import { styles } from "./UsageMenu.styles";

/**
 * A thread's own provider subscription limits in its usage menu (a provider
 * without an account pool, such as Claude): each window with its remaining
 * share and reset time, or "unknown" until the provider first reports them.
 */
export function ProviderUsageSection({
  entry,
  hasContext,
}: {
  readonly entry: AgentProviderStatusEntry;
  readonly hasContext: boolean;
}): React.JSX.Element {
  // The menu body mounts on open, so this is the opening time; reset labels are relative to it.
  const now = useConstant(Date.now);
  const limits = entry.limits;
  const plan =
    entry.auth === "authenticated" && entry.planLabel !== null
      ? accountPlanLabel(entry.planLabel)
      : null;
  return (
    <View
      style={[styles.section, hasContext && styles.dividedSection]}
      testID={`usage-provider-limits-${entry.id}`}
    >
      <View style={styles.weeklyTitle}>
        <ProviderIcon provider={entry.id} size={iconSize.inline} />
        <Text accessibilityRole="header" style={[styles.title, styles.grow]}>
          {`${entry.name} usage`}
        </Text>
        {plan !== null && <Text style={styles.meta}>{plan}</Text>}
      </View>
      {limits.kind === "known" && limits.windows.length > 0 ? (
        limits.windows.map((window) => (
          <LimitWindowRow
            key={window.id}
            label={window.label}
            now={now}
            remaining={providerLimitRemaining(window)}
            resetsAt={window.resetsAt}
            testKey={window.id}
          />
        ))
      ) : (
        <Text style={[styles.secondaryValue, styles.unavailable]}>
          {entry.auth === "unauthenticated"
            ? `Not signed in — run \`${entry.id}\` on the server`
            : "Usage unknown"}
        </Text>
      )}
    </View>
  );
}
