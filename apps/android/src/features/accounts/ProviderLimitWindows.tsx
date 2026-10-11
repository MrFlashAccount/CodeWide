import { View } from "react-native";

import type { ProviderLimits } from "../../data/agentProviders";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./AccountPoolFeature.styles";
import { LimitWindowRow } from "./LimitWindowRow";
import { providerLimitRemaining } from "./providerAccountPresentation";

/** Every window of a provider's subscription limits, or why there are none yet. */
export function ProviderLimitWindows({
  limits,
  now,
  providerName,
}: {
  readonly limits: ProviderLimits;
  readonly now: number;
  readonly providerName: string;
}): React.JSX.Element {
  return (
    <View style={styles.accountResetDetails}>
      <Text style={styles.accountResetSectionTitle}>Limit windows</Text>
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
        <Text style={styles.accountResetUnavailable}>
          {`Usage unknown until ${providerName} reports its limits.`}
        </Text>
      )}
    </View>
  );
}
